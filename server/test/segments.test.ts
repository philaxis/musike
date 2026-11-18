import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type * as Local from "../src/local.ts";
import { localId } from "../src/localNames.ts";
import { parseSegments, segmentId, segmentTracks, SegmentStore } from "../src/segments.ts";
import { HttpError, LOCAL_ID, type Track } from "../src/types.ts";

const ROOT = "야마시타 타츠로";
const RIDE = "[1980.09.21] RIDE ON TIME (Lossless).mp4";
const songs = [
  { no: 1, start: 0, end: 348.514, title: "いつか" },
  { no: 2, start: 348.514, end: 619.647, title: "Daydream" },
  { no: 3, start: 619.647, end: 948.931, title: "Silent Screamer" },
];

const tmp = await mkdtemp(path.join(tmpdir(), "musike-segments-"));
after(() => rm(tmp, { recursive: true, force: true }));

describe("segment IDs", () => {
  it("are local IDs, stable, one per song number and never the file's own", () => {
    const id = segmentId(ROOT, RIDE, 3);
    assert.match(id, LOCAL_ID);
    assert.equal(id, segmentId(ROOT, RIDE, 3));
    assert.equal(id, localId(ROOT, `${RIDE}#3`));
    assert.notEqual(id, segmentId(ROOT, RIDE, 2));
    assert.notEqual(id, localId(ROOT, RIDE));
  });
});

describe("parseSegments", () => {
  it("keeps a good list with millisecond times and trimmed titles", () => {
    assert.deepEqual(parseSegments([{ no: 1, start: 0, end: 10.12345, title: "  A " }, { no: 2, start: 10.12345, end: 20, title: "B" }]), [
      { no: 1, start: 0, end: 10.123, title: "A" },
      { no: 2, start: 10.123, end: 20, title: "B" },
    ]);
    assert.deepEqual(parseSegments([]), []);
  });

  it("refuses lists that don't describe songs in order inside the file", () => {
    const bad: unknown[] = [
      "nope",
      [{ no: 1, start: 5, end: 5, title: "A" }],
      [{ no: 1, start: -1, end: 5, title: "A" }],
      [{ no: 0, start: 0, end: 5, title: "A" }],
      [{ no: 1.5, start: 0, end: 5, title: "A" }],
      [{ no: 1, start: 0, end: 5, title: " " }],
      [{ no: 1, start: 0, end: 5, title: "A" }, { no: 1, start: 5, end: 9, title: "B" }],
      [{ no: 1, start: 0, end: 5, title: "A" }, { no: 2, start: 4, end: 9, title: "B" }],
      [{ no: 1, start: 0, end: "5", title: "A" }],
    ];
    for (const input of bad) assert.throws(() => parseSegments(input), HttpError, JSON.stringify(input));
    assert.throws(() => parseSegments([{ no: 1, start: 0, end: 100, title: "A" }], 50), HttpError, "ends after the file");
    assert.doesNotThrow(() => parseSegments([{ no: 1, start: 0, end: 50.5, title: "A" }], 50));
  });
});

describe("segmentTracks", () => {
  it("takes title and length from the song, the rest from the file", () => {
    const fileId = localId(ROOT, RIDE);
    const file: Track = { id: fileId, title: "RIDE ON TIME", artist: ROOT, duration: 2591, thumb: `/api/local/${fileId}/cover`, art: `/api/local/${fileId}/cover`, kind: "video", source: "local", year: 1980 };
    const tracks = segmentTracks(file, ROOT, RIDE, songs);
    assert.deepEqual(tracks[2], {
      id: segmentId(ROOT, RIDE, 3),
      title: "Silent Screamer",
      artist: ROOT,
      album: "RIDE ON TIME",
      duration: 329,
      thumb: file.thumb,
      art: file.art,
      kind: "song",
      source: "local",
      year: 1980,
    });
  });
});

describe("segment store", () => {
  it("saves, reloads, drops broken entries and makes a file whole with an empty list", async () => {
    const file = path.join(tmp, "store", "segments.json");
    const store = new SegmentStore(file);
    await store.load();
    assert.equal(store.get(ROOT, RIDE), undefined);
    await store.set(ROOT, RIDE, songs);
    const reloaded = new SegmentStore(file);
    await reloaded.load();
    assert.deepEqual(reloaded.get(ROOT, RIDE), songs);
    assert.deepEqual(reloaded.files(ROOT), [{ path: RIDE, songs: 3 }]);

    await writeFile(file, JSON.stringify({ [ROOT]: { [RIDE]: songs, "broken.mp4": [{ no: 1, start: 9, end: 1, title: "x" }] }, other: "x" }));
    await reloaded.load();
    assert.deepEqual(reloaded.files(ROOT), [{ path: RIDE, songs: 3 }]);

    await reloaded.set(ROOT, RIDE, []);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {});
  });
});

describe("split files in the music folders", () => {
  let local: typeof Local;
  const music = path.join(tmp, "music");
  const data = path.join(tmp, "data");
  const fileId = localId(ROOT, RIDE);
  const single = "[1986.06.06] Pocket Music.mp3";

  before(async () => {
    await mkdir(music, { recursive: true });
    await mkdir(data, { recursive: true });
    const files: Record<string, object> = {};
    for (const [name, probe] of [
      [RIDE, { duration: 2590.8, hasVideo: true, hasPicture: false, acodec: "aac", tags: {} }],
      [single, { duration: 300, hasVideo: false, hasPicture: false, acodec: "mp3", tags: {} }],
    ] as const) {
      await writeFile(path.join(music, name), "not really media");
      const s = await stat(path.join(music, name));
      files[name] = { size: s.size, mtimeMs: Math.round(s.mtimeMs), ...probe };
    }
    await writeFile(path.join(data, "local-index.json"), JSON.stringify({ version: 1, roots: { [ROOT]: { path: music, files } } }));
    await writeFile(path.join(data, "segments.json"), JSON.stringify({ [ROOT]: { [RIDE]: songs } }));
    process.env.MUSIKE_DATA_DIR = data;
    process.env.MUSIKE_CACHE_DIR = path.join(tmp, "cache");
    process.env.MUSIKE_LOCAL_DIRS = `${ROOT}=${music}`;
    process.env.MUSIKE_KEEP_DIR = path.join(tmp, "keep");
    // Imported only now: config.ts reads these variables when it loads.
    local = await import("../src/local.ts");
    await local.startLocal();
    await local.rescan();
  });
  after(() => local?.stopLocal());

  it("lists a split file's songs in its place, and keeps the whole file playable", () => {
    const albums = local.listAlbums(ROOT);
    const ride = albums.find((a) => a.key === RIDE)!;
    assert.equal(ride.name, "RIDE ON TIME");
    assert.equal(ride.year, 1980);
    assert.equal(ride.trackCount, 3);
    assert.equal(ride.duration, 349 + 271 + 329);
    assert.equal(ride.cover, `/api/local/${fileId}/cover`);

    const { tracks } = local.getAlbum(ROOT, RIDE);
    assert.deepEqual(tracks.map((t) => [t.id, t.title, t.kind]), songs.map((s) => [segmentId(ROOT, RIDE, s.no), s.title, "song"]));

    const all = local.searchLocal("", ROOT, 100).map((t) => t.id);
    assert.ok(!all.includes(fileId), "the whole file leaves the listing");
    assert.ok(all.includes(localId(ROOT, single)), "unsplit files stay");
    assert.deepEqual(local.searchLocal("screamer", undefined, 10).map((t) => t.id), [segmentId(ROOT, RIDE, 3)]);

    // A playlist that holds the whole file still finds and plays it.
    assert.equal(local.localTrack(fileId)?.title, "RIDE ON TIME");
    assert.equal(local.audioMode(fileId), "offset");
    assert.equal(local.localInfo(fileId).hasVideo, true);
  });

  it("plays a song as sound only, from an offset", () => {
    const id = segmentId(ROOT, RIDE, 2);
    assert.equal(local.audioMode(id), "offset");
    assert.equal(local.localInfo(id).hasVideo, false);
    assert.equal(local.localInfo(id).track.duration, 271);
    assert.equal(local.audioMode(localId(ROOT, single)), "range");
  });

  it("hides the songs with their file", async () => {
    await local.hide({ ids: [fileId] });
    assert.equal(local.listAlbums(ROOT).find((a) => a.key === RIDE), undefined);
    assert.equal(local.searchLocal("screamer", undefined, 10).length, 0);
    await local.unhide({ ids: [fileId] });
    assert.equal(local.listAlbums(ROOT).find((a) => a.key === RIDE)?.trackCount, 3);
  });

  it("reads and replaces a file's songs through the segments API", async () => {
    assert.deepEqual(local.getSegments(ROOT), { root: ROOT, files: [{ path: RIDE, songs: 3 }] });
    const got = local.getSegments(ROOT, RIDE);
    assert.equal(got.id, fileId);
    assert.deepEqual(got.segments?.map((s) => s.id), songs.map((s) => segmentId(ROOT, RIDE, s.no)));
    assert.throws(() => local.getSegments(ROOT, "missing.mp4"), HttpError);

    await assert.rejects(local.setSegments(ROOT, RIDE, [{ no: 1, start: 0, end: 9999, title: "too long" }]), HttpError);
    const fixed = songs.map((s) => (s.no === 2 ? { ...s, title: "DAYDREAM", end: 620 } : s.no === 3 ? { ...s, start: 620 } : s));
    await local.setSegments(ROOT, RIDE, fixed);
    const { tracks } = local.getAlbum(ROOT, RIDE);
    assert.equal(tracks[1].id, segmentId(ROOT, RIDE, 2), "a fixed song keeps its ID");
    assert.equal(tracks[1].title, "DAYDREAM");
    assert.deepEqual(JSON.parse(await readFile(path.join(data, "segments.json"), "utf8"))[ROOT][RIDE][1].end, 620);

    await local.setSegments(ROOT, RIDE, []);
    assert.deepEqual(local.getAlbum(ROOT, RIDE).tracks.map((t) => t.id), [fileId], "an empty list makes the file whole again");
  });
});
