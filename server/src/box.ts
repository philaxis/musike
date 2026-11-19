import * as library from "./library.js";
import type { LibraryStorage } from "./library.js";
import type { ReplacedBy } from "./ledger.js";
import * as local from "./local.js";
import { isBundleId, isLocalId, VIDEO_ID, type Track, type Unplayable } from "./types.js";

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
  /** The video this source brought in, when the entry's track was replaced by another version of it (see `replaceEntry`). */
  was?: string;
}

/** Why a box track won't play here, and when that was found out (ms; 0 for marks older than the check). */
export interface Blocked {
  reason: Unplayable;
  at: number;
}

/** The track an entry's track stands in for (see standIn.ts), and how it came: what 「되돌리기」 puts back. */
export interface Replaced {
  by: ReplacedBy;
  /** The original track, as it was in the box (its ID is the sources' `was`). */
  was: Track;
  /** Why the original won't play here; it is put aside for that again when restored. */
  reason?: Unplayable;
  at: number;
}

export interface BoxEntry {
  track: Track;
  sources: BoxSource[];
  tags: string[];
  addedAt: number;
  /** Won't play here: blocked in this country, deleted, private, age-restricted. Never removed from the box for that. */
  blocked?: Blocked;
  /** In place of a track that won't play here. */
  replaced?: Replaced;
  /** When a stand-in was last looked for while it was put aside (ms); see standIn.ts. */
  standInAt?: number;
  /** Put back by hand (「되돌리기」): no stand-in is put in its place again by itself. */
  keepAside?: true;
}

interface BoxData {
  /** Newest first. */
  entries: BoxEntry[];
  /** Tags of local tracks, by track ID. */
  localTags: Record<string, string[]>;
  /** When every YouTube track was last checked for whether it plays here (ms); absent until the first check. */
  checkedAt?: number;
  /** When every YouTube track that plays was last asked about being Premium-only (ms); see standIn.ts. */
  premiumAt?: number;
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
  state = { entries: data.entries ?? [], localTags: data.localTags ?? {}, checkedAt: data.checkedAt, premiumAt: data.premiumAt };
  // Boxes saved before `blocked` marked deleted and private videos `gone: true`.
  for (const e of state.entries as (BoxEntry & { gone?: true })[]) {
    if (!e.gone) continue;
    delete e.gone;
    e.blocked ??= { reason: "gone", at: 0 };
  }
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
 * the source added (or its name refreshed); back in a live list, it loses a deleted/private mark. A track that was
 * replaced by another version (a source's `was`) goes to that entry. `merged` counts entries that got a new source.
 */
export function mergeTracks(entries: BoxEntry[], tracks: Track[], source: BoxSource): { entries: BoxEntry[]; added: BoxEntry[]; merged: number } {
  const index = new Map(entries.map((e) => [e.track.id, e]));
  const replaced = new Map(entries.flatMap((e) => e.sources.filter((s) => s.was).map((s) => [s.was!, e] as const)));
  const added: BoxEntry[] = [];
  let merged = 0;
  for (const track of tracks) {
    const have = index.get(track.id) ?? replaced.get(track.id);
    if (!have) {
      const entry: BoxEntry = { track, sources: [{ ...source }], tags: [], addedAt: source.at };
      index.set(track.id, entry);
      added.push(entry);
      continue;
    }
    const was = have.track.id === track.id ? undefined : track.id;
    if (!was && (have.blocked?.reason === "gone" || have.blocked?.reason === "private")) delete have.blocked;
    const same = have.sources.find((s) => s.kind === source.kind && s.ref === source.ref);
    if (same) same.name = source.name;
    else {
      have.sources.push(was ? { ...source, was } : { ...source });
      merged++;
    }
  }
  return { entries: [...added, ...entries], added, merged };
}

export interface BoxQuery {
  /**
   * "untagged": no tags yet (not sorted by the agent); "blocked": won't play here (see `Blocked`); "replaced": stand-ins
   * for tracks that won't play (see `Replaced`), searched and hand-picked ones first, then YouTube Music's moves.
   */
  filter?: string;
  /** A source kind ("youtube-liked") or kind:ref ("youtube-playlist:PL…", "local:카시오페아"). */
  source?: string;
  tag?: string;
  q?: string;
}

const sourceKey = (s: BoxSource) => `${s.kind}:${s.ref}`;

const BY_ORDER: Record<ReplacedBy, number> = { alternative: 0, manual: 1, redirect: 2 };

export function filterItems(items: BoxEntry[], query: BoxQuery): BoxEntry[] {
  const words = (query.q ?? "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const aside = query.filter === "blocked";
  const replaced = query.filter === "replaced";
  const out = items.filter((it) => {
    // Box tracks that won't play here (and have no kept copy, see `present`) are put aside: every listing leaves
    // them out, and only the "blocked" filter shows them. Stand-ins list whatever their state.
    if (replaced ? !it.replaced : !!it.track.blocked !== aside) return false;
    if (query.filter === "untagged" && it.tags.length) return false;
    if (query.source && !it.sources.some((s) => s.kind === query.source || sourceKey(s) === query.source)) return false;
    if (query.tag && !it.tags.includes(query.tag)) return false;
    if (words.length) {
      const t = it.track;
      const hay = [t.title, t.artist, t.album ?? "", ...it.tags, ...it.sources.map((s) => s.name)].join("\n").toLocaleLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  if (replaced) out.sort((a, b) => BY_ORDER[a.replaced!.by] - BY_ORDER[b.replaced!.by] || b.replaced!.at - a.replaced!.at);
  return out;
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
  const box = data.entries.map((e) => ({ ...e, track: present(e.track) }));
  return [...box, ...localItems(data.localTags)];
}

export async function listBox(query: BoxQuery & { cursor?: string }) {
  return pageItems(filterItems(await allItems(), query), query.cursor);
}

/**
 * Every source with how many tracks came from it, most tracks first, how many tracks the box holds (a track with two
 * sources counts once), how many are put aside, by reason, and how many stand in for another, by how they came.
 * Tracks put aside count only there.
 */
export async function boxSources() {
  const items = await allItems();
  const counts = new Map<string, { kind: SourceKind; ref: string; name: string; count: number }>();
  const aside: Partial<Record<Unplayable, number>> = {};
  const replaced: Partial<Record<ReplacedBy, number>> = {};
  let total = 0;
  for (const it of items) {
    if (it.replaced) replaced[it.replaced.by] = (replaced[it.replaced.by] ?? 0) + 1;
    if (it.track.blocked) {
      aside[it.track.blocked] = (aside[it.track.blocked] ?? 0) + 1;
      continue;
    }
    total++;
    for (const s of it.sources) {
      const key = sourceKey(s);
      const c = counts.get(key) ?? { kind: s.kind, ref: s.ref, name: s.name, count: 0 };
      c.count++;
      counts.set(key, c);
    }
  }
  return { sources: [...counts.values()].sort((a, b) => b.count - a.count), total, aside, replaced };
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

/**
 * A track as listings send it: local files' and kept copies' flags, and why it won't play when the box knows (not
 * when a copy is kept on the server: that plays).
 */
function present(t: Track): Track {
  const flagged = local.annotate(t);
  const blocked = flagged.kept ? undefined : byId.get(t.id)?.blocked?.reason;
  return blocked ? { ...flagged, blocked } : flagged;
}

/** `present` for listings outside the box (playlists, favorites): reads the box first. */
export async function annotator(): Promise<(t: Track) => Track> {
  await load();
  return present;
}

/**
 * Stores a check of whether box tracks play here: `results` maps track IDs to why one won't, or null when it plays.
 * Returns how many tracks are newly marked. Marks the whole box as checked when `complete`. The account's check
 * can't see Premium-only videos, so its null leaves a "premium" mark (yt-dlp's) as it is.
 */
export async function applyChecks(results: Map<string, Unplayable | null>, at: number, complete = true): Promise<number> {
  const data = await load();
  let n = 0;
  for (const [id, reason] of results) {
    const e = byId.get(id);
    if (!e) continue;
    if (!reason) {
      if (e.blocked?.reason !== "premium") delete e.blocked;
    } else if (e.blocked?.reason !== reason) {
      if (!e.blocked) n++;
      e.blocked = { reason, at };
    } else e.blocked.at = at;
  }
  if (complete) data.checkedAt = at;
  await persist();
  return n;
}

/** One track found not to play (yt-dlp said so while preparing it); nothing when it isn't in the box. */
export async function markBlocked(id: string, reason: Unplayable): Promise<void> {
  await load();
  const e = byId.get(id);
  if (e && e.blocked?.reason !== reason) await applyChecks(new Map([[id, reason]]), Date.now(), false);
}

/** When the whole box was last checked; undefined before the first check. */
export async function checkedAt(): Promise<number | undefined> {
  return (await load()).checkedAt;
}

/** When the box was last looked through for Premium-only tracks; undefined before the first time. */
export async function premiumCheckedAt(): Promise<number | undefined> {
  return (await load()).premiumAt;
}

export async function markPremiumChecked(at: number): Promise<void> {
  (await load()).premiumAt = at;
  await persist();
}

/** The box's entries (all YouTube tracks), for the check and the video ledger. */
export async function youtubeEntries(): Promise<readonly BoxEntry[]> {
  return (await load()).entries;
}

/**
 * Box tracks put aside (no kept copy) whose stand-in was not looked for since `before` (ms), skipping those put back
 * by hand; oldest look first.
 */
export async function asideForStandIn(before: number): Promise<Track[]> {
  const data = await load();
  return data.entries
    .filter((e) => e.blocked && !e.keepAside && (e.standInAt ?? 0) < before && present(e.track).blocked)
    .sort((a, b) => (a.standInAt ?? 0) - (b.standInAt ?? 0))
    .map((e) => e.track);
}

/** Notes that a stand-in for `id` was looked for at `at` and none was put in. */
export async function markLooked(id: string, at: number): Promise<void> {
  await load();
  const e = byId.get(id);
  if (!e) return;
  e.standInAt = at;
  await persist();
}

/** The track that took the place of `oldId` (a source's `was`), when the box no longer has `oldId` itself. */
export async function replacementOf(oldId: string): Promise<Track | null> {
  const data = await load();
  if (byId.has(oldId)) return null;
  return data.entries.find((e) => e.sources.some((s) => s.was === oldId))?.track ?? null;
}

/** How a replacement came, for `replaceEntry`: the reason is the original's when the box knows none. */
export interface ReplaceHow {
  by: ReplacedBy;
  reason?: Unplayable;
  at: number;
}

/**
 * Puts `track` in place of the entry of `oldId` (another version of a track that won't play): sources, tags and the
 * date it came in stay, and each source remembers `oldId` as `was` so a later sync doesn't bring it back. When the
 * box has `track` already, that entry takes the sources and tags and the old one goes. The entry remembers the
 * original track (`replaced`; the first one when a stand-in is replaced again) so it can be put back.
 */
export function replaceEntry(entries: BoxEntry[], oldId: string, track: Track, how: ReplaceHow): BoxEntry[] {
  const old = entries.find((e) => e.track.id === oldId);
  if (!old) return entries;
  const sources = old.sources.map((s) => ({ ...s, was: s.was ?? oldId }));
  const replaced: Replaced = old.replaced
    ? { ...old.replaced, by: how.by, at: how.at }
    : { by: how.by, was: old.track, reason: old.blocked?.reason ?? how.reason, at: how.at };
  const existing = entries.find((e) => e.track.id === track.id);
  if (!existing) {
    const entry: BoxEntry = { ...old, track, sources, replaced };
    delete entry.blocked;
    delete entry.standInAt;
    delete entry.keepAside;
    return entries.map((e) => (e === old ? entry : e));
  }
  for (const s of sources) if (!existing.sources.some((x) => x.kind === s.kind && x.ref === s.ref)) existing.sources.push(s);
  existing.tags = library.cleanTags([...existing.tags, ...old.tags]);
  existing.replaced ??= replaced;
  return entries.filter((e) => e !== old);
}

/** `replaceEntry` in the stored box (nothing changes there when `oldId` isn't a box track). */
export async function replaceTrack(oldId: string, track: Track, how: ReplaceHow): Promise<void> {
  const data = await load();
  if (!byId.has(oldId)) return;
  data.entries = replaceEntry(data.entries, oldId, track, how);
  byId = new Map(data.entries.map((e) => [e.track.id, e]));
  await persist();
}

/**
 * Puts the original track back in place of the stand-in `id` (「되돌리기」): put aside again for its reason, never
 * replaced by itself again. When the stand-in was a box track of its own before (`replaceEntry` merged them), only
 * the sources that came with the original go back to it (`split`). Null when `id` stands in for nothing.
 */
export function restoreEntry(entries: BoxEntry[], id: string, at: number): { entries: BoxEntry[]; was: Track; split: boolean } | null {
  const e = entries.find((x) => x.track.id === id);
  if (!e?.replaced) return null;
  const { was, reason } = e.replaced;
  const moved = e.sources.filter((s) => s.was === was.id);
  const rest = e.sources.filter((s) => s.was !== was.id);
  const split = moved.length > 0 && rest.length > 0;
  const back: BoxEntry = {
    track: was,
    sources: (split ? moved : e.sources).map(({ was: _, ...s }) => s),
    tags: [...e.tags],
    addedAt: e.addedAt,
    ...(reason ? { blocked: { reason, at } } : {}),
    keepAside: true,
  };
  if (!split) return { entries: entries.map((x) => (x === e ? back : x)), was, split };
  const kept: BoxEntry = { ...e, sources: rest };
  delete kept.replaced;
  return { entries: entries.flatMap((x) => (x === e ? [kept, back] : [x])), was, split };
}

/** `restoreEntry` in the stored box. */
export async function restoreTrack(id: string, at: number): Promise<{ was: Track; split: boolean } | null> {
  const data = await load();
  const r = restoreEntry(data.entries, id, at);
  if (!r) return null;
  data.entries = r.entries;
  byId = new Map(data.entries.map((e) => [e.track.id, e]));
  await persist();
  return { was: r.was, split: r.split };
}

/**
 * A title as words to compare: without a leading track number, bracketed notes (【…】, […]) and upload noise
 * (OST, HQ, 1080p, official…), lowercased. Also what a search for other versions asks for (joined).
 */
export function titleWords(title: string): string[] {
  const clean = title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^\s*\d+\s*[.)-]\s*/, "")
    .replace(/【[^】]*】|\[[^\]]*\]/g, " ");
  return (clean.match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !NOISE.has(w));
}
const NOISE = new Set(["ost", "official", "audio", "video", "mv", "hq", "hd", "1080p", "720p", "lyrics", "lyric", "full", "version", "ver", "the", "a"]);

/** Character pairs of the words run together, for titles written without spaces (Japanese, Chinese). */
const pairs = (words: string[]) => {
  const s = words.join("");
  return new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
};

/** How alike two titles are, 0–1: the share of the original's words the other has, or of its character pairs (Dice). */
export function titleLikeness(original: string, other: string): number {
  const a = titleWords(original);
  const b = new Set(titleWords(other));
  if (!a.length || !b.size) return 0;
  const words = a.filter((w) => b.has(w)).length / a.length;
  const pa = pairs(a);
  const pb = pairs([...b]);
  const shared = [...pa].filter((p) => pb.has(p)).length;
  const dice = pa.size + pb.size ? (2 * shared) / (pa.size + pb.size) : 0;
  return Math.max(words, dice);
}

/** Below this a search result is another song, not another version (Road Taken → "Good Luck, Babe!"). */
export const LIKE_ENOUGH = 0.6;

export interface Alternative {
  track: Track;
  /** Why it is offered: the same title (bar track numbers and notes), the same artist (channel). */
  sameTitle: boolean;
  sameArtist: boolean;
  /** Where YouTube Music moved the track itself (offered first even when its title differs). */
  redirect?: boolean;
}

const artistKey = (a: string) => a.normalize("NFKC").toLocaleLowerCase().replace(/\s*-\s*topic$/, "").replace(/[^\p{L}\p{N}]+/gu, "");

/** Whether two artist (channel) names are the same artist: one contains the other, "- Topic" and punctuation aside. */
export function sameArtist(a: string, b: string): boolean {
  const x = artistKey(a);
  const y = artistKey(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

/**
 * Other versions of `original`: search results that are another video, play here (`blocked` says when one doesn't)
 * and have a title alike enough, closest in length first (search order among equals), at most `count`.
 */
export function pickAlternatives(original: Track, found: Track[], blocked: (t: Track) => boolean, count = 5): Alternative[] {
  const title = titleWords(original.title).join(" ");
  return found
    .filter((t) => t.id !== original.id && !blocked(t) && titleLikeness(original.title, t.title) >= LIKE_ENOUGH)
    .map((t, i) => ({ t, i, off: original.duration && t.duration ? Math.abs(t.duration - original.duration) : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.off - b.off || a.i - b.i)
    .slice(0, count)
    .map(({ t }) => ({ track: t, sameTitle: titleWords(t.title).join(" ") === title, sameArtist: sameArtist(original.artist, t.artist) }));
}

/** Lengths this close (s) count as the same recording when a stand-in is chosen. */
const SAME_LENGTH_S = 3;
/** The last tier needs the same song name: this alike as names (`nameLikeness`; "High Heart" vs "Can You Hear My Heart" is not). */
const SAME_NAME = 0.8;
/** …and a length this close (share of the original's) unless the artist is the same: a cover or another performance. */
const NEAR_LENGTH = 0.15;

/**
 * A title as the song's name: `titleWords` without notes in parentheses ("(Live)", "(feat. …)") and without the
 * words of the artists' names that uploads put in titles ("Bernard Herrmann - Twisted Nerve"); the plain words when
 * nothing else is left.
 */
function nameWords(title: string, artists: string[]): string[] {
  const named = new Set(artists.flatMap((a) => titleWords(a)).filter((w) => w !== "topic"));
  const words = titleWords(title.replace(/\([^)]*\)|（[^）]*）/g, " ")).filter((w) => !named.has(w));
  return words.length ? words : titleWords(title);
}

/**
 * How alike two tracks' titles are as song names, 0–1, both ways: the shared words over the longer title's, or the
 * character pairs' Dice for titles written without spaces. Unlike `titleLikeness`, a long title that merely contains
 * the words ("Epik High … 'Can You Hear My Heart'" for "High Heart") is not alike.
 */
export function nameLikeness(original: Track, other: Track): number {
  const artists = [original.artist, other.artist];
  const a = nameWords(original.title, artists);
  const b = nameWords(other.title, artists);
  if (!a.length || !b.length) return 0;
  const inB = new Set(b);
  const words = new Set(a.filter((w) => inB.has(w))).size / Math.max(new Set(a).size, inB.size);
  const pa = pairs(a);
  const pb = pairs(b);
  const shared = [...pa].filter((p) => pb.has(p)).length;
  return Math.max(words, pa.size + pb.size ? (2 * shared) / (pa.size + pb.size) : 0);
}

/**
 * Which tier `a` (from `pickAlternatives`) goes in by itself as a stand-in for `original`: 0 the same title and length
 * (±3 s), 1 the same title and artist, 2 the same song name (`nameLikeness` ≥ 0.8) with a length within 15% or the
 * same artist. Null: not by itself (another song, an album, a medley); it is only offered in 「다른 판 찾기」.
 */
export function standInTier(original: Track, a: Alternative): 0 | 1 | 2 | null {
  const off = original.duration && a.track.duration ? Math.abs(a.track.duration - original.duration) : Number.MAX_SAFE_INTEGER;
  if (a.sameTitle && off <= SAME_LENGTH_S) return 0;
  if (a.sameTitle && a.sameArtist) return 1;
  if (nameLikeness(original, a.track) >= SAME_NAME && (off <= original.duration * NEAR_LENGTH || a.sameArtist)) return 2;
  return null;
}

/** The alternatives that may go in by themselves, in the order they are tried: by `standInTier`, `pickAlternatives`' order within each. */
export function standInOrder(original: Track, alternatives: Alternative[]): Alternative[] {
  return alternatives
    .map((a, i) => ({ a, i, t: standInTier(original, a) }))
    .filter((x): x is { a: Alternative; i: number; t: 0 | 1 | 2 } => x.t !== null)
    .sort((x, y) => x.t - y.t || x.i - y.i)
    .map(({ a }) => a);
}

/** Lengths this close (s) make a moved track by the same artist the same song even when its title is worded otherwise. */
const REDIRECT_LENGTH_S = 5;

/**
 * Whether the track YouTube Music moved `original` to is the same song: an alike title (as for alternatives), or the
 * same artist and a length within 5 s.
 */
export function redirectFits(original: Track, moved: Pick<Track, "title" | "artist" | "duration">): boolean {
  if (titleLikeness(original.title, moved.title) >= LIKE_ENOUGH) return true;
  return sameArtist(original.artist, moved.artist) && !!original.duration && !!moved.duration && Math.abs(original.duration - moved.duration) <= REDIRECT_LENGTH_S;
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
  // Tracks put aside (won't play here) are left out, as in the box listings.
  const out: Tagged[] = data.entries
    .filter((e) => e.tags.length)
    .map((e) => ({ track: present(e.track), tags: e.tags }))
    .filter((it) => !it.track.blocked);
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
