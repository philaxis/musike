import * as library from "./library.js";
import type { LibraryStorage } from "./library.js";
import * as local from "./local.js";
import { isBundleId, isLocalId, VIDEO_ID, type Track } from "./types.js";

// The song box: every YouTube track Musike has brought in (pasted playlist links, the connected account, links and
// searches added by the agent), with where each came from and its tags. It is not something to listen to in order;
// the agent sorts it into playlists. The local music folders show up in it as the "local" source without being
// stored here; only their tags are (`localTags`). Kept in data/box.json.

export type SourceKind = "youtube-playlist" | "youtube-liked" | "local" | "link" | "search";
export const SOURCE_KINDS: SourceKind[] = ["youtube-playlist", "youtube-liked", "local", "link", "search"];

export interface BoxSource {
  kind: SourceKind;
  /** Playlist ID, local root name; "" for links and searches. */
  ref: string;
  /** Playlist title, root name: what the app shows. */
  name: string;
  /** When it first came from here (ms). */
  at: number;
}

export interface BoxEntry {
  track: Track;
  sources: BoxSource[];
  tags: string[];
  addedAt: number;
  /** Deleted or made private on YouTube. Never removed from the box for that. */
  gone?: true;
}

interface BoxData {
  /** Newest first. */
  entries: BoxEntry[];
  /** Tags of local tracks, by track ID. */
  localTags: Record<string, string[]>;
}

const PAGE = 200;

let storage: LibraryStorage | null = null;
let state: BoxData | null = null;
let byId = new Map<string, BoxEntry>();
let writeChain: Promise<void> = Promise.resolve();

/** Set once at startup, before any request. */
export function useBoxStorage(s: LibraryStorage) {
  storage = s;
  state = null;
}

async function load(): Promise<BoxData> {
  if (state) return state;
  if (!storage) throw new Error("Box storage not configured");
  const json = await storage.read();
  const data = (json ? JSON.parse(json) : {}) as Partial<BoxData>;
  state = { entries: data.entries ?? [], localTags: data.localTags ?? {} };
  byId = new Map(state.entries.map((e) => [e.track.id, e]));
  return state;
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(state);
  writeChain = writeChain.then(() => storage!.write(snapshot));
  return writeChain;
}

/**
 * Puts `tracks` into `entries` (newest first, in the given order), one entry per track ID. A track already there gets
 * the source added (or its name refreshed) and loses its `gone` mark. `merged` counts entries that got a new source.
 */
export function mergeTracks(entries: BoxEntry[], tracks: Track[], source: BoxSource): { entries: BoxEntry[]; added: BoxEntry[]; merged: number } {
  const index = new Map(entries.map((e) => [e.track.id, e]));
  const added: BoxEntry[] = [];
  let merged = 0;
  for (const track of tracks) {
    const have = index.get(track.id);
    if (!have) {
      const entry: BoxEntry = { track, sources: [{ ...source }], tags: [], addedAt: source.at };
      index.set(track.id, entry);
      added.push(entry);
      continue;
    }
    delete have.gone;
    const same = have.sources.find((s) => s.kind === source.kind && s.ref === source.ref);
    if (same) same.name = source.name;
    else {
      have.sources.push({ ...source });
      merged++;
    }
  }
  return { entries: [...added, ...entries], added, merged };
}

export interface BoxQuery {
  /** "untagged": no tags yet (not sorted by the agent); "gone": gone from YouTube. */
  filter?: string;
  /** A source kind ("youtube-liked") or kind:ref ("youtube-playlist:PL…", "local:카시오페아"). */
  source?: string;
  tag?: string;
  q?: string;
}

const sourceKey = (s: BoxSource) => `${s.kind}:${s.ref}`;

export function filterItems(items: BoxEntry[], query: BoxQuery): BoxEntry[] {
  const words = (query.q ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (query.filter === "untagged" && it.tags.length) return false;
    if (query.filter === "gone" && !it.gone) return false;
    if (query.source && !it.sources.some((s) => s.kind === query.source || sourceKey(s) === query.source)) return false;
    if (query.tag && !it.tags.includes(query.tag)) return false;
    if (words.length) {
      const t = it.track;
      const hay = [t.title, t.artist, t.album ?? "", ...it.tags, ...it.sources.map((s) => s.name)].join("\n").toLocaleLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** 200 items from `cursor` (an offset); `next` is the cursor of the following page, null at the end. */
export function pageItems(items: BoxEntry[], cursor?: string) {
  const n = Number(cursor);
  const from = Number.isInteger(n) && n > 0 ? n : 0;
  const to = from + PAGE;
  return { items: items.slice(from, to), total: items.length, next: to < items.length ? String(to) : null };
}

/** The local folders as box items, following the "내 음악" listing rules (searchLocal). */
function localItems(tags: Record<string, string[]>): BoxEntry[] {
  const out: BoxEntry[] = [];
  for (const root of local.listRoots()) {
    const source: BoxSource = { kind: "local", ref: root.name, name: root.name, at: 0 };
    let tracks: Track[] = [];
    try {
      tracks = local.searchLocal("", root.name, Number.MAX_SAFE_INTEGER);
    } catch {
      // a root without an index yet
    }
    for (const track of tracks) out.push({ track, sources: [source], tags: tags[track.id] ?? [], addedAt: 0 });
  }
  return out;
}

/** Box entries (newest first) then the local folders' tracks. */
async function allItems(): Promise<BoxEntry[]> {
  const data = await load();
  const box = data.entries.map((e) => ({ ...e, track: local.annotate(e.track) }));
  return [...box, ...localItems(data.localTags)];
}

export async function listBox(query: BoxQuery & { cursor?: string }) {
  return pageItems(filterItems(await allItems(), query), query.cursor);
}

/** Every source with how many tracks came from it, most tracks first. */
export async function boxSources() {
  const counts = new Map<string, { kind: SourceKind; ref: string; name: string; count: number }>();
  for (const it of await allItems()) {
    for (const s of it.sources) {
      const key = sourceKey(s);
      const c = counts.get(key) ?? { kind: s.kind, ref: s.ref, name: s.name, count: 0 };
      c.count++;
      counts.set(key, c);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/** Adds YouTube tracks from one source; local tracks and bundles are not box entries and are skipped. */
export async function addToBox(tracks: Track[], source: BoxSource) {
  const data = await load();
  const youtube = tracks.filter((t) => VIDEO_ID.test(t.id));
  const result = mergeTracks(data.entries, youtube, source);
  data.entries = result.entries;
  for (const e of result.added) byId.set(e.track.id, e);
  await persist();
  return { added: result.added, merged: result.merged, skipped: tracks.length - youtube.length };
}

export async function boxEntry(id: string): Promise<BoxEntry | null> {
  await load();
  return byId.get(id) ?? null;
}

/** Marks box tracks as gone from YouTube; returns how many were not marked yet. */
export async function markGone(ids: Iterable<string>): Promise<number> {
  await load();
  let n = 0;
  for (const id of ids) {
    const e = byId.get(id);
    if (e && !e.gone) {
      e.gone = true;
      n++;
    }
  }
  if (n) await persist();
  return n;
}

/** A track by ID from the box, the local folders or the library, without response-only flags. */
export async function findTrack(id: string): Promise<Track | null> {
  await load();
  const lib = await library.getLibrary();
  const t =
    byId.get(id)?.track ??
    local.localTrack(id) ??
    [lib.favorites, lib.history, ...lib.playlists.map((p) => p.tracks), ...(lib.bundles ?? []).map((b) => b.parts)].flat().find((x) => x.id === id);
  return t ? library.sanitizeTrack(t) : null;
}

// Tags

/** Applies `change` to the tags of box tracks, local tracks and bundles; IDs that are none of these are `missing`. */
export async function editTags(ids: string[], change: (tags: string[]) => string[]) {
  const data = await load();
  const updated = await library.editBundleTags(ids.filter(isBundleId), change);
  const missing: string[] = [];
  let dirty = false;
  for (const id of ids) {
    if (isBundleId(id)) {
      if (!updated.includes(id)) missing.push(id);
      continue;
    }
    const entry = byId.get(id);
    if (entry) entry.tags = library.cleanTags(change(entry.tags));
    else if (isLocalId(id) && local.localTrack(id)) {
      const tags = library.cleanTags(change(data.localTags[id] ?? []));
      if (tags.length) data.localTags[id] = tags;
      else delete data.localTags[id];
    } else {
      missing.push(id);
      continue;
    }
    updated.push(id);
    dirty = true;
  }
  if (dirty) await persist();
  return { updated, missing };
}

export interface Tagged {
  track: Track;
  tags: string[];
}

/** Everything that has tags: box tracks, local tracks, bundles. */
async function tagged(): Promise<Tagged[]> {
  const data = await load();
  const lib = await library.getLibrary();
  const out: Tagged[] = data.entries.filter((e) => e.tags.length).map((e) => ({ track: local.annotate(e.track), tags: e.tags }));
  for (const [id, tags] of Object.entries(data.localTags)) {
    const track = local.localTrack(id);
    if (track) out.push({ track, tags });
  }
  for (const b of lib.bundles ?? []) if (b.tags.length) out.push({ track: library.bundleTrack(b), tags: b.tags });
  return out;
}

/** Every tag with how many tracks carry it, most used first. */
export async function allTags() {
  const counts = new Map<string, number>();
  for (const it of await tagged()) for (const tag of it.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

const WORK = "작품:";
const ARRANGEMENT = "편곡:";

/** Tracks sharing one of the `works` tags: plain versions first, those with an "편곡:" tag apart. */
export function splitVersions(items: Tagged[], works: string[]) {
  const same = items.filter((it) => it.tags.some((t) => works.includes(t)));
  const isArrangement = (it: Tagged) => it.tags.some((t) => t.startsWith(ARRANGEMENT));
  return { originals: same.filter((it) => !isArrangement(it)), arrangements: same.filter(isArrangement) };
}

/** Other versions of the work(s) a track is tagged with ("작품:…"), the track itself included. */
export async function versions(id: string) {
  const items = await tagged();
  const works = (items.find((it) => it.track.id === id)?.tags ?? []).filter((t) => t.startsWith(WORK));
  return { works: works.map((t) => t.slice(WORK.length)), ...splitVersions(items, works) };
}
