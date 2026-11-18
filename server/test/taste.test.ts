import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import * as box from "../src/box.ts";
import { config } from "../src/config.ts";
import * as library from "../src/library.ts";
import { buildMixes, type KnownTrack } from "../src/mixes.ts";
import { isListen, type Play } from "../src/plays.ts";
import { loadTaste, parseTaste, radio, simPair, type Taste } from "../src/taste.ts";
import { registerTasteRoutes } from "../src/tasteRoutes.ts";

const f32 = (rows: number[][]) => {
  const buf = Buffer.alloc(rows.length * rows[0].length * 4);
  rows.flat().forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf;
};
const unit = (v: number[]) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const vid = (n: number) => `vid${String(n).padStart(8, "0")}`;

/** Songs in three sound groups (directions 0, 1, 2 of a 4-d space), audio and text alike. */
function sampleTaste(perGroup = 15, missingAudio: number[] = []): Taste {
  const songs = [];
  const audio: number[][] = [];
  const text: number[][] = [];
  for (let g = 0; g < 3; g++) {
    for (let k = 0; k < perGroup; k++) {
      const n = g * perGroup + k;
      // Group 1 leans towards group 0; group 2 is apart.
      const centre = [
        [1, 0, 0, 0],
        [0.7, 0.7, 0, 0],
        [0, 0, 1, 0],
      ][g];
      const v = unit(centre.map((x, d) => x + 0.05 * Math.sin(n * (d + 1))));
      const a = missingAudio.includes(n) ? -1 : audio.push(v) - 1;
      text.push(v);
      songs.push({
        id: vid(n),
        genre: g < 2 ? "재즈" : "록",
        sub: null,
        era: null,
        year: null,
        moods: [],
        scores: { energy: g === 2 ? 5 : 1, valence: g === 2 ? 4 : 2, acoustic: g === 2 ? 1 : 5, vocal: 1 },
        group: a < 0 ? null : `g${g}`,
        a,
        t: n,
      });
    }
  }
  const json = JSON.stringify({
    version: 1,
    audioDim: 4,
    textDim: 4,
    songs,
    groups: [0, 1, 2].map((g) => ({ id: `g${g}`, genre: g < 2 ? "재즈" : "록", name: g < 2 ? "모던재즈 · 보사노바" : "하드록", size: perGroup })),
  });
  return parseTaste(json, f32(audio), f32(text));
}

describe("taste: likeness", () => {
  it("is half sound, half description", () => {
    const taste = sampleTaste();
    const a = taste.songs[0];
    const b = taste.songs[20];
    const cos = (m: Float32Array, x: number, y: number) => [0, 1, 2, 3].reduce((s, k) => s + m[x * 4 + k] * m[y * 4 + k], 0);
    assert.ok(Math.abs(simPair(taste, 0, 20) - (0.5 * cos(taste.audio!, a.a, b.a) + 0.5 * cos(taste.text!, a.t, b.t))) < 1e-6);
  });

  it("uses only the description when one track has no sound vector", () => {
    const taste = sampleTaste(15, [3]);
    assert.equal(taste.songs[3].a, -1);
    const textCos = [0, 1, 2, 3].reduce((s, k) => s + taste.text![3 * 4 + k] * taste.text![20 * 4 + k], 0);
    assert.ok(Math.abs(simPair(taste, 3, 20) - textCos) < 1e-6);
    assert.ok(Math.abs(simPair(taste, 20, 3) - textCos) < 1e-6);
  });

  it("falls back to group and genre without vectors", () => {
    const taste = parseTaste(
      JSON.stringify({
        songs: [
          { id: vid(1), genre: "재즈", group: "g", a: -1, t: -1 },
          { id: vid(2), genre: "재즈", group: "g", a: -1, t: -1 },
          { id: vid(3), genre: "재즈", group: "h", a: -1, t: -1 },
          { id: vid(4), genre: "록", group: "k", a: -1, t: -1 },
        ],
      }),
      null,
      null,
    );
    assert.deepEqual([simPair(taste, 0, 1), simPair(taste, 0, 2), simPair(taste, 0, 3)], [0.6, 0.4, 0]);
  });

  it("drops a vector file whose size doesn't match", () => {
    const taste = parseTaste(JSON.stringify({ audioDim: 4, textDim: 4, songs: [{ id: vid(1), genre: "x", a: 0, t: 0 }] }), Buffer.alloc(10), f32([[1, 0, 0, 0]]));
    assert.equal(taste.audio, null);
    assert.ok(taste.text);
  });
});

describe("taste: radio", () => {
  it("starts with the seed, keeps to 2 tracks per artist and prefers alike tracks", () => {
    const taste = sampleTaste(15);
    // Group 0 is all one artist; groups 1 and 2 one artist per track.
    const artistOf = (i: number) => (i < 15 ? "CASIOPEA" : `artist ${i}`);
    const list = radio(taste, 0, () => true, artistOf);
    assert.equal(list[0], 0);
    assert.equal(list.length, 25);
    assert.equal(new Set(list).size, 25);
    assert.equal(list.filter((i) => artistOf(i) === "CASIOPEA").length, 2);
    // Next most alike after the capped artist: group 1 (same genre), before group 2.
    assert.ok(list.slice(2, 10).every((i) => i >= 15 && i < 30));
  });

  it("artist names match loosely", () => {
    const taste = sampleTaste(15);
    const artistOf = (i: number) => (i % 2 ? "Casiopea - Topic" : "CASIOPEA");
    const list = radio(taste, 0, () => true, artistOf);
    assert.equal(list.length, 2);
  });
});

describe("taste: mixes", () => {
  const now = Date.UTC(2026, 10, 18, 12);
  const day = 86_400_000;
  const play = (id: string, daysAgo: number, heard = 200): Play => ({
    startedAt: now - daysAgo * day,
    endedAt: now - daysAgo * day + heard * 1000,
    id,
    title: id,
    artist: "a",
    source: "youtube",
    duration: 240,
    heard,
    end: "finished",
    device: "pc",
  });
  const knownAll = (taste: Taste) =>
    new Map(taste.songs.map((s, i): [string, KnownTrack] => [s.id, { artist: `artist ${i}`, addedAt: now - 3 * day }]));

  it("counts a listen as 30 s and half the track or 4 minutes", () => {
    assert.equal(isListen({ heard: 29, duration: 40 }), false);
    assert.equal(isListen({ heard: 100, duration: 240 }), false);
    assert.equal(isListen({ heard: 120, duration: 240 }), true);
    assert.equal(isListen({ heard: 240, duration: 900 }), true);
  });

  it("makes a daily mix per sound group listened to, the same all day", () => {
    const taste = sampleTaste(15);
    const plays = [0, 1, 2, 3, 4, 5, 15, 16, 17, 18, 19, 30, 31, 32, 33].flatMap((n) => [play(vid(n), 2), play(vid(n), 5)]);
    const input = { taste, plays, now, day: "2026-11-18", favorites: [], daylikes: [], known: knownAll(taste) };
    const mixes = buildMixes(input);
    const daily = mixes.filter((m) => m.kind === "daily");
    assert.equal(daily.length, 3);
    for (const m of daily) {
      const groups = new Set(m.ids.map((id) => taste.songs[taste.index.get(id)!].group));
      assert.equal(groups.size, 1, "fresh tracks are alike the heard ones");
      const heard = m.ids.filter((id) => plays.some((p) => p.id === id)).length;
      assert.ok(heard / m.ids.length >= 0.6, `mostly heard: ${heard}/${m.ids.length}`);
    }
    assert.deepEqual(buildMixes(input), mixes);
    assert.notDeepEqual(buildMixes({ ...input, day: "2026-11-19" }).find((m) => m.kind === "daily")!.ids, daily[0].ids);
  });

  it("starts from the biggest sound groups with no history, without on-repeat or forgotten", () => {
    const taste = sampleTaste(15);
    const mixes = buildMixes({ taste, plays: [], now, day: "2026-11-18", favorites: [], daylikes: [], known: knownAll(taste) });
    assert.equal(mixes.filter((m) => m.kind === "daily").length, 3);
    assert.ok(!mixes.some((m) => m.kind === "onRepeat" || m.kind === "forgotten"));
    assert.ok(mixes.some((m) => m.kind === "upbeat") && mixes.some((m) => m.kind === "calm"));
  });

  it("tells recent repeats from forgotten favourites", () => {
    const taste = sampleTaste(15);
    const plays = [
      ...[0, 1, 2, 3, 4].flatMap((n) => [play(vid(n), 1), play(vid(n), 3)]),
      ...[40, 41, 42, 43, 44].flatMap((n) => [play(vid(n), 90), play(vid(n), 92), play(vid(n), 95), play(vid(n), 99), play(vid(n), 100)]),
      play(vid(40), 1, 10),
    ];
    const mixes = buildMixes({ taste, plays, now, day: "2026-11-18", favorites: [], daylikes: [], known: knownAll(taste) });
    assert.deepEqual(new Set(mixes.find((m) => m.kind === "onRepeat")!.ids), new Set([0, 1, 2, 3, 4].map(vid)));
    assert.deepEqual(new Set(mixes.find((m) => m.kind === "forgotten")!.ids), new Set([40, 41, 42, 43, 44].map(vid)));
  });
});

describe("taste: API without an analysis", () => {
  it("answers empty, and the server keeps working", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "musike-taste-"));
    config.analysisDir = path.join(dir, "missing");
    config.dataDir = dir;
    const memory = () => {
      let json: string | null = null;
      return { read: async () => json, write: async (s: string) => void (json = s) };
    };
    library.useLibraryStorage(memory());
    box.useBoxStorage(memory());
    assert.equal((await loadTaste()).songs.length, 0);
    const app = Fastify();
    registerTasteRoutes(app);
    const get = async (url: string) => (await app.inject({ method: "GET", url })).json();
    assert.deepEqual(await get("/api/taste/genres"), { ready: false, genres: [] });
    assert.deepEqual(await get("/api/taste/radio/zvjItvrldIU"), { analyzed: false, seed: null, tracks: [] });
    assert.deepEqual(await get("/api/taste/mixes"), { ready: false, mixes: [] });
    await app.close();
  });
});
