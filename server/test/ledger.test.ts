import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aliasMap, observe, resolveAlias, type Seen, type VideoEvent, type VideoRecord } from "../src/ledger.ts";
import { followAliases, type Play } from "../src/plays.ts";
import { computeStats, trackRecord } from "../src/stats.ts";
import { aliasSongs, parseTaste } from "../src/taste.ts";

const T0 = Date.UTC(2026, 10, 18, 3);
const T1 = T0 + 86_400_000;

const record = (over: Partial<VideoRecord> = {}): VideoRecord => ({
  title: "ASAYAKE",
  channel: "CASIOPEA - Topic",
  duration: 330,
  status: "ok",
  firstSeen: T0 - 1000,
  lastChecked: T0,
  ...over,
});
const seen = (over: Partial<Seen> = {}): Seen => ({ title: "ASAYAKE", channel: "CASIOPEA - Topic", duration: 330, status: "ok", ...over });
const strip = (events: VideoEvent[]) => events.map(({ at: _at, ...e }) => e);

describe("video ledger: what changed on YouTube", () => {
  it("notes a renamed video and keeps the new title", () => {
    const videos = { aaaaaaaaaaa: record() };
    const events = observe(videos, new Map([["aaaaaaaaaaa", seen({ title: "ASAYAKE (2016 Remaster)" })]]), T1, () => 0);
    assert.deepEqual(strip(events), [{ id: "aaaaaaaaaaa", kind: "title", from: "ASAYAKE", to: "ASAYAKE (2016 Remaster)" }]);
    assert.equal(videos.aaaaaaaaaaa.title, "ASAYAKE (2016 Remaster)");
    assert.equal(videos.aaaaaaaaaaa.lastChecked, T1);
  });

  it("notes a renamed channel", () => {
    const videos = { aaaaaaaaaaa: record() };
    const events = observe(videos, new Map([["aaaaaaaaaaa", seen({ channel: "Casiopea Official" })]]), T1, () => 0);
    assert.deepEqual(strip(events), [{ id: "aaaaaaaaaaa", kind: "channel", from: "CASIOPEA - Topic", to: "Casiopea Official" }]);
  });

  it("calls a video left out of YouTube's answer gone, keeping its last title", () => {
    const videos = { aaaaaaaaaaa: record() };
    const events = observe(videos, new Map([["aaaaaaaaaaa", null]]), T1, () => 0);
    assert.deepEqual(strip(events), [{ id: "aaaaaaaaaaa", kind: "status", from: "ok", to: "gone" }]);
    assert.equal(videos.aaaaaaaaaaa.title, "ASAYAKE");
    assert.equal(videos.aaaaaaaaaaa.status, "gone");
  });

  it("notes private and region-blocked videos, without taking YouTube's placeholder title", () => {
    const videos = { aaaaaaaaaaa: record(), bbbbbbbbbbb: record({ title: "Sailing Alone" }) };
    const events = observe(
      videos,
      new Map([
        ["aaaaaaaaaaa", seen({ title: "Private video", status: "private" })],
        ["bbbbbbbbbbb", seen({ title: "Sailing Alone", status: "region" })],
      ]),
      T1,
      () => 0,
    );
    assert.deepEqual(strip(events), [
      { id: "aaaaaaaaaaa", kind: "status", from: "ok", to: "private" },
      { id: "bbbbbbbbbbb", kind: "status", from: "ok", to: "region" },
    ]);
    assert.equal(videos.aaaaaaaaaaa.title, "ASAYAKE");
  });

  it("records new and seeded videos quietly: YouTube's titles taken, only a status change noted", () => {
    const videos: Record<string, VideoRecord> = { aaaaaaaaaaa: record({ title: "box title", channel: "CASIOPEA", lastChecked: 0 }) };
    const events = observe(
      videos,
      new Map([
        ["aaaaaaaaaaa", seen({ status: "region" })],
        ["ccccccccccc", seen({ title: "Galactic Funk" })],
      ]),
      T1,
      () => T0,
    );
    assert.deepEqual(strip(events), [{ id: "aaaaaaaaaaa", kind: "status", from: "ok", to: "region" }]);
    assert.equal(videos.aaaaaaaaaaa.title, "ASAYAKE");
    assert.deepEqual(videos.ccccccccccc, { title: "Galactic Funk", channel: "CASIOPEA - Topic", duration: 330, status: "ok", firstSeen: T0, lastChecked: T1 });
  });

  it("keeps a status only a failed play found (Premium-only) when the check says the video plays", () => {
    const videos = { aaaaaaaaaaa: record({ status: "premium", byPlay: true }) };
    assert.deepEqual(observe(videos, new Map([["aaaaaaaaaaa", seen()]]), T1, () => 0), []);
    assert.equal(videos.aaaaaaaaaaa.status, "premium");
    const later = observe(videos, new Map([["aaaaaaaaaaa", null]]), T1 + 1, () => 0);
    assert.deepEqual(strip(later), [{ id: "aaaaaaaaaaa", kind: "status", from: "premium", to: "gone" }]);
    assert.equal(videos.aaaaaaaaaaa.byPlay, undefined);
  });
});

describe("video ledger: aliases", () => {
  const replaced = (id: string, to: string, at: number): VideoEvent => ({ at, id, kind: "replaced", to, by: "redirect" });

  it("follows replacements of replacements (a→b→c)", () => {
    const map = aliasMap([replaced("aaaaaaaaaaa", "bbbbbbbbbbb", 1), replaced("bbbbbbbbbbb", "ccccccccccc", 2)]);
    assert.equal(resolveAlias(map, "aaaaaaaaaaa"), "ccccccccccc");
    assert.equal(resolveAlias(map, "bbbbbbbbbbb"), "ccccccccccc");
    assert.equal(resolveAlias(map, "ccccccccccc"), "ccccccccccc");
  });

  it("drops an alias when the replacement is undone", () => {
    const map = aliasMap([
      replaced("aaaaaaaaaaa", "bbbbbbbbbbb", 1),
      replaced("bbbbbbbbbbb", "ccccccccccc", 2),
      { at: 3, id: "bbbbbbbbbbb", kind: "restored", from: "ccccccccccc" },
    ]);
    assert.equal(resolveAlias(map, "aaaaaaaaaaa"), "bbbbbbbbbbb");
    assert.equal(resolveAlias(map, "ccccccccccc"), "ccccccccccc");
  });

  it("takes the latest when a video is replaced back by the one it replaced (no loop)", () => {
    const map = aliasMap([replaced("aaaaaaaaaaa", "bbbbbbbbbbb", 1), replaced("bbbbbbbbbbb", "aaaaaaaaaaa", 2)]);
    assert.equal(resolveAlias(map, "aaaaaaaaaaa"), "aaaaaaaaaaa");
    assert.equal(resolveAlias(map, "bbbbbbbbbbb"), "aaaaaaaaaaa");
    // A loop written by hand still ends.
    assert.equal(resolveAlias(new Map([["x", "y"], ["y", "x"]]), "x"), "y");
  });

  it("counts the old video's plays for the one in its place", () => {
    const play = (id: string, startedAt: number): Play => ({
      startedAt,
      endedAt: startedAt + 200_000,
      id,
      title: "ASAYAKE",
      artist: "CASIOPEA",
      source: "youtube",
      duration: 200,
      heard: 200,
      end: "finished",
      device: "pc",
    });
    const map = aliasMap([replaced("aaaaaaaaaaa", "bbbbbbbbbbb", 1), replaced("bbbbbbbbbbb", "ccccccccccc", 2)]);
    const plays = followAliases([play("aaaaaaaaaaa", T0), play("bbbbbbbbbbb", T0 + 3_600_000), play("ccccccccccc", T0 + 7_200_000), play("ddddddddddd", T0)], (id) =>
      resolveAlias(map, id),
    );
    assert.deepEqual(trackRecord(plays, new Set(["ccccccccccc"])), { listens: 3, skips: 0, lines: 3, seconds: 600, first: T0, last: T0 + 7_200_000 });
    const top = computeStats(plays, "all", T1).topTracks;
    assert.deepEqual(
      top.map((c) => [c.id, c.listens]),
      [
        ["ccccccccccc", 3],
        ["ddddddddddd", 1],
      ],
    );
  });

  it("carries a replaced video's analysis over to the new one, unless the new one has its own", () => {
    const song = (id: string, genre: string) => ({ id, genre, sub: null, era: null, year: null, moods: [], scores: null, group: null, a: -1, t: -1 });
    const taste = parseTaste(JSON.stringify({ songs: [song("aaaaaaaaaaa", "fusion"), song("eeeeeeeeeee", "jazz"), song("fffffffffff", "pop")] }), null, null);
    const map = aliasMap([replaced("aaaaaaaaaaa", "bbbbbbbbbbb", 1), replaced("eeeeeeeeeee", "fffffffffff", 2)]);
    aliasSongs(taste, (id) => resolveAlias(map, id));
    assert.equal(taste.index.get("bbbbbbbbbbb"), 0);
    assert.equal(taste.index.has("aaaaaaaaaaa"), false);
    assert.equal(taste.songs[taste.index.get("fffffffffff")!].genre, "pop");
  });
});
