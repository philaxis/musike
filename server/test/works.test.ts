import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import * as box from "../src/box.ts";
import { config } from "../src/config.ts";
import * as library from "../src/library.ts";
import { EMPTY_TASTE, parseTaste } from "../src/taste.ts";
import type { Track } from "../src/types.ts";
import { registerWorkRoutes } from "../src/workRoutes.ts";
import {
  albumTracks,
  buildWorks,
  composerList,
  composerWorks,
  instanceTracks,
  NO_WORKS,
  parseInstance,
  trackWorks,
  type WorkFields,
} from "../src/works.ts";

const vid = (n: number) => `vid${String(n).padStart(8, "0")}`;
const BRAHMS = "Johannes Brahms | Violin Sonata No. 3 in D minor, Op. 108 | Pinchas Zukerman | Brahms: The Violin Sonatas";
const OTHER = "Johannes Brahms | Violin Sonata No. 3 in D minor, Op. 108 | Anne-Sophie Mutter | Brahms: Violin Sonatas";
const UNKNOWN = "? | Suite for Piano and Orchestra | Dmitry Masleev | Rapid Movement";

interface Row extends WorkFields {
  title: string;
  artist?: string;
}

/** Songs of a made-up analysis, all playable, the n-th with ID vid(n). */
function sample(rows: Row[]) {
  const json = JSON.stringify({
    songs: rows.map(({ title: _t, artist: _a, ...w }, n) => ({ id: vid(n), genre: w.composer ? "클래식" : "재즈", a: -1, t: -1, ...w })),
  });
  const taste = parseTaste(json, null, null);
  const known = new Map<string, Track>(
    rows.map((r, n) => [vid(n), { id: vid(n), title: r.title, artist: r.artist ?? "Zukerman", duration: 60, thumb: "", art: "", kind: "song" }]),
  );
  return buildWorks(taste, known);
}

const sonata = (n: number | null, title: string, instance = BRAHMS): Row => ({
  title,
  composer: "Johannes Brahms",
  work: "Violin Sonata No. 3 in D minor, Op. 108",
  album: instance === BRAHMS ? "Brahms: The Violin Sonatas" : "Brahms: Violin Sonatas",
  movement: n === null ? null : { n, title },
  instance,
  artist: instance === BRAHMS ? "Pinchas Zukerman" : "Anne-Sophie Mutter",
});

describe("works: performances", () => {
  it("orders movements by number, unnumbered ones after by title", () => {
    const works = sample([sonata(2, "Adagio"), sonata(null, "Coda"), sonata(4, "Presto agitato"), sonata(null, "Bonus"), sonata(1, "Allegro")]);
    assert.deepEqual(
      instanceTracks(works, BRAHMS).tracks.map((t) => t.title),
      ["Allegro", "Adagio", "Presto agitato", "Bonus", "Coda"],
    );
  });

  it("never mixes two performances of one work", () => {
    const works = sample([sonata(1, "Allegro"), sonata(1, "Allegro (Mutter)", OTHER), sonata(2, "Adagio"), sonata(2, "Adagio (Mutter)", OTHER)]);
    assert.deepEqual(instanceTracks(works, BRAHMS).tracks.map((t) => t.id), [vid(0), vid(2)]);
    assert.deepEqual(instanceTracks(works, OTHER).tracks.map((t) => t.id), [vid(1), vid(3)]);
    const page = composerWorks(works, "Johannes Brahms")!;
    assert.equal(page.works.length, 1);
    assert.deepEqual(
      page.works[0].instances.map((p) => [p.performer, p.tracks.length]),
      [
        ["Anne-Sophie Mutter", 2],
        ["Pinchas Zukerman", 2],
      ],
    );
  });

  it("keeps a performance of an unknown composer together, without a composer", () => {
    const row = (n: number): Row => ({ title: `Part ${n}`, work: "Suite for Piano and Orchestra", movement: { n }, instance: UNKNOWN });
    const works = sample([row(2), row(1)]);
    assert.deepEqual(instanceTracks(works, UNKNOWN).tracks.map((t) => t.title), ["Part 1", "Part 2"]);
    assert.deepEqual(trackWorks(works, vid(0)).instance, { key: UNKNOWN, work: "Suite for Piano and Orchestra", performer: "Dmitry Masleev", count: 2 });
    assert.equal(trackWorks(works, vid(0)).composer, null);
  });

  it("reads a performance without an album", () => {
    assert.deepEqual(parseInstance("Sergei Rachmaninoff | Rhapsody on a Theme of Paganini, Op. 43 | Arthur Rubinstein |"), {
      composer: "Sergei Rachmaninoff",
      work: "Rhapsody on a Theme of Paganini, Op. 43",
      performer: "Arthur Rubinstein",
      album: "",
    });
  });

  it("names a movement by its Roman number, else by the title without the work", () => {
    const works = sample([
      { ...sonata(2, "Adagio"), title: "Brahms: Violin Sonata No. 3 in D Minor, Op. 108: II. Adagio" },
      { ...sonata(4, "x"), movement: { n: 4 }, title: "Brahms: Violin Sonata No. 3 in D Minor, Op. 108: IV. Presto agitato" },
      { ...sonata(null, "Coda"), movement: { title: "Coda" } },
      sonata(null, "Bonus"),
    ]);
    const { tracks, titles } = instanceTracks(works, BRAHMS);
    assert.deepEqual(titles, { [vid(0)]: "II. Adagio", [vid(1)]: "IV. Presto agitato", [vid(2)]: "Coda" });
    // The tracks themselves keep their own titles (they go to the queue and playlists as they are).
    assert.equal(tracks[0].title, "Brahms: Violin Sonata No. 3 in D Minor, Op. 108: II. Adagio");
  });
});

describe("works: a track's links", () => {
  it("has none without an analysis, for a track it lacks, or with the fields empty", () => {
    assert.deepEqual(trackWorks(buildWorks(EMPTY_TASTE, new Map()), vid(0)), NO_WORKS);
    const works = sample([{ title: "Tune", composer: null, work: null, album: null, movement: null, instance: null }]);
    assert.deepEqual(trackWorks(works, vid(0)), NO_WORKS);
    assert.deepEqual(trackWorks(works, vid(9)), NO_WORKS);
  });

  it("counts the album's and the performance's tracks", () => {
    const works = sample([sonata(1, "Allegro"), sonata(2, "Adagio"), sonata(1, "Allegro (Mutter)", OTHER)]);
    const info = trackWorks(works, vid(1));
    assert.deepEqual(info.album, { key: "Brahms: The Violin Sonatas", name: "Brahms: The Violin Sonatas", count: 2 });
    assert.equal(info.composer, "Johannes Brahms");
    assert.equal(info.instance?.count, 2);
    assert.equal(trackWorks(works, vid(2)).instance?.count, 1);
  });
});

describe("works: albums and composers", () => {
  it("splits a common album name with one track per artist, keeps a compilation together", () => {
    const works = sample([
      { title: "Dream On", album: "Greatest Hits", artist: "Aerosmith" },
      { title: "Ghostbusters", album: "Greatest Hits", artist: "Ray Parker Jr." },
      { title: "Rhapsody", album: "Landscapes", artist: "Katia Labèque" },
      { title: "Prelude", album: "Landscapes", artist: "Alan Feinberg" },
      { title: "Concerto", album: "Landscapes", artist: "Katia Labèque" },
    ]);
    assert.equal(trackWorks(works, vid(0)).album?.count, 1);
    assert.equal(trackWorks(works, vid(0)).album?.name, "Greatest Hits");
    assert.notEqual(trackWorks(works, vid(0)).album?.key, trackWorks(works, vid(1)).album?.key);
    assert.deepEqual(albumTracks(works, "Landscapes").tracks.map((t) => t.title), ["Rhapsody", "Prelude", "Concerto"]);
  });

  it("keeps an album's performances together in movement order", () => {
    const works = sample([sonata(2, "Adagio"), { title: "Encore", album: "Brahms: The Violin Sonatas", artist: "Pinchas Zukerman" }, sonata(1, "Allegro")]);
    assert.deepEqual(albumTracks(works, "Brahms: The Violin Sonatas").tracks.map((t) => t.title), ["Allegro", "Adagio", "Encore"]);
  });

  it("adds the work to a movement's row title on an album of several works", () => {
    const first = "Johannes Brahms | Violin Sonata No. 1, Op. 78 | Pinchas Zukerman | Brahms: The Violin Sonatas";
    const works = sample([sonata(1, "Allegro"), { ...sonata(1, "Vivace"), work: "Violin Sonata No. 1, Op. 78", instance: first }]);
    assert.deepEqual(albumTracks(works, "Brahms: The Violin Sonatas").titles, {
      [vid(1)]: "I. Vivace · Violin Sonata No. 1, Op. 78",
      [vid(0)]: "I. Allegro · Violin Sonata No. 3 in D minor, Op. 108",
    });
  });

  it("lists composers by track count, of one genre if asked", () => {
    const works = sample([sonata(1, "Allegro"), sonata(2, "Adagio"), { title: "Song", composer: "Pat Metheny" }]);
    assert.deepEqual(composerList(works).map((c) => [c.name, c.count, c.works]), [
      ["Johannes Brahms", 2, 1],
      ["Pat Metheny", 1, 0],
    ]);
    assert.deepEqual(composerList(works, "클래식").map((c) => c.name), ["Johannes Brahms", "Pat Metheny"]);
    assert.deepEqual(composerList(works, "재즈").map((c) => c.name), []);
    assert.deepEqual(composerWorks(works, "Pat Metheny")?.others.map((t) => t.title), ["Song"]);
    assert.equal(composerWorks(works, "Nobody"), null);
  });
});

describe("works: API without an analysis", () => {
  it("answers with no links and no composers", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "musike-works-"));
    config.analysisDir = path.join(dir, "missing");
    config.dataDir = dir;
    const memory = () => {
      let json: string | null = null;
      return { read: async () => json, write: async (s: string) => void (json = s) };
    };
    library.useLibraryStorage(memory());
    box.useBoxStorage(memory());
    const app = Fastify();
    registerWorkRoutes(app);
    const get = async (url: string) => (await app.inject({ method: "GET", url })).json();
    assert.deepEqual(await get("/api/works/track/zvjItvrldIU"), { album: null, composer: null, instance: null });
    assert.deepEqual(await get("/api/works/composers"), { ready: false, composers: [] });
    assert.equal((await app.inject({ method: "GET", url: "/api/works/instance?key=x" })).statusCode, 404);
    await app.close();
  });
});
