import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { aliases } from "./ledger.js";

// The taste analysis (#26): per track a genre, a sound group, mood scores and two embeddings, written by the
// analysis worker into config.analysisDir (see openspec taste-mixes). Read whole into memory (a few thousand
// tracks, ~10 MB) and read again when a file changes. A missing or broken folder only empties the taste features.
//
// How alike two tracks are (the user's pick, "half sound, half description"):
//   0.5·cos(audio) + 0.5·cos(text); only the one both have when one is missing; neither: same group 0.6, same genre 0.4.

export interface TasteSong {
  id: string;
  genre: string;
  sub: string | null;
  era: string | null;
  year: number | null;
  moods: string[];
  scores: { energy: number; valence: number; acoustic: number; vocal: number } | null;
  group: string | null;
  /** Row in audio.f32 / text.f32, -1 when the track has none. */
  a: number;
  t: number;
}

export interface TasteGroup {
  id: string;
  genre: string;
  name: string;
  size: number;
}

export interface Taste {
  songs: TasteSong[];
  groups: TasteGroup[];
  index: Map<string, number>;
  audio: Float32Array | null;
  audioDim: number;
  text: Float32Array | null;
  textDim: number;
}

export const EMPTY_TASTE: Taste = { songs: [], groups: [], index: new Map(), audio: null, audioDim: 0, text: null, textDim: 0 };

/** Rows of little-endian float32 vectors; null when the bytes don't hold `rows`×`dim` of them. */
function matrix(buf: Buffer | null, rows: number, dim: number): Float32Array | null {
  if (!buf || !dim || !rows || buf.byteLength !== rows * dim * 4) return null;
  // A copy: Buffer slices aren't always 4-byte aligned.
  const out = new Float32Array(rows * dim);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

/** The analysis from the raw files; anything unreadable leaves that part empty. */
export function parseTaste(json: string | null, audio: Buffer | null, text: Buffer | null): Taste {
  let raw: { songs?: unknown; groups?: unknown; audioDim?: unknown; textDim?: unknown };
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {
    return EMPTY_TASTE;
  }
  if (!Array.isArray(raw.songs)) return EMPTY_TASTE;
  const songs = (raw.songs as TasteSong[]).filter((s) => s && typeof s.id === "string" && typeof s.genre === "string");
  for (const s of songs) {
    s.a = Number.isInteger(s.a) ? s.a : -1;
    s.t = Number.isInteger(s.t) ? s.t : -1;
    s.group ??= null;
    s.scores ??= null;
  }
  const audioDim = Number(raw.audioDim) || 0;
  const textDim = Number(raw.textDim) || 0;
  const rows = (key: "a" | "t") => songs.reduce((n, s) => Math.max(n, s[key] + 1), 0);
  const audioRows = audio && audioDim ? audio.byteLength / 4 / audioDim : 0;
  const textRows = text && textDim ? text.byteLength / 4 / textDim : 0;
  const audioM = rows("a") <= audioRows ? matrix(audio, audioRows, audioDim) : null;
  const textM = rows("t") <= textRows ? matrix(text, textRows, textDim) : null;
  const groups = Array.isArray(raw.groups) ? (raw.groups as TasteGroup[]).filter((g) => g && typeof g.id === "string") : [];
  return {
    songs,
    groups,
    index: new Map(songs.map((s, i) => [s.id, i])),
    audio: audioM,
    audioDim: audioM ? audioDim : 0,
    text: textM,
    textDim: textM ? textDim : 0,
  };
}

/**
 * Songs of videos that were replaced by another (the video ledger's alias map) as songs of the one in their place: the
 * same song, so its genre, group and vectors carry over until the analysis has the new video itself. Changes `taste`.
 */
export function aliasSongs(taste: Taste, resolve: (id: string) => string): Taste {
  taste.songs.forEach((s, i) => {
    const id = resolve(s.id);
    if (id === s.id || taste.index.has(id)) return;
    taste.index.delete(s.id);
    s.id = id;
    taste.index.set(id, i);
  });
  return taste;
}

const FILES = ["taste.json", "audio.f32", "text.f32"];
let cached: { key: string; taste: Taste } | null = null;
let loading: Promise<Taste> | null = null;

/** The current analysis, replaced videos followed; read again when a file's modification time or size, or the alias map, changed. */
export async function loadTaste(dir = config.analysisDir): Promise<Taste> {
  if (loading) return loading;
  loading = (async () => {
    const [stats, alias] = await Promise.all([Promise.all(FILES.map((f) => stat(path.join(dir, f)).catch(() => null))), aliases()]);
    const key = `${dir}|${stats.map((s) => (s ? `${s.mtimeMs}:${s.size}` : "-")).join("|")}|aliases:${alias.map.size ? alias.version : 0}`;
    if (cached?.key === key) return cached.taste;
    const [json, audio, text] = await Promise.all(FILES.map((f) => readFile(path.join(dir, f)).catch(() => null)));
    const taste = aliasSongs(parseTaste(json?.toString("utf8") ?? null, audio, text), alias.resolve);
    cached = { key, taste };
    return taste;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/** How alike two tracks are, from the cosines they can be compared by (null: one of the two lacks that vector). */
export function pairSim(audioCos: number | null, textCos: number | null, sameGroup: boolean, sameGenre: boolean): number {
  if (audioCos !== null && textCos !== null) return 0.5 * audioCos + 0.5 * textCos;
  if (audioCos !== null) return audioCos;
  if (textCos !== null) return textCos;
  return sameGroup ? 0.6 : sameGenre ? 0.4 : 0;
}

function dot(m: Float32Array, dim: number, row: number, v: Float32Array, at = 0): number {
  let s = 0;
  const o = row * dim;
  for (let k = 0; k < dim; k++) s += m[o + k] * v[at + k];
  return s;
}

/** How alike songs `i` and `j` are. */
export function simPair(taste: Taste, i: number, j: number): number {
  const x = taste.songs[i];
  const y = taste.songs[j];
  const audio = taste.audio && x.a >= 0 && y.a >= 0 ? dot(taste.audio, taste.audioDim, x.a, taste.audio, y.a * taste.audioDim) : null;
  const text = taste.text && x.t >= 0 && y.t >= 0 ? dot(taste.text, taste.textDim, x.t, taste.text, y.t * taste.textDim) : null;
  return pairSim(audio, text, !!x.group && x.group === y.group, x.genre === y.genre);
}

/** What other songs are compared with: one song's vectors, or the mean of several (whose dot is the mean cosine). */
export interface Probe {
  audio: Float32Array | null;
  text: Float32Array | null;
  groups: Set<string>;
  genres: Set<string>;
}

/** The (weighted) mean of the songs' vectors; a song without one vector only leaves that mean. */
export function probeOf(taste: Taste, songs: number[], weights?: number[]): Probe {
  const mean = (m: Float32Array | null, dim: number, key: "a" | "t") => {
    if (!m) return null;
    const v = new Float32Array(dim);
    let total = 0;
    songs.forEach((i, n) => {
      const row = taste.songs[i][key];
      if (row < 0) return;
      const w = weights?.[n] ?? 1;
      for (let k = 0; k < dim; k++) v[k] += w * m[row * dim + k];
      total += w;
    });
    if (!total) return null;
    for (let k = 0; k < dim; k++) v[k] /= total;
    return v;
  };
  return {
    audio: mean(taste.audio, taste.audioDim, "a"),
    text: mean(taste.text, taste.textDim, "t"),
    groups: new Set(songs.map((i) => taste.songs[i].group).filter((g): g is string => !!g)),
    genres: new Set(songs.map((i) => taste.songs[i].genre)),
  };
}

/** How alike every song is to the probe: all of them at once (a matrix-vector product per embedding). */
export function simsTo(taste: Taste, probe: Probe): Float32Array {
  const out = new Float32Array(taste.songs.length);
  taste.songs.forEach((s, j) => {
    const audio = probe.audio && s.a >= 0 ? dot(taste.audio!, taste.audioDim, s.a, probe.audio) : null;
    const text = probe.text && s.t >= 0 ? dot(taste.text!, taste.textDim, s.t, probe.text) : null;
    out[j] = pairSim(audio, text, !!s.group && probe.groups.has(s.group), probe.genres.has(s.genre));
  });
  return out;
}

/** Artist names compared loosely: case, spaces and YouTube's " - Topic" don't matter. */
export const artistKey = (artist: string) => artist.replace(/\s*-\s*Topic$/i, "").trim().toLocaleLowerCase();

export interface MmrOptions {
  /** How many to pick, besides those already `picked`. */
  count: number;
  /** Relevance against diversity: 1 only relevance, 0 only difference from what is picked. */
  lambda: number;
  /** Most tracks of one artist in the result, `picked` included. */
  perArtist: number;
  artistOf: (i: number) => string;
  /** Already in the list (the radio's seed); they count for diversity and the artist cap. */
  picked?: number[];
}

/**
 * Maximal marginal relevance: from `candidates`, repeatedly the one with the best λ·relevance − (1−λ)·(closest
 * likeness to anything picked), skipping artists that reached the cap.
 */
export function mmr(taste: Taste, candidates: number[], relevance: ArrayLike<number>, opts: MmrOptions): number[] {
  const picked = [...(opts.picked ?? [])];
  const perArtist = new Map<string, number>();
  const bump = (i: number) => {
    const a = artistKey(opts.artistOf(i));
    perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
  };
  picked.forEach(bump);
  const closest = new Map(candidates.map((c) => [c, picked.reduce((m, p) => Math.max(m, simPair(taste, c, p)), -Infinity)]));
  const out: number[] = [];
  const left = new Set(candidates.filter((c) => !picked.includes(c)));
  while (out.length < opts.count && left.size) {
    let best = -1;
    let bestScore = -Infinity;
    for (const c of left) {
      if ((perArtist.get(artistKey(opts.artistOf(c))) ?? 0) >= opts.perArtist) continue;
      const near = closest.get(c)!;
      const score = opts.lambda * relevance[c] - (1 - opts.lambda) * (near === -Infinity ? 0 : near);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best < 0) break;
    out.push(best);
    left.delete(best);
    bump(best);
    for (const c of left) closest.set(c, Math.max(closest.get(c)!, simPair(taste, c, best)));
  }
  return out;
}

export const RADIO_SIZE = 25;
const RADIO_POOL = 200;

/** A radio from one song: the song, then the most alike others picked for variety (MMR λ 0.75, 2 per artist). */
export function radio(taste: Taste, seed: number, available: (i: number) => boolean, artistOf: (i: number) => string): number[] {
  const rel = simsTo(taste, probeOf(taste, [seed]));
  const pool = taste.songs
    .map((_, i) => i)
    .filter((i) => i !== seed && available(i))
    .sort((x, y) => rel[y] - rel[x])
    .slice(0, RADIO_POOL);
  return [seed, ...mmr(taste, pool, rel, { count: RADIO_SIZE - 1, lambda: 0.75, perArtist: 2, artistOf, picked: [seed] })];
}

/** A small seeded random generator (mulberry32), so a day's mixes come out the same all day. */
export function seeded(text: string): () => number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWith<T>(list: T[], rand: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
