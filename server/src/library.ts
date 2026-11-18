import { msg } from "./i18n.js";
import { BUNDLE_ID, HttpError, isBundleId, isLocalId, TRACK_ID, type Bundle, type Library, type Playlist, type Track } from "./types.js";

// No Node-only imports here: the Android app runs this same module, with its own storage.

const HISTORY_LIMIT = 60;

/** Where the library is kept: a file on the server and the desktop app, app storage on Android. */
export interface LibraryStorage {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
}

let storage: LibraryStorage | null = null;
let state: Library | null = null;
let writeChain: Promise<void> = Promise.resolve();

/** Set once at startup, before any request. */
export function useLibraryStorage(s: LibraryStorage) {
  storage = s;
  state = null;
}

const randomUUID = () => globalThis.crypto.randomUUID();

async function load(): Promise<Library> {
  if (state) return state;
  if (!storage) throw new Error("Library storage not configured");
  const json = await storage.read();
  state = json ? (JSON.parse(json) as Library) : { favorites: [], playlists: [], history: [] };
  return state;
}

/** Serialized writes so concurrent requests never interleave. */
function persist(): Promise<void> {
  const snapshot = JSON.stringify(state, null, 2);
  writeChain = writeChain.then(() => storage!.write(snapshot));
  return writeChain;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function sanitizeTrack(input: unknown): Track {
  const t = (input ?? {}) as Record<string, unknown>;
  const id = str(t.id, 21);
  if (!TRACK_ID.test(id)) throw new HttpError(400, msg("invalidTrack"));
  const url = (v: unknown) => {
    const s = str(v, 500);
    // Local covers are served by this same server (relative URL).
    return /^https:\/\//.test(s) || /^\/api\/local\/L[A-Za-z0-9_-]{20}\/cover$/.test(s) ? s : "";
  };
  const year = typeof t.year === "number" && Number.isInteger(t.year) && t.year > 1000 && t.year < 3000 ? t.year : undefined;
  return {
    id,
    title: str(t.title, 300) || "Untitled",
    artist: str(t.artist, 300),
    album: str(t.album, 300) || undefined,
    duration: typeof t.duration === "number" && Number.isFinite(t.duration) ? Math.max(0, Math.round(t.duration)) : 0,
    thumb: url(t.thumb),
    art: url(t.art),
    // A bundle row in a playlist is a reference: its parts live in the library's `bundles`.
    kind: isBundleId(id) ? "bundle" : t.kind === "video" ? "video" : "song",
    ...(isLocalId(id) ? { source: "local" as const } : {}),
    ...(year ? { year } : {}),
  };
}

/** Track bodies to store: a performance row of the taste lists (`work.parts`, works.ts; never stored) is its movements. */
export function storedBodies(input: unknown[]): unknown[] {
  return input.flatMap((raw) => {
    const parts = (raw as { work?: { parts?: unknown } } | null)?.work?.parts;
    return Array.isArray(parts) ? parts : [raw];
  });
}

function findPlaylist(lib: Library, pid: string): Playlist {
  const p = lib.playlists.find((x) => x.id === pid);
  if (!p) throw new HttpError(404, msg("playlistNotFound"));
  return p;
}

export async function getLibrary(): Promise<Library> {
  return load();
}

export async function addFavorite(track: Track): Promise<Track[]> {
  const lib = await load();
  lib.favorites = [track, ...lib.favorites.filter((t) => t.id !== track.id)];
  await persist();
  return lib.favorites;
}

/** Adds many at once (in the given order, on top), skipping ones already there. */
export async function addFavorites(tracks: Track[]): Promise<Track[]> {
  const lib = await load();
  const seen = new Set(lib.favorites.map((t) => t.id));
  const added = tracks.filter((t) => !seen.has(t.id) && !!seen.add(t.id));
  lib.favorites = [...added, ...lib.favorites];
  await persist();
  return lib.favorites;
}

export async function removeFavorite(id: string): Promise<Track[]> {
  const lib = await load();
  lib.favorites = lib.favorites.filter((t) => t.id !== id);
  await persist();
  return lib.favorites;
}

export async function pushHistory(track: Track): Promise<Track[]> {
  const lib = await load();
  lib.history = [track, ...lib.history.filter((t) => t.id !== track.id)].slice(0, HISTORY_LIMIT);
  await persist();
  return lib.history;
}

export async function createPlaylist(name: string, tracks: Track[] = []): Promise<Playlist> {
  const lib = await load();
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new HttpError(400, msg("playlistNameRequired"));
  const now = Date.now();
  const playlist: Playlist = { id: randomUUID(), name: clean, createdAt: now, updatedAt: now, tracks };
  lib.playlists.unshift(playlist);
  await persist();
  return playlist;
}

export async function renamePlaylist(pid: string, name: string): Promise<Playlist> {
  const lib = await load();
  const p = findPlaylist(lib, pid);
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new HttpError(400, msg("playlistNameRequired"));
  p.name = clean;
  p.updatedAt = Date.now();
  await persist();
  return p;
}

export async function deletePlaylist(pid: string): Promise<void> {
  const lib = await load();
  findPlaylist(lib, pid);
  lib.playlists = lib.playlists.filter((p) => p.id !== pid);
  await persist();
}

/**
 * Appends tracks to a playlist. By default a track already in it (or twice in `tracks`) is skipped;
 * `duplicates: true` adds every one, as asked.
 */
export async function addToPlaylist(pid: string, tracks: Track | Track[], opts: { duplicates?: boolean } = {}): Promise<Playlist> {
  const lib = await load();
  const p = findPlaylist(lib, pid);
  const have = new Set(p.tracks.map((t) => t.id));
  for (const track of Array.isArray(tracks) ? tracks : [tracks]) {
    if (!opts.duplicates && have.has(track.id)) continue;
    have.add(track.id);
    p.tracks.push(track);
  }
  p.updatedAt = Date.now();
  await persist();
  return p;
}

export async function removeFromPlaylist(pid: string, trackId: string): Promise<Playlist> {
  const lib = await load();
  const p = findPlaylist(lib, pid);
  p.tracks = p.tracks.filter((t) => t.id !== trackId);
  p.updatedAt = Date.now();
  await persist();
  return p;
}

/**
 * Removes the rows at `at` (0-based). `ids[k]` must be the track at `at[k]`, so a list changed elsewhere
 * meanwhile is refused instead of losing the wrong rows; one copy of a twice-added track can go alone.
 */
export async function removePositions(pid: string, at: unknown, ids: unknown): Promise<Playlist> {
  const lib = await load();
  const p = findPlaylist(lib, pid);
  const ok =
    Array.isArray(at) &&
    Array.isArray(ids) &&
    at.length === ids.length &&
    at.every((n, k) => Number.isInteger(n) && p.tracks[n as number]?.id === ids[k]);
  if (!ok) throw new HttpError(409, msg("positionsChanged"));
  const drop = new Set(at as number[]);
  p.tracks = p.tracks.filter((_, i) => !drop.has(i));
  p.updatedAt = Date.now();
  await persist();
  return p;
}

/** True when `ids` holds exactly the playlist's current track IDs (as many times each), in any order. */
export function isPermutation(current: string[], ids: unknown): ids is string[] {
  if (!Array.isArray(ids) || ids.length !== current.length) return false;
  const left = new Map<string, number>();
  for (const id of current) left.set(id, (left.get(id) ?? 0) + 1);
  for (const id of ids) {
    const n = typeof id === "string" ? left.get(id) : undefined;
    if (!n) return false;
    left.set(id, n - 1);
  }
  return true;
}

/** Puts the playlist's tracks in the given order; `ids` must be a permutation of the current IDs. */
export async function reorderPlaylist(pid: string, ids: unknown): Promise<Playlist> {
  const lib = await load();
  const p = findPlaylist(lib, pid);
  if (!isPermutation(p.tracks.map((t) => t.id), ids)) throw new HttpError(400, msg("notPermutation"));
  // A track added twice: each copy keeps its own entry, taken in order.
  const byId = new Map<string, Track[]>();
  for (const t of p.tracks) byId.set(t.id, [...(byId.get(t.id) ?? []), t]);
  p.tracks = ids.map((id) => byId.get(id)!.shift()!);
  p.updatedAt = Date.now();
  await persist();
  return p;
}

// Backup import: a library exported from any Musike instance (web, desktop, another computer).

const MAX_PLAYLISTS = 1000;
const MAX_TRACKS = 5000;

/** Keeps the valid tracks of an untrusted list, without duplicates. */
function cleanTracks(input: unknown, limit = MAX_TRACKS): Track[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const raw of input.slice(0, limit * 2)) {
    try {
      const t = sanitizeTrack(raw);
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
      if (out.length >= limit) break;
    } catch {
      // skip invalid entries instead of rejecting the whole backup
    }
  }
  return out;
}

function cleanLibrary(input: unknown): Library {
  const lib = (input ?? {}) as Record<string, unknown>;
  const playlists = (Array.isArray(lib.playlists) ? lib.playlists : []).slice(0, MAX_PLAYLISTS).flatMap((raw): Playlist[] => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = str(p.name, 80).trim();
    if (!name) return [];
    const now = Date.now();
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : now);
    const id = str(p.id, 64);
    return [{ id: /^[\w-]{8,64}$/.test(id) ? id : randomUUID(), name, createdAt: num(p.createdAt), updatedAt: num(p.updatedAt), tracks: cleanTracks(p.tracks) }];
  });
  const bundles = (Array.isArray(lib.bundles) ? lib.bundles : []).slice(0, MAX_PLAYLISTS).flatMap((raw): Bundle[] => {
    const b = (raw ?? {}) as Record<string, unknown>;
    const id = str(b.id, 21);
    const title = str(b.title, 200).trim();
    const parts = cleanTracks(b.parts, MAX_PARTS).filter((t) => t.kind !== "bundle");
    if (!BUNDLE_ID.test(id) || !title || !parts.length) return [];
    return [{ id, title, ...(str(b.artist, 300).trim() ? { artist: str(b.artist, 300).trim() } : {}), parts, tags: cleanTags(b.tags) }];
  });
  return { favorites: cleanTracks(lib.favorites), playlists, history: cleanTracks(lib.history, HISTORY_LIMIT), bundles };
}

export interface ImportResult {
  playlistsAdded: number;
  playlistsMerged: number;
  tracksAdded: number;
  favoritesAdded: number;
}

/**
 * "merge" adds what is missing and never deletes (playlists match by id, then by name).
 * "replace" swaps the whole library for the backup's.
 */
export async function importLibrary(input: unknown, mode: "merge" | "replace"): Promise<ImportResult> {
  const incoming = cleanLibrary(input);
  const lib = await load();
  const result: ImportResult = { playlistsAdded: 0, playlistsMerged: 0, tracksAdded: 0, favoritesAdded: 0 };

  if (mode === "replace") {
    state = incoming;
    result.playlistsAdded = incoming.playlists.length;
    result.favoritesAdded = incoming.favorites.length;
    result.tracksAdded = incoming.playlists.reduce((n, p) => n + p.tracks.length, 0);
    await persist();
    return result;
  }

  const union = (mine: Track[], theirs: Track[]) => {
    const have = new Set(mine.map((t) => t.id));
    const added = theirs.filter((t) => !have.has(t.id));
    return { list: [...mine, ...added], added: added.length };
  };

  const fav = union(lib.favorites, incoming.favorites);
  lib.favorites = fav.list;
  result.favoritesAdded = fav.added;

  for (const p of incoming.playlists) {
    const match =
      lib.playlists.find((x) => x.id === p.id) ??
      lib.playlists.find((x) => x.name.toLocaleLowerCase("pt-BR") === p.name.toLocaleLowerCase("pt-BR"));
    if (match) {
      const merged = union(match.tracks, p.tracks);
      if (!merged.added) continue; // already had every track: nothing changed
      match.tracks = merged.list.slice(0, MAX_TRACKS);
      match.updatedAt = Date.now();
      result.tracksAdded += merged.added;
      result.playlistsMerged++;
    } else {
      lib.playlists.push(p);
      result.tracksAdded += p.tracks.length;
      result.playlistsAdded++;
    }
  }

  lib.history = union(lib.history, incoming.history).list.slice(0, HISTORY_LIMIT);
  const bundles = (lib.bundles ??= []);
  for (const b of incoming.bundles ?? []) if (!bundles.some((x) => x.id === b.id)) bundles.push(b);
  await persist();
  return result;
}

// Tags: short free-form labels ("작품:Asayake", "편곡:브라스") on tracks and bundles. What they mean is up to the agent.

const MAX_TAGS = 30;

/** Trimmed, single-spaced, at most 80 characters each, no duplicates. */
export function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    const tag = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// Bundles: several tracks played in order as one row. Playlists, favorites and history hold a reference track
// (kind "bundle", the bundle's id); the parts are here.

const MAX_PARTS = 200;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function newBundleId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
  return "B" + Array.from(bytes, (b) => BASE64URL[b & 63]).join("");
}

/** The row that stands for a bundle in lists: its title, the parts' total length and the first part's cover. */
export function bundleTrack(b: Bundle): Track {
  const first = b.parts[0];
  return {
    id: b.id,
    title: b.title,
    artist: b.artist ?? first?.artist ?? "",
    duration: b.parts.reduce((n, t) => n + t.duration, 0),
    thumb: first?.thumb ?? "",
    art: first?.art ?? "",
    kind: "bundle",
  };
}

function findBundle(lib: Library, id: string): Bundle {
  const b = lib.bundles?.find((x) => x.id === id);
  if (!b) throw new HttpError(404, msg("bundleNotFound"));
  return b;
}

export async function getBundle(id: string): Promise<Bundle> {
  return findBundle(await load(), id);
}

export interface BundleInput {
  title?: string;
  artist?: string;
  parts?: Track[];
  tags?: string[];
}

function checkParts(parts: Track[]): Track[] {
  if (!parts.length || parts.length > MAX_PARTS || parts.some((t) => t.kind === "bundle")) throw new HttpError(400, msg("bundlePartsRequired"));
  return parts;
}

export async function createBundle(input: BundleInput): Promise<Bundle> {
  const lib = await load();
  const title = (input.title ?? "").trim().slice(0, 200);
  if (!title) throw new HttpError(400, msg("bundleTitleRequired"));
  const artist = input.artist?.trim().slice(0, 300);
  const bundle: Bundle = { id: newBundleId(), title, ...(artist ? { artist } : {}), parts: checkParts(input.parts ?? []), tags: cleanTags(input.tags) };
  (lib.bundles ??= []).unshift(bundle);
  await persist();
  return bundle;
}

/** Rows that stand for a bundle elsewhere follow its new title, artist and cover. */
function refreshRefs(lib: Library, b: Bundle) {
  const row = bundleTrack(b);
  const swap = (list: Track[]) => list.map((t) => (t.id === b.id ? row : t));
  lib.favorites = swap(lib.favorites);
  lib.history = swap(lib.history);
  for (const p of lib.playlists) p.tracks = swap(p.tracks);
}

/** Changes the given fields; `artist: ""` removes the artist. */
export async function updateBundle(id: string, input: BundleInput): Promise<Bundle> {
  const lib = await load();
  const b = findBundle(lib, id);
  if (input.title !== undefined) {
    const title = input.title.trim().slice(0, 200);
    if (!title) throw new HttpError(400, msg("bundleTitleRequired"));
    b.title = title;
  }
  if (input.artist !== undefined) {
    const artist = input.artist.trim().slice(0, 300);
    if (artist) b.artist = artist;
    else delete b.artist;
  }
  if (input.parts) b.parts = checkParts(input.parts);
  if (input.tags) b.tags = cleanTags(input.tags);
  refreshRefs(lib, b);
  await persist();
  return b;
}

/** Deletes a bundle and its rows in playlists, favorites and history (the parts themselves stay where they are). */
export async function deleteBundle(id: string): Promise<void> {
  const lib = await load();
  findBundle(lib, id);
  lib.bundles = lib.bundles!.filter((b) => b.id !== id);
  lib.favorites = lib.favorites.filter((t) => t.id !== id);
  lib.history = lib.history.filter((t) => t.id !== id);
  for (const p of lib.playlists) p.tracks = p.tracks.filter((t) => t.id !== id);
  await persist();
}

/** Applies `change` to the tags of the bundles among `ids`; returns the ids that were bundles. */
export async function editBundleTags(ids: string[], change: (tags: string[]) => string[]): Promise<string[]> {
  const lib = await load();
  const done: string[] = [];
  for (const b of lib.bundles ?? []) {
    if (!ids.includes(b.id)) continue;
    b.tags = cleanTags(change(b.tags));
    done.push(b.id);
  }
  if (done.length) await persist();
  return done;
}

/**
 * Puts `track` wherever `oldId` is in playlists (same rows), favorites (same place, once) and bundle parts; history
 * stays as it was played. Returns how many rows changed.
 */
export function replaceIn(lib: Library, oldId: string, track: Track): number {
  let n = 0;
  const swap = (list: Track[]) =>
    list.map((t) => {
      if (t.id !== oldId) return t;
      n++;
      return track;
    });
  for (const p of lib.playlists) {
    const before = n;
    p.tracks = swap(p.tracks);
    if (n > before) p.updatedAt = Date.now();
  }
  const seen = new Set<string>();
  lib.favorites = swap(lib.favorites).filter((t) => !seen.has(t.id) && !!seen.add(t.id));
  for (const b of lib.bundles ?? []) {
    const before = n;
    b.parts = swap(b.parts);
    if (n > before) refreshRefs(lib, b);
  }
  return n;
}

/** `replaceIn` in the stored library. */
export async function replaceTrack(oldId: string, track: Track): Promise<number> {
  const lib = await load();
  const n = replaceIn(lib, oldId, track);
  if (n) await persist();
  return n;
}
