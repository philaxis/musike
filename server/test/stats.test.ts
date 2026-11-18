import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Play } from "../src/plays.ts";
import { computeStats, dayOf, dayPlays, isListen, isSkip, periodStart, trackRecord } from "../src/stats.ts";

// 21:00 in Seoul, 2026-11-18.
const now = Date.UTC(2026, 10, 18, 12);
const DAY = 86_400_000;

function play(over: Partial<Play> & { startedAt: number }): Play {
  return {
    endedAt: over.startedAt + (over.heard ?? 200) * 1000,
    id: "CfE5wDUKWhc",
    title: "Solid Jackson",
    artist: "Brad Mehldau",
    source: "youtube",
    duration: 200,
    heard: 200,
    end: "finished",
    device: "pc",
    ...over,
  };
}

describe("listen and skip rules", () => {
  it("counts exactly 30 seconds as a listen when that is half the track", () => {
    assert.equal(isListen({ heard: 30, duration: 50 }), true);
    assert.equal(isListen({ heard: 29, duration: 50 }), false);
  });

  it("needs half the track or 4 minutes", () => {
    assert.equal(isListen({ heard: 100, duration: 600 }), false);
    assert.equal(isListen({ heard: 240, duration: 600 }), true);
    assert.equal(isListen({ heard: 300, duration: 600 }), true);
  });

  it("counts a track of unknown length (duration 0) after 30 seconds", () => {
    assert.equal(isListen({ heard: 30, duration: 0 }), true);
    assert.equal(isListen({ heard: 29, duration: 0 }), false);
  });

  it("a skip is moving on within 30 seconds", () => {
    assert.equal(isSkip({ heard: 29, end: "skipped" }), true);
    assert.equal(isSkip({ heard: 30, end: "skipped" }), false);
    assert.equal(isSkip({ heard: 5, end: "finished" }), false);
    assert.equal(isSkip({ heard: 5, end: "left" }), false);
  });
});

describe("periods", () => {
  it("4 weeks start at midnight in Seoul, 27 days before today", () => {
    assert.equal(dayOf(now), "2026-11-18");
    assert.equal(periodStart("4w", now), Date.UTC(2026, 9, 21, 15));
    assert.equal(periodStart("6m", now), Date.UTC(2026, 10, 17, 15) - 181 * DAY);
    assert.equal(periodStart("all", now), null);
  });

  it("puts a play on its Seoul day and hour", () => {
    // 2026-11-17 15:30 UTC is 00:30 on the 18th in Seoul.
    const s = computeStats([play({ startedAt: Date.UTC(2026, 10, 17, 15, 30) })], "4w", now);
    assert.deepEqual(s.days, [{ date: "2026-11-18", seconds: 200, listens: 1 }]);
    assert.equal(s.hours[0], 200);
  });

  it("leaves out what started one second before the period", () => {
    const start = periodStart("4w", now)!;
    const s = computeStats(
      [play({ startedAt: start - 1000, id: "aaaaaaaaaaa" }), play({ startedAt: start, id: "bbbbbbbbbbb" })],
      "4w",
      now,
    );
    assert.equal(s.summary.listens, 1);
    assert.deepEqual(s.topTracks.map((c) => c.id), ["bbbbbbbbbbb"]);
    assert.equal(s.from, "2026-10-22");
    assert.equal(s.total, 2);
    assert.equal(computeStats([play({ startedAt: start - 1000 })], "all", now).from, "2026-10-21");
  });
});

describe("computeStats", () => {
  const A = "aaaaaaaaaaa";
  const B = "bbbbbbbbbbb";
  const plays = [
    // A: three listens 100 days ago, nothing since → forgotten.
    ...[100, 99, 98].map((d) => play({ id: A, artist: "Cassiopea", startedAt: now - d * DAY })),
    // B: heard before the period, and twice in it (one a skip) → not new.
    play({ id: B, startedAt: now - 40 * DAY }),
    play({ id: B, startedAt: now - 3 * DAY }),
    play({ id: B, startedAt: now - 2 * DAY, heard: 10, end: "skipped" }),
    play({ id: B, startedAt: now - DAY }),
    // C: first listened this week → new.
    play({ id: "ccccccccccc", artist: "Cassiopea", startedAt: now - 3600_000, heard: 30, duration: 0 }),
  ];

  it("sums the period and counts new tracks and skips", () => {
    const s = computeStats(plays, "4w", now);
    assert.equal(s.summary.lines, 4);
    assert.equal(s.summary.listens, 3);
    assert.equal(s.summary.seconds, 200 + 10 + 200 + 30);
    assert.equal(s.summary.newTracks, 1);
    assert.equal(s.summary.skipRate, 1 / 4);
    assert.deepEqual(s.topTracks.map((c) => [c.id, c.listens]), [[B, 2], ["ccccccccccc", 1]]);
    assert.deepEqual(s.topArtists.map((a) => [a.name, a.listens]), [["Brad Mehldau", 2], ["Cassiopea", 1]]);
    assert.deepEqual(s.onRepeat.map((c) => c.id), [B]);
    assert.deepEqual(s.forgotten.map((c) => c.id), [A]);
    assert.equal(s.genres, null);
  });

  it("all time counts every first listen as new", () => {
    const s = computeStats(plays, "all", now);
    assert.equal(s.summary.newTracks, 3);
    assert.equal(s.topArtists[0].name, "Cassiopea");
    assert.equal(s.topArtists[0].listens, 4);
  });

  it("groups by genre when the analysis knows the tracks", () => {
    const genre: Record<string, string> = { [A]: "재즈", [B]: "재즈", ccccccccccc: "J-pop/시티팝" };
    const s = computeStats(plays, "all", now, (id) => genre[id]);
    assert.deepEqual(s.genres, [
      { genre: "재즈", listens: 6 },
      { genre: "J-pop/시티팝", listens: 1 },
    ]);
  });

  it("one day's listens and one track's record", () => {
    const day = dayPlays(plays, dayOf(now - DAY));
    assert.equal(day.listens, 1);
    assert.deepEqual(day.tracks.map((p) => p.id), [B]);
    const rec = trackRecord(plays, new Set([B]));
    assert.deepEqual({ ...rec, seconds: undefined }, { listens: 3, skips: 1, lines: 4, seconds: undefined, first: now - 40 * DAY, last: now - DAY });
    assert.equal(trackRecord(plays, new Set(["zzzzzzzzzzz"])).first, null);
  });
});
