import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeTrack, storedBodies } from "../src/library.ts";
import { buildMixes, type KnownTrack } from "../src/mixes.ts";
import type { Play } from "../src/plays.ts";
import { parseTaste, radio } from "../src/taste.ts";
import type { Track } from "../src/types.ts";
import { buildWorks, unitRows, type WorkFields } from "../src/works.ts";

// A performance of two or more movements is one unit where Musike picks tracks itself (radio, mixes, sound groups,
// the map): one row, its movements in order, counted once for likeness and the artist cap.

const vid = (n: number) => `vid${String(n).padStart(8, "0")}`;
const CLEVELAND = "The Cleveland Orchestra";

interface Row extends WorkFields {
  title: string;
  artist: string;
  /** Direction in a 4-d space: rows alike point the same way. */
  dir: number[];
}

const unit = (v: number[]) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const f32 = (rows: number[][]) => {
  const buf = Buffer.alloc(rows.length * rows[0].length * 4);
  rows.flat().forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf;
};

function sample(rows: Row[]) {
  const vectors = rows.map((r, n) => unit(r.dir.map((x, d) => x + 0.02 * Math.sin(n * (d + 1)))));
  const json = JSON.stringify({
    audioDim: 4,
    textDim: 4,
    songs: rows.map(({ title: _t, artist: _a, dir: _d, ...w }, n) => ({
      id: vid(n),
      genre: w.composer ? "클래식" : "재즈",
      group: w.composer ? "클래식·1" : "재즈·1",
      scores: { energy: 1, valence: 2, acoustic: 5, vocal: 1 },
      a: n,
      t: n,
      ...w,
    })),
  });
  const taste = parseTaste(json, f32(vectors), f32(vectors));
  const known = new Map<string, Track>(
    rows.map((r, n) => [vid(n), { id: vid(n), title: r.title, artist: r.artist, duration: 600, thumb: "", art: "", kind: "song" }]),
  );
  return buildWorks(taste, known);
}

/** Movements of one performance, given in the order listed (not their own). */
const symphony = (work: string, performer: string, order: number[], dir: number[]): Row[] =>
  order.map((n) => ({
    title: `Dvořák: ${work}: ${["I. Allegro", "II. Adagio", "III. Scherzo", "IV. Finale"][n - 1]}`,
    artist: performer,
    composer: "Antonín Dvořák",
    work,
    movement: { n, title: ["Allegro", "Adagio", "Scherzo", "Finale"][n - 1] },
    instance: `Antonín Dvořák | ${work} | ${performer} | ${work}`,
    dir,
  }));

const NEAR = [1, 0, 0, 0];
const rows: Row[] = [
  // 0–3: Dvořák 7 by Cleveland, listed III, I, IV, II.
  ...symphony("Symphony No. 7", CLEVELAND, [3, 1, 4, 2], NEAR),
  // 4–7, 8–11: two more Cleveland performances, as alike.
  ...symphony("Symphony No. 8", CLEVELAND, [1, 2, 3, 4], NEAR),
  ...symphony("Symphony No. 9", CLEVELAND, [1, 2, 3, 4], NEAR),
  // 12–15: another orchestra.
  ...symphony("Symphony No. 6", "Czech Philharmonic", [1, 2, 3, 4], NEAR),
  // 16: one movement known only: a track of its own.
  ...symphony("Symphony No. 5", "London Symphony Orchestra", [2], NEAR),
  // 17–40: tracks without works, one artist each, less alike.
  ...Array.from({ length: 24 }, (_, k): Row => ({ title: `Song ${k}`, artist: `Artist ${k}`, dir: [0.6, 0.8, 0, 0] })),
];

describe("work units: lists", () => {
  it("makes one row per performance, its movements in order, where its first movement comes", () => {
    const works = sample(rows);
    const list = unitRows(works, [16, 2, 0, 17, 5, 3]);
    assert.deepEqual(
      list.map((t) => t.id),
      [vid(16), `W${vid(1)}`, vid(17), `W${vid(4)}`],
    );
    const seventh = list[1];
    assert.equal(seventh.kind, "bundle");
    assert.equal(seventh.title, "Dvořák: Symphony No. 7");
    assert.equal(seventh.artist, CLEVELAND);
    assert.equal(seventh.duration, 2400);
    assert.deepEqual(
      seventh.work!.parts!.map((t) => t.id),
      [1, 3, 0, 2].map(vid),
    );
    assert.deepEqual(seventh.work!.labels, ["I. Allegro", "II. Adagio", "III. Scherzo", "IV. Finale"]);
    assert.equal(list[0].work, undefined, "one known movement stays a track");
  });

  it("stores a performance row as its movements (playlists, ♥)", () => {
    const works = sample(rows);
    const [row, single] = unitRows(works, [0, 17]);
    assert.deepEqual(
      storedBodies(JSON.parse(JSON.stringify([row, single]))).map((t) => sanitizeTrack(t).id),
      [1, 3, 0, 2, 17].map(vid),
    );
  });
});

describe("work units: radio", () => {
  it("starts a movement's radio with movement 1 of its performance, then whole works", () => {
    const works = sample(rows);
    const picked = radio(works.taste, 0, () => true, (i) => rows[i].artist, works.units);
    assert.equal(picked[0], 1, "movement III seeds the radio; it starts from movement I");
    const instances = picked.map((i) => rows[i].instance).filter(Boolean);
    assert.equal(new Set(instances).size, instances.length, "no performance twice");
    assert.ok(picked.every((i) => !works.units.has(i) || works.units.get(i)![0] === i), "only first movements stand for performances");
    const list = unitRows(works, picked);
    assert.equal(list[0].id, `W${vid(1)}`);
    assert.deepEqual(
      list[0].work!.parts!.map((t) => t.id),
      [1, 3, 0, 2].map(vid),
    );
  });

  it("counts a performance once for the artist cap", () => {
    const works = sample(rows);
    const picked = radio(works.taste, 0, () => true, (i) => rows[i].artist, works.units);
    // Three Cleveland performances (12 tracks) are the most alike; two of them, the seed's included, make the cap.
    assert.equal(picked.filter((i) => rows[i].artist === CLEVELAND).length, 2);
    assert.ok(picked.includes(12), "another orchestra's performance comes whole");
    assert.ok(!picked.some((i) => i > 12 && i <= 15));
  });

  it("leaves tracks without a performance as they were", () => {
    const works = sample(rows);
    const picked = radio(works.taste, 17, () => true, (i) => rows[i].artist, works.units);
    assert.equal(picked[0], 17);
    assert.equal(unitRows(works, picked)[0].id, vid(17));
  });
});

describe("work units: mixes", () => {
  const now = Date.UTC(2026, 10, 19, 12);
  const day = 86_400_000;
  const play = (n: number, daysAgo: number): Play => ({
    startedAt: now - daysAgo * day,
    endedAt: now - daysAgo * day + 600_000,
    id: vid(n),
    title: rows[n].title,
    artist: rows[n].artist,
    source: "youtube",
    duration: 600,
    heard: 600,
    end: "finished",
    device: "pc",
  });

  it("picks a performance once, as its first movement, and counts a whole listen as one", () => {
    const works = sample(rows);
    const known = new Map(rows.map((r, n): [string, KnownTrack] => [vid(n), { artist: r.artist, addedAt: now - 3 * day }]));
    // Dvořák 7 heard through once, Dvořák 8 twice; ten songs twice each.
    const plays = [
      ...[0, 1, 2, 3].map((n) => play(n, 2)),
      ...[4, 5, 6, 7].flatMap((n) => [play(n, 2), play(n, 4)]),
      ...Array.from({ length: 10 }, (_, k) => [play(17 + k, 1), play(17 + k, 3)]).flat(),
    ];
    const mixes = buildMixes({ taste: works.taste, plays, now, day: "2026-11-19", favorites: [vid(14)], daylikes: [], known, units: works.units });
    for (const m of mixes) {
      const units = m.ids.map((id) => works.units.get(works.taste.index.get(id)!)?.[0]).filter((u) => u !== undefined);
      assert.equal(new Set(units).size, units.length, `${m.id}: no performance twice`);
      assert.ok(
        m.ids.every((id) => {
          const i = works.taste.index.get(id)!;
          return !works.units.has(i) || works.units.get(i)![0] === i;
        }),
        `${m.id}: performances stand as their first movement`,
      );
    }
    const onRepeat = mixes.find((m) => m.kind === "onRepeat")!.ids;
    assert.ok(onRepeat.includes(vid(4)), "Dvořák 8 heard twice");
    assert.ok(!onRepeat.includes(vid(1)) && !onRepeat.includes(vid(0)), "Dvořák 7 heard once, though four movements");
  });
});
