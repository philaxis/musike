import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import * as box from "../src/box.ts";
import { config } from "../src/config.ts";
import { registerHomeRoutes } from "../src/homeRoutes.ts";
import * as ledger from "../src/ledger.ts";
import * as library from "../src/library.ts";
import type { Play } from "../src/plays.ts";
import {
  agoWindow,
  albumCards,
  albumShelves,
  dailyAlbums,
  lastListens,
  listensBetween,
  sunAgo,
  sunCounts,
  sunMonth,
  yearsAgo,
  yearsBefore,
  type AlbumCard,
  type LikeDays,
} from "../src/shelves.ts";
import { dayOf, dayStart } from "../src/stats.ts";
import { parseTaste } from "../src/taste.ts";
import type { Track } from "../src/types.ts";
import { buildWorks } from "../src/works.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 19, 3); // 2026-11-19 12:00 in Seoul
const vid = (n: number) => `vid${String(n).padStart(8, "0")}`;
const track = (id: string, title = id, artist = "a"): Track => ({ id, title, artist, duration: 200, thumb: "", art: "", kind: "song" });
const play = (id: string, at: number, heard = 200): Play => ({
  startedAt: at,
  endedAt: at + heard * 1000,
  id,
  title: id,
  artist: "a",
  source: "youtube",
  duration: 200,
  heard,
  end: "finished",
  device: "phone",
});

/** A made-up analysis: `[album, genre, artist]` per song, the n-th with ID vid(n), all playable. */
function sample(rows: [string | null, string, string?][]) {
  const taste = parseTaste(JSON.stringify({ songs: rows.map(([album, genre], n) => ({ id: vid(n), genre, album, a: -1, t: -1 })) }), null, null);
  return buildWorks(taste, new Map(rows.map(([, , artist], n) => [vid(n), track(vid(n), `t${n}`, artist ?? "a")])));
}

const card = (key: string, last: number): AlbumCard => ({ key, name: key, artists: [], genre: "재즈", count: 3, last, cover: track(vid(0)) });

describe("Library: album shelves", () => {
  const works = sample([
    ["Zeta", "재즈"],
    ["Zeta", "재즈"],
    ["Zeta", "재즈"],
    ["alpha", "재즈"],
    ["alpha", "재즈"],
    ["alpha", "J-pop"], // the album's genre is the one most of it has
    ["Beta", "재즈"],
    ["Beta", "재즈"],
    ["Beta", "재즈"],
    ["Two", "재즈"],
    ["Two", "재즈"], // only 2 of my tracks: not on the shelves
    ["Pop", "J-pop"],
    ["Pop", "J-pop"],
    ["Pop", "J-pop"],
    [null, "J-pop"],
  ]);

  it("keeps albums with 3 or more of my tracks, heard lately first, then by name", () => {
    const last = lastListens([play(vid(0), NOW - 5 * DAY), play(vid(7), NOW - DAY), play(vid(4), NOW, 10)]);
    const cards = albumCards(works, last);
    assert.deepEqual(cards.map((c) => c.key).sort(), ["Beta", "Pop", "Zeta", "alpha"]);
    const shelves = albumShelves(cards);
    // 재즈 has three albums, J-pop one: the bigger shelf first.
    assert.deepEqual(
      shelves.map((s) => [s.genre, s.count, s.albums.map((a) => a.key)]),
      [
        // Beta heard yesterday, Zeta 5 days ago; alpha only skipped (10 s), so unheard, by name.
        ["재즈", 3, ["Beta", "Zeta", "alpha"]],
        ["J-pop", 1, ["Pop"]],
      ],
    );
    assert.equal(shelves[0].albums[0].count, 3);
    assert.equal(shelves[0].albums[0].cover.id, vid(6));
  });

  it("cuts each shelf to `limit` albums but keeps the count", () => {
    const shelves = albumShelves(albumCards(works, new Map()), 2);
    assert.deepEqual(shelves[0].albums.map((a) => a.key), ["alpha", "Beta"]);
    assert.equal(shelves[0].count, 3);
  });
});

describe("Home: albums to take out today", () => {
  const cards = Array.from({ length: 40 }, (_, i) => card(`album ${i}`, i < 5 ? NOW - DAY : 0));
  const today = dayOf(NOW);
  const tomorrow = dayOf(NOW + DAY);

  it("picks 8 albums not heard in 30 days, the same all day", () => {
    const morning = dailyAlbums(cards, today, dayStart(today) + 60_000);
    const night = dailyAlbums([...cards].reverse(), today, dayStart(today) + DAY - 60_000);
    assert.equal(morning.length, 8);
    assert.deepEqual(night.map((c) => c.key), morning.map((c) => c.key));
    assert.ok(morning.every((c) => c.last === 0), "albums heard yesterday are left out");
  });

  it("changes the next day", () => {
    const next = dailyAlbums(cards, tomorrow, NOW + DAY);
    assert.notDeepEqual(next.map((c) => c.key), dailyAlbums(cards, today, NOW).map((c) => c.key));
  });

  it("counts an album heard 31 days ago as unheard", () => {
    assert.deepEqual(dailyAlbums([card("old", NOW - 31 * DAY), card("new", NOW - 29 * DAY)], today, NOW).map((c) => c.key), ["old"]);
  });
});

describe("a year ago", () => {
  it("is the same date a year before, ±7 days", () => {
    assert.deepEqual(agoWindow("2026-11-19"), { from: "2025-11-12", to: "2025-11-26" });
    assert.equal(yearsBefore("2028-02-29", 1), "2027-02-28");
    assert.equal(yearsAgo("2025-11-26", "2026-11-19"), 1);
    assert.equal(yearsAgo("2025-11-27", "2026-11-19"), null);
    assert.equal(yearsAgo("2024-11-12", "2026-11-19"), 2);
    assert.equal(yearsAgo("2026-11-15", "2026-11-19"), null, "this year is not an earlier year");
    // Near New Year the window a year back starts in the year before it.
    assert.equal(yearsAgo("2025-12-30", "2027-01-03"), 1);
  });

  it("counts listens in the window, most first", () => {
    const { from, to } = agoWindow("2026-11-19");
    const at = dayStart("2025-11-19");
    const plays = [play(vid(1), at), play(vid(2), at), play(vid(2), at + 3600_000), play(vid(3), at, 5), play(vid(4), dayStart("2025-11-27"))];
    assert.deepEqual(listensBetween(plays, from, to).map((c) => [c.id, c.listens]), [
      [vid(2), 2],
      [vid(1), 1],
    ]);
  });
});

describe("☀ lists", () => {
  const like = (id: string, at: number) => ({ ...track(id), at });
  const OLD = "aaaaaaaaaaa";
  const NEW = "bbbbbbbbbbb";
  const resolve = (id: string) => (id === OLD ? NEW : id);
  const all: LikeDays = {
    "2025-11-20": [like(vid(1), 1)],
    "2026-10-01": [like(vid(1), 2), like(vid(2), 3)],
    "2026-11-10": [like(OLD, 4), like(vid(2), 5)],
    "2026-11-12": [like(NEW, 6)],
    // Liked under both IDs on one day: one day.
    "2026-11-18": [like(OLD, 7), like(NEW, 8), like(vid(3), 9)],
  };

  it("ranks by days with ☀, a replaced video's days counting for the one in its place", () => {
    assert.deepEqual(sunCounts(all, resolve).map((c) => [c.id, c.days, c.last]), [
      [NEW, 3, "2026-11-18"],
      [vid(2), 2, "2026-11-10"],
      [vid(1), 2, "2026-10-01"],
      [vid(3), 1, "2026-11-18"],
    ]);
    assert.deepEqual(sunCounts(all, resolve, "2026-10-23").map((c) => [c.id, c.days]), [
      [NEW, 3],
      [vid(3), 1],
      [vid(2), 1],
    ]);
  });

  it("puts each day's first ☀ on the calendar", () => {
    assert.deepEqual(sunMonth(all, resolve, "2026-11").map((d) => [d.date, d.count, d.first.id]), [
      ["2026-11-10", 2, OLD],
      ["2026-11-12", 1, NEW],
      ["2026-11-18", 2, OLD],
    ]);
    assert.deepEqual(sunMonth(all, resolve, "2026-09"), []);
  });

  it("finds this time of year in earlier years", () => {
    assert.deepEqual(sunAgo(all, resolve, "2026-11-19").map((a) => [a.id, a.date, a.years]), [[vid(1), "2025-11-20", 1]]);
    assert.deepEqual(sunAgo(all, resolve, "2026-06-01"), []);
  });
});

describe("Home and ☀ API", () => {
  it("follows the video ledger's aliases", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "musike-home-"));
    config.dataDir = dir;
    config.analysisDir = path.join(dir, "missing");
    ledger.resetLedger();
    const memory = () => {
      let json: string | null = null;
      return { read: async () => json, write: async (s: string) => void (json = s) };
    };
    library.useLibraryStorage(memory());
    box.useBoxStorage(memory());
    const OLD = "aaaaaaaaaaa";
    const NEW = "bbbbbbbbbbb";
    await box.addToBox([track(NEW, "Losers (new)")], { kind: "link", ref: "", name: "", at: 1 });
    await ledger.recordReplaced(OLD, track(NEW), "redirect");
    const now = Date.now();
    const day = (n: number) => dayOf(now - n * DAY);
    const yearAgo = dayOf(Date.parse(`${agoWindow(dayOf(now)).from}T12:00:00Z`) + 7 * DAY);
    await writeFile(
      path.join(dir, "daylikes.json"),
      JSON.stringify({
        [yearAgo]: [{ ...track(vid(5)), at: 1 }],
        [day(40)]: [{ ...track(vid(1)), at: 2 }],
        [day(3)]: [{ ...track(NEW), at: 3 }],
        [day(0)]: [
          { ...track(OLD, "Losers"), at: 4 },
          { ...track(vid(1)), at: 5 },
        ],
      }),
    );
    const app = Fastify();
    registerHomeRoutes(app);
    const get = async (url: string) => (await app.inject({ method: "GET", url })).json();

    const recent = await get("/api/daylikes/top");
    assert.deepEqual(recent.items.map((x: { track: Track; days: number }) => [x.track.id, x.track.title, x.days]), [
      [NEW, "Losers (new)", 2],
      [vid(1), vid(1), 1],
    ]);
    const ever = await get("/api/daylikes/top?period=all");
    assert.deepEqual(ever.items.map((x: { track: Track; days: number }) => [x.track.id, x.days]), [
      [vid(1), 2],
      [NEW, 2],
      [vid(5), 1],
    ]);
    assert.equal((await app.inject({ method: "GET", url: "/api/daylikes/top?period=6m" })).statusCode, 400);

    const month = await get(`/api/daylikes/calendar?month=${day(0).slice(0, 7)}`);
    assert.ok(month.days.some((d: { date: string; count: number }) => d.date === day(0) && d.count === 2));
    assert.equal(month.first, yearAgo.slice(0, 7));
    assert.equal((await app.inject({ method: "GET", url: "/api/daylikes/calendar?month=2026-13" })).statusCode, 400);

    const ago = await get("/api/daylikes/ago");
    assert.deepEqual(ago.items.map((x: { track: Track; years: number }) => [x.track.id, x.years]), [[vid(5), 1]]);

    // No analysis: no albums, but a year ago is there from the ☀.
    const home = await get("/api/home");
    assert.equal(home.date, day(0));
    assert.deepEqual(home.albums, []);
    assert.deepEqual(home.yearAgo.tracks.map((t: Track) => t.id), [vid(5)]);
    assert.equal(home.yearAgo.liked, 1);
    assert.deepEqual(await get("/api/works/albums"), { ready: false, total: 0, shelves: [] });
    assert.equal((await app.inject({ method: "GET", url: `/api/works/albums?genre=${encodeURIComponent("재즈")}` })).statusCode, 404);
    await app.close();
  });
});
