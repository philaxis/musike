import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { Track } from "./types.js";

// The video ledger: Musike's own record of every YouTube video of the song box, so nothing changes or disappears
// silently. Per video what YouTube last said (title, channel, length, whether it plays here) in data/videos.json,
// and every change as one line of data/video-events.jsonl (append-only): YouTube renamed it or its channel, it was
// deleted, made private, blocked here, found Premium-only or age-restricted, or Musike put another video in its place
// (and undid that). Those replacements make the alias map (old ID → the video now in its place) the listening log,
// taste analysis and music map follow; it is also written to data/video-aliases.json for the analysis worker.
// This module is the only writer of the three files. The song box keeps the user's titles: the ledger never renames.

export type VideoStatus = "ok" | "region" | "gone" | "private" | "premium" | "age";
export const VIDEO_STATUSES: VideoStatus[] = ["ok", "region", "gone", "private", "premium", "age"];
/** How a video came to be replaced: YouTube Music's own redirect, the best 「다른 판 찾기」 result, or by hand. */
export type ReplacedBy = "redirect" | "alternative" | "manual";

export interface VideoRecord {
  title: string;
  channel: string;
  /** Seconds; 0 when unknown. */
  duration: number;
  status: VideoStatus;
  /** When Musike first knew it (ms): when it came into the song box. */
  firstSeen: number;
  /** When YouTube was last asked about it (ms); 0 until the first check after it was recorded. */
  lastChecked: number;
  /** The status came from a play that failed (yt-dlp): kept when the Data API, which can't see it, says it plays. */
  byPlay?: true;
}

interface EventBase {
  at: number;
  id: string;
}
export type VideoEvent = EventBase &
  (
    | { kind: "title" | "channel"; from: string; to: string }
    | { kind: "status"; from: VideoStatus; to: VideoStatus }
    /** `id` was replaced by `to`. */
    | { kind: "replaced"; to: string; by: ReplacedBy }
    /** `id` was put back in place of `from` (a replacement undone). */
    | { kind: "restored"; from: string }
  );

/** What YouTube says about a video now; null when its answer leaves the video out (deleted, or private). */
export interface Seen {
  title: string;
  channel: string;
  duration: number;
  status: VideoStatus;
}

/** Titles YouTube gives videos it no longer shows: not a rename. */
const PLACEHOLDER = new Set(["", "Private video", "Deleted video"]);

/**
 * Applies one check to `videos` (changed in place) and returns the changes it found. A video not recorded yet is
 * recorded without events (`firstSeen` says since when Musike knows it). A record's first check (seeded, or added
 * by a replacement) takes YouTube's title and channel without calling them changed. A status found by a failed play
 * stays when the check says the video plays.
 */
export function observe(videos: Record<string, VideoRecord>, seen: Map<string, Seen | null>, at: number, firstSeen: (id: string) => number): VideoEvent[] {
  const events: VideoEvent[] = [];
  for (const [id, s] of seen) {
    const status = s?.status ?? "gone";
    const rec = videos[id];
    if (!rec) {
      videos[id] = { title: s?.title ?? "", channel: s?.channel ?? "", duration: s?.duration ?? 0, status, firstSeen: firstSeen(id), lastChecked: at };
      continue;
    }
    const quiet = rec.lastChecked === 0;
    if (s && !PLACEHOLDER.has(s.title)) {
      if (!quiet && rec.title && s.title !== rec.title) events.push({ at, id, kind: "title", from: rec.title, to: s.title });
      if (!quiet && rec.channel && s.channel && s.channel !== rec.channel) events.push({ at, id, kind: "channel", from: rec.channel, to: s.channel });
      rec.title = s.title;
      if (s.channel) rec.channel = s.channel;
      if (s.duration) rec.duration = s.duration;
    }
    const held = status === "ok" && rec.byPlay;
    if (!held && status !== rec.status) {
      events.push({ at, id, kind: "status", from: rec.status, to: status });
      rec.status = status;
      delete rec.byPlay;
    }
    rec.lastChecked = at;
  }
  return events;
}

/** Old ID → the video put in its place, from the replacements (and undos) in order. */
export function aliasMap(events: VideoEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of events) {
    if (e.kind === "replaced") {
      map.set(e.id, e.to);
      // The new video is the current one now, whatever pointed it elsewhere before (a→b, then b→a).
      map.delete(e.to);
    } else if (e.kind === "restored") map.delete(e.id);
  }
  return map;
}

/** The video now standing for `id`, following replacements of replacements (a→b→c); `id` itself when none. */
export function resolveAlias(map: Map<string, string>, id: string): string {
  let cur = id;
  const seen = new Set([id]);
  for (let next = map.get(cur); next !== undefined && !seen.has(next); next = map.get(cur)) {
    seen.add(next);
    cur = next;
  }
  return cur;
}

// The stored ledger

const videosFile = () => path.join(config.dataDir, "videos.json");
const eventsFile = () => path.join(config.dataDir, "video-events.jsonl");
const aliasesFile = () => path.join(config.dataDir, "video-aliases.json");

interface State {
  videos: Record<string, VideoRecord>;
  events: VideoEvent[];
  aliases: Map<string, string>;
  /** Changes with every new alias map (plays, taste memos key on it). */
  aliasVersion: number;
  /** Whether videos.json was there: a ledger is seeded only once. */
  stored: boolean;
}

let state: State | null = null;
let loading: Promise<State> | null = null;
let writing: Promise<void> = Promise.resolve();

const isEvent = (e: Partial<VideoEvent> | null): e is VideoEvent =>
  !!e && typeof e.at === "number" && typeof e.id === "string" && typeof e.kind === "string";

async function read(): Promise<State> {
  const [rawVideos, rawEvents] = await Promise.all([readFile(videosFile(), "utf8").catch(() => null), readFile(eventsFile(), "utf8").catch(() => "")]);
  let videos: Record<string, VideoRecord> = {};
  try {
    videos = (rawVideos ? (JSON.parse(rawVideos) as { videos?: Record<string, VideoRecord> }).videos : null) ?? {};
  } catch {
    // unreadable: start again (the events stay)
  }
  const events: VideoEvent[] = [];
  for (const line of rawEvents.split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as Partial<VideoEvent> | null;
      if (isEvent(e)) events.push(e);
    } catch {
      // a half-written last line
    }
  }
  return { videos, events, aliases: aliasMap(events), aliasVersion: 1, stored: rawVideos !== null };
}

async function load(): Promise<State> {
  if (state) return state;
  loading ??= read().then((s) => (state = s));
  return loading;
}

/** Forgets what was read (tests switch data folders). */
export function resetLedger() {
  state = null;
  loading = null;
}

function serialize(job: () => Promise<void>): Promise<void> {
  const run = writing.then(job);
  writing = run.catch(() => {});
  return run;
}

async function writeAtomic(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text, "utf8");
  await rename(`${file}.tmp`, file);
}

/** Appends `events` and saves the records (and the alias map when a replacement changed it). */
function save(s: State, events: VideoEvent[], aliasesChanged = false): Promise<void> {
  s.events.push(...events);
  if (aliasesChanged) {
    s.aliases = aliasMap(s.events);
    s.aliasVersion++;
  }
  const videos = JSON.stringify({ version: 1, videos: s.videos });
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  const aliases = aliasesChanged ? JSON.stringify(Object.fromEntries([...s.aliases.keys()].map((id) => [id, resolveAlias(s.aliases, id)])), null, 1) : null;
  s.stored = true;
  return serialize(async () => {
    await mkdir(config.dataDir, { recursive: true });
    if (lines) await appendFile(eventsFile(), lines + "\n", "utf8");
    await writeAtomic(videosFile(), videos);
    if (aliases !== null) await writeAtomic(aliasesFile(), aliases);
  });
}

export interface SeedEntry {
  track: Track;
  addedAt: number;
  blocked?: { reason: string };
}

const asStatus = (v: string | undefined): VideoStatus => ((VIDEO_STATUSES as string[]).includes(v ?? "") ? (v as VideoStatus) : "ok");

/**
 * The first ledger: every box video as the box knows it (its status from the box's `blocked` mark), no events. The
 * first check then takes YouTube's titles quietly (see `observe`). Nothing happens once videos.json exists.
 */
export async function seed(entries: readonly SeedEntry[]): Promise<number> {
  const s = await load();
  if (s.stored) return 0;
  for (const e of entries) {
    if (s.videos[e.track.id]) continue;
    s.videos[e.track.id] = {
      title: e.track.title,
      channel: e.track.artist,
      duration: e.track.duration,
      status: asStatus(e.blocked?.reason),
      firstSeen: e.addedAt,
      lastChecked: 0,
    };
  }
  await save(s, []);
  return entries.length;
}

/** Stores a check of box videos (see `observe`); returns the changes found. */
export async function recordCheck(seen: Map<string, Seen | null>, at: number, firstSeen: (id: string) => number): Promise<VideoEvent[]> {
  const s = await load();
  const events = observe(s.videos, seen, at, firstSeen);
  await save(s, events);
  return events;
}

/** A play found a recorded video won't play (yt-dlp's reason: region, gone, private, premium, age). */
export async function recordPlayFailure(id: string, status: VideoStatus, at = Date.now()): Promise<void> {
  const s = await load();
  const rec = s.videos[id];
  if (!rec || (rec.status === status && rec.byPlay)) return;
  const events: VideoEvent[] = rec.status === status ? [] : [{ at, id, kind: "status", from: rec.status, to: status }];
  rec.status = status;
  rec.byPlay = true;
  await save(s, events);
}

/** A play of a recorded video worked: a status only a failed play had set goes back to "ok". */
export async function recordPlayable(id: string, at = Date.now()): Promise<void> {
  const s = await load();
  const rec = s.videos[id];
  if (!rec?.byPlay) return;
  const events: VideoEvent[] = rec.status === "ok" ? [] : [{ at, id, kind: "status", from: rec.status, to: "ok" }];
  rec.status = "ok";
  delete rec.byPlay;
  await save(s, events);
}

/** `oldId` was replaced by `track` (in the box, playlists and the rest): one event, and the new video recorded. */
export async function recordReplaced(oldId: string, track: Track, by: ReplacedBy, at = Date.now()): Promise<void> {
  const s = await load();
  s.videos[track.id] ??= { title: track.title, channel: track.artist, duration: track.duration, status: "ok", firstSeen: at, lastChecked: 0 };
  await save(s, [{ at, id: oldId, kind: "replaced", to: track.id, by }], true);
}

/** The replacement of `oldId` by `fromId` was undone: `oldId` is back. */
export async function recordRestored(oldId: string, fromId: string, at = Date.now()): Promise<void> {
  const s = await load();
  await save(s, [{ at, id: oldId, kind: "restored", from: fromId }], true);
}

/** The alias map as it is now: `resolve` follows it; `version` changes whenever it does. */
export async function aliases(): Promise<{ version: number; resolve: (id: string) => string; map: Map<string, string> }> {
  const s = await load();
  const map = s.aliases;
  return { version: s.aliasVersion, map, resolve: (id) => (map.size ? resolveAlias(map, id) : id) };
}

/** The IDs that stand for the same track as `id` now: itself, the one standing for it and every ID replaced by it. */
export async function family(id: string): Promise<Set<string>> {
  const { map, resolve } = await aliases();
  const current = resolve(id);
  const out = new Set([id, current]);
  for (const old of map.keys()) if (resolve(old) === current) out.add(old);
  return out;
}

export async function videoRecord(id: string): Promise<VideoRecord | null> {
  return (await load()).videos[id] ?? null;
}

/**
 * Events newest first, `limit` from `cursor` (an offset); `next` is the following page's cursor, null at the end.
 * With `ids`, only the events about those videos (replacements by them or of them too).
 */
export async function recentEvents(limit: number, cursor = 0, ids?: Set<string>): Promise<{ events: VideoEvent[]; total: number; next: number | null }> {
  const s = await load();
  const mine = ids
    ? s.events.filter((e) => ids.has(e.id) || (e.kind === "replaced" && ids.has(e.to)) || (e.kind === "restored" && ids.has(e.from)))
    : s.events;
  const all = mine.slice().reverse();
  const to = cursor + limit;
  return { events: all.slice(cursor, to), total: all.length, next: to < all.length ? to : null };
}

/** How many recorded videos have each status, and when the last check was. */
export async function summary(): Promise<{ videos: number; status: Record<VideoStatus, number>; checkedAt: number | null }> {
  const s = await load();
  const status = Object.fromEntries(VIDEO_STATUSES.map((k) => [k, 0])) as Record<VideoStatus, number>;
  let checkedAt = 0;
  const records = Object.values(s.videos);
  for (const r of records) {
    status[r.status]++;
    checkedAt = Math.max(checkedAt, r.lastChecked);
  }
  return { videos: records.length, status, checkedAt: checkedAt || null };
}
