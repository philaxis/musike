import { artistKey, type Taste, type TasteSong } from "./taste.js";
import type { Track } from "./types.js";

// Albums, composers and performances of the taste analysis (#26): which of my tracks (song box, music folders) belong
// together. A performance (`instance`) is one recording of one work: the same string for its movements, a different
// one for another performer or album, so two versions never mix. `? | …` (composer unknown) is grouped the same way.

/** What the analysis says about a track's work; any of it may be missing. */
export interface WorkFields {
  composer?: string | null;
  work?: string | null;
  album?: string | null;
  movement?: { n?: number | null; title?: string | null } | null;
  instance?: string | null;
}

type Song = TasteSong & WorkFields;

export interface Works {
  taste: Taste;
  /** Playable tracks by ID: only these are grouped. */
  known: Map<string, Track>;
  /** Album key → song indexes, performances together in movement order, otherwise in the analysis' order. */
  albums: Map<string, number[]>;
  albumOf: Map<number, string>;
  /** Performance → song indexes in movement order. */
  instances: Map<string, number[]>;
}

const song = (taste: Taste, i: number) => taste.songs[i] as Song;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const movementNo = (s: Song) => (Number.isFinite(s.movement?.n) ? (s.movement!.n as number) : null);

/** Numbered movements first (by number), then the rest by title; ties keep the analysis' order. */
export function movementOrder(works: Pick<Works, "taste" | "known">) {
  const title = (i: number) => works.known.get(works.taste.songs[i].id)?.title ?? song(works.taste, i).movement?.title ?? "";
  return (x: number, y: number) => {
    const a = movementNo(song(works.taste, x));
    const b = movementNo(song(works.taste, y));
    if (a !== null && b !== null) return a - b || x - y;
    if (a !== null || b !== null) return a === null ? 1 : -1;
    return title(x).localeCompare(title(y), undefined, { numeric: true }) || x - y;
  };
}

/** An album's songs: each performance together in movement order, at the place of its first song. */
function albumOrder(works: Pick<Works, "taste" | "known">, ids: number[]): number[] {
  const groups = new Map<string, number[]>();
  for (const i of ids) {
    const key = text(song(works.taste, i).instance) ?? `#${i}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const order = movementOrder(works);
  return [...groups.values()].sort((a, b) => Math.min(...a) - Math.min(...b)).flatMap((g) => g.sort(order));
}

export function buildWorks(taste: Taste, known: Map<string, Track>): Works {
  const byName = new Map<string, Map<string, number[]>>();
  const instances = new Map<string, number[]>();
  taste.songs.forEach((s0, i) => {
    const track = known.get(s0.id);
    if (!track) return;
    const s = s0 as Song;
    const album = text(s.album);
    if (album) {
      const artists = byName.get(album) ?? new Map<string, number[]>();
      const a = artistKey(track.artist ?? "");
      artists.set(a, [...(artists.get(a) ?? []), i]);
      byName.set(album, artists);
    }
    const inst = text(s.instance);
    if (inst) instances.set(inst, [...(instances.get(inst) ?? []), i]);
  });
  const works = { taste, known };
  const albums = new Map<string, number[]>();
  for (const [name, artists] of byName) {
    // A common name ("Greatest Hits") with one track per artist is several albums; a compilation keeps together.
    const split = artists.size > 1 && [...artists.values()].every((ids) => ids.length === 1);
    if (split) for (const [a, ids] of artists) albums.set(`${name}\t${a}`, ids);
    else albums.set(name, [...artists.values()].flat().sort((x, y) => x - y));
  }
  const albumOf = new Map<number, string>();
  for (const [key, ids] of albums) {
    albums.set(key, albumOrder(works, ids));
    for (const i of ids) albumOf.set(i, key);
  }
  const order = movementOrder(works);
  for (const ids of instances.values()) ids.sort(order);
  return { taste, known, albums, albumOf, instances };
}

export const albumName = (key: string) => key.split("\t")[0];

/** Composer, work, performer and album of a performance, from its `composer | work | performer | album` string. */
export function parseInstance(key: string) {
  const [composer = "", work = "", performer = "", ...album] = key.split("|").map((part) => part.trim());
  return { composer: composer && composer !== "?" ? composer : null, work, performer, album: album.join(" | ") };
}

export interface TrackWorks {
  album: { key: string; name: string; count: number } | null;
  composer: string | null;
  instance: { key: string; work: string; performer: string; count: number } | null;
}

export const NO_WORKS: TrackWorks = { album: null, composer: null, instance: null };

/** Where a track leads: its album, composer and performance, each only when the analysis has it. */
export function trackWorks(works: Works, id: string): TrackWorks {
  const i = works.taste.index.get(id);
  if (i === undefined) return NO_WORKS;
  const s = song(works.taste, i);
  const albumKey = works.albumOf.get(i);
  const inst = text(s.instance);
  const members = inst ? works.instances.get(inst) : undefined;
  return {
    album: albumKey ? { key: albumKey, name: albumName(albumKey), count: works.albums.get(albumKey)!.length } : null,
    composer: text(s.composer),
    instance: inst && members ? { key: inst, work: text(s.work) ?? parseInstance(inst).work, performer: parseInstance(inst).performer, count: members.length } : null,
  };
}

const tracksOf = (works: Works, ids: number[]) => ids.map((i) => works.known.get(works.taste.songs[i].id)!);

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n >= 4000) return String(n);
  let out = "";
  for (const [value, letters] of ROMAN) for (; n >= value; n -= value) out += letters;
  return out;
}

/**
 * What a list row calls a movement: "II. Adagio" (the number in Roman numerals). Without the movement's own name,
 * the track title with the work's part taken off ("Brahms: Violin Sonata No. 3 …: II. Adagio" → "Adagio"). Null
 * for a track the analysis gives no movement.
 */
export function movementTitle(works: Pick<Works, "taste" | "known">, i: number): string | null {
  const s = song(works.taste, i);
  if (!s.movement) return null;
  let name = text(s.movement.title);
  if (!name) {
    const title = works.known.get(s.id)?.title ?? "";
    const work = text(s.work);
    const at = work ? title.toLocaleLowerCase().indexOf(work.toLocaleLowerCase()) : -1;
    const rest = at >= 0 ? title.slice(at + work!.length) : title.includes(": ") ? title.slice(title.lastIndexOf(": ") + 2) : "";
    name = text(rest.replace(/^[\s:,–-]+/, "").replace(/^([IVXLC]+|\d+)[.:)]\s*/i, ""));
  }
  const n = movementNo(s);
  if (n === null) return name;
  return name ? `${roman(n)}. ${name}` : null;
}

/**
 * Row titles of the tracks with a movement, by track ID; `withWork` adds the work after it (an album of several works,
 * where "II. Adagio" alone wouldn't say which).
 */
function titlesOf(works: Works, ids: number[], withWork = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of ids) {
    const label = movementTitle(works, i);
    const work = text(song(works.taste, i).work);
    if (label) out[works.taste.songs[i].id] = withWork && work ? `${label} · ${work}` : label;
  }
  return out;
}

export function albumTracks(works: Works, key: string) {
  const ids = works.albums.get(key) ?? [];
  const several = new Set(ids.map((i) => text(song(works.taste, i).work)).filter(Boolean)).size > 1;
  return { tracks: tracksOf(works, ids), titles: titlesOf(works, ids, several) };
}

export function instanceTracks(works: Works, key: string) {
  const ids = works.instances.get(key) ?? [];
  return { tracks: tracksOf(works, ids), titles: titlesOf(works, ids) };
}

/** Composers of my tracks (of one genre, if given), most tracks first, with how many works and four tracks for a cover. */
export function composerList(works: Works, genre?: string) {
  const by = new Map<string, { ids: number[]; works: Set<string>; covers: Map<string, number> }>();
  works.taste.songs.forEach((s0, i) => {
    const s = s0 as Song;
    const name = text(s.composer);
    if (!name || !works.known.has(s.id) || (genre && s.genre !== genre)) return;
    const c = by.get(name) ?? { ids: [] as number[], works: new Set<string>(), covers: new Map<string, number>() };
    c.ids.push(i);
    const work = text(s.work);
    if (work) c.works.add(work);
    // One track per album, so the cover shows four different ones where there are.
    const album = works.albumOf.get(i) ?? s.id;
    if (c.covers.size < 4 && !c.covers.has(album)) c.covers.set(album, i);
    by.set(name, c);
  });
  return [...by]
    .sort((a, b) => b[1].ids.length - a[1].ids.length || a[0].localeCompare(b[0]))
    .map(([name, c]) => ({ name, count: c.ids.length, works: c.works.size, tracks: tracksOf(works, [...c.covers.values()]) }));
}

/** One composer: works (most tracks first), each with its performances (most tracks first); tracks without a work after. */
export function composerWorks(works: Works, name: string) {
  const byWork = new Map<string, Map<string, number[]>>();
  const others: number[] = [];
  let count = 0;
  works.taste.songs.forEach((s0, i) => {
    const s = s0 as Song;
    if (text(s.composer) !== name || !works.known.has(s.id)) return;
    count++;
    const work = text(s.work);
    const inst = text(s.instance);
    if (!work || !inst) return void others.push(i);
    const perfs = byWork.get(work) ?? new Map<string, number[]>();
    perfs.set(inst, works.instances.get(inst) ?? [i]);
    byWork.set(work, perfs);
  });
  if (!count) return null;
  const titles: Record<string, string> = {};
  const list = [...byWork].map(([work, perfs]) => {
    const instances = [...perfs]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([key, ids]) => {
        const p = parseInstance(key);
        Object.assign(titles, titlesOf(works, ids));
        return { key, performer: p.performer, album: p.album, tracks: tracksOf(works, ids) };
      });
    return { work, count: instances.reduce((n, p) => n + p.tracks.length, 0), instances };
  });
  list.sort((a, b) => b.count - a.count || a.work.localeCompare(b.work));
  return { composer: name, count, works: list, others: tracksOf(works, others), titles };
}
