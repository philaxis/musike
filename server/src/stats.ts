import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { FastifyInstance } from "fastify";
import { findTrack } from "./box.js";
import { config } from "./config.js";
import { msg } from "./i18n.js";
import * as library from "./library.js";
import * as local from "./local.js";
import { playsFile, type Play } from "./plays.js";
import { HttpError, isBundleId, isLocalId, TRACK_ID, type Track } from "./types.js";

// 「내 기록」: listening stats read out of plays.jsonl (see plays.ts), and 「오늘 좋음 ☀」, the tracks liked on a given
// day (data/daylikes.json), apart from the ♥ favorites. Rules are the #26 contract's: a "listen" is 30 s or more and
// half the track or 4 minutes; a "skip" is moving on within 30 s. Days and hours are Seoul's.

const DAY = 86_400_000;
/** Seoul is UTC+9 all year (no daylight saving); the one listener lives there. */
const TZ_OFFSET = 9 * 3_600_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The Seoul date ("YYYY-MM-DD") of a moment. */
export const dayOf = (ms: number) => new Date(ms + TZ_OFFSET).toISOString().slice(0, 10);
const hourOf = (ms: number) => new Date(ms + TZ_OFFSET).getUTCHours();
/** When a Seoul date starts (ms). */
const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`) - TZ_OFFSET;

export const isListen = (p: Pick<Play, "heard" | "duration">) => p.heard >= 30 && (p.heard >= p.duration / 2 || p.heard >= 240);
export const isSkip = (p: Pick<Play, "heard" | "end">) => p.end === "skipped" && p.heard < 30;

export type Period = "4w" | "6m" | "all";
const PERIOD_DAYS: Record<Exclude<Period, "all">, number> = { "4w": 28, "6m": 182 };
const isPeriod = (v: unknown): v is Period => v === "4w" || v === "6m" || v === "all";

/** First moment of a period: today and the days before it (Seoul), or null for all of it. */
export function periodStart(period: Period, now: number): number | null {
  if (period === "all") return null;
  return dayStart(dayOf(now)) - (PERIOD_DAYS[period] - 1) * DAY;
}

/** Listens of one track: how many, seconds heard in them, the last one, and its latest line (title, artist…). */
export interface Count {
  id: string;
  listens: number;
  seconds: number;
  last: number;
  play: Play;
}

export interface ArtistCount {
  name: string;
  listens: number;
  seconds: number;
  /** Their most listened track. */
  top: Play;
}

export interface Stats {
  period: Period;
  /** First and last day the calendar covers (null when there is nothing at all). */
  from: string | null;
  to: string;
  /** Listens ever, whatever the period: the page tells "just started" from this. */
  total: number;
  summary: { seconds: number; listens: number; newTracks: number; skipRate: number; lines: number };
  /** Only the days with something heard. */
  days: { date: string; seconds: number; listens: number }[];
  /** Seconds heard by the hour (Seoul) a track started. */
  hours: number[];
  topTracks: Count[];
  topArtists: ArtistCount[];
  /** By the analysis' genre; null without analysis results (or none of these tracks in them). */
  genres: { genre: string; listens: number }[] | null;
  /** The last 4 weeks' most listened (twice or more). */
  onRepeat: Count[];
  /** Listened 3 times or more ever, but not in the last 60 days. */
  forgotten: Count[];
}

const TOP = 10;
const byListens = (a: { listens: number; seconds: number }, b: { listens: number; seconds: number }) =>
  b.listens - a.listens || b.seconds - a.seconds;

function bump(map: Map<string, Count>, p: Play) {
  const c = map.get(p.id);
  if (!c) return void map.set(p.id, { id: p.id, listens: 1, seconds: p.heard, last: p.startedAt, play: p });
  c.listens++;
  c.seconds += p.heard;
  if (p.startedAt >= c.last) {
    c.last = p.startedAt;
    c.play = p;
  }
}

/** Everything 「내 기록」 shows for a period. `plays` in start order. */
export function computeStats(plays: Play[], period: Period, now: number, genreOf?: (id: string) => string | undefined): Stats {
  const start = periodStart(period, now) ?? -Infinity;
  const recentStart = periodStart("4w", now)!;
  const forgetBefore = now - 60 * DAY;
  const firstListen = new Map<string, number>();
  const ever = new Map<string, Count>();
  const recent = new Map<string, Count>();
  const counts = new Map<string, Count>();
  const genres = new Map<string, number>();
  const days = new Map<string, Stats["days"][number]>();
  const hours = Array<number>(24).fill(0);
  let first: number | null = null;
  let total = 0;
  let seconds = 0;
  let listens = 0;
  let lines = 0;
  let skips = 0;

  for (const p of plays) {
    const listen = isListen(p);
    if (listen) {
      total++;
      if (!firstListen.has(p.id)) firstListen.set(p.id, p.startedAt);
      bump(ever, p);
      if (p.startedAt >= recentStart) bump(recent, p);
    }
    if (p.startedAt < start) continue;
    first ??= p.startedAt;
    lines++;
    seconds += p.heard;
    if (isSkip(p)) skips++;
    const date = dayOf(p.startedAt);
    const day = days.get(date) ?? { date, seconds: 0, listens: 0 };
    days.set(date, day);
    day.seconds += p.heard;
    hours[hourOf(p.startedAt)] += p.heard;
    if (!listen) continue;
    listens++;
    day.listens++;
    bump(counts, p);
    const genre = genreOf?.(p.id);
    if (genre) genres.set(genre, (genres.get(genre) ?? 0) + 1);
  }

  const artists = new Map<string, ArtistCount>();
  for (const c of counts.values()) {
    const name = c.play.artist.trim();
    if (!name) continue;
    const a = artists.get(name);
    if (!a) artists.set(name, { name, listens: c.listens, seconds: c.seconds, top: c.play });
    else {
      if (c.listens > (counts.get(a.top.id)?.listens ?? 0)) a.top = c.play;
      a.listens += c.listens;
      a.seconds += c.seconds;
    }
  }

  const from = start === -Infinity ? (first === null ? null : dayOf(first)) : dayOf(start);
  let newTracks = 0;
  for (const at of firstListen.values()) if (at >= start) newTracks++;
  return {
    period,
    from,
    to: dayOf(now),
    total,
    summary: { seconds, listens, newTracks, skipRate: lines ? skips / lines : 0, lines },
    days: [...days.values()],
    hours,
    topTracks: [...counts.values()].sort(byListens).slice(0, TOP),
    topArtists: [...artists.values()].sort(byListens).slice(0, TOP),
    genres: genres.size ? [...genres].map(([genre, n]) => ({ genre, listens: n })).sort((a, b) => b.listens - a.listens) : null,
    onRepeat: [...recent.values()].filter((c) => c.listens >= 2).sort(byListens).slice(0, TOP),
    forgotten: [...ever.values()].filter((c) => c.listens >= 3 && c.last < forgetBefore).sort(byListens).slice(0, TOP),
  };
}

/** One day: seconds heard, and the tracks listened to that day (first listen order, latest line of each). */
export function dayPlays(plays: Play[], date: string) {
  const from = dayStart(date);
  const to = from + DAY;
  const tracks = new Map<string, Play>();
  let seconds = 0;
  let listens = 0;
  for (const p of plays) {
    if (p.startedAt < from || p.startedAt >= to) continue;
    seconds += p.heard;
    if (!isListen(p)) continue;
    listens++;
    tracks.set(p.id, p);
  }
  return { date, seconds, listens, tracks: [...tracks.values()] };
}

/** One track's record (a bundle's parts together). Times in ms, null when never heard. */
export function trackRecord(plays: Play[], ids: Set<string>) {
  let listens = 0;
  let skips = 0;
  let lines = 0;
  let seconds = 0;
  let first: number | null = null;
  let last: number | null = null;
  for (const p of plays) {
    if (!ids.has(p.id)) continue;
    lines++;
    seconds += p.heard;
    if (isListen(p)) listens++;
    if (isSkip(p)) skips++;
    first ??= p.startedAt;
    last = Math.max(last ?? 0, p.startedAt);
  }
  return { listens, skips, lines, seconds, first, last };
}

// Reading the log: streamed line by line, kept while the file's mtime and size stay the same.

let log: { key: string; plays: Play[] } | null = null;
let reading: { key: string; done: Promise<{ key: string; plays: Play[] }> } | null = null;

const isPlayLine = (p: Partial<Play> | null): p is Play =>
  !!p && typeof p.id === "string" && !!p.id && typeof p.startedAt === "number" && typeof p.heard === "number" && typeof p.duration === "number";

async function readPlays(file: string): Promise<Play[]> {
  const plays: Play[] = [];
  const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    try {
      const p = JSON.parse(line) as Partial<Play> | null;
      if (isPlayLine(p)) plays.push(p);
    } catch {
      // a half-written last line: skip it
    }
  }
  // Devices send late when offline, so file order is not quite time order.
  return plays.sort((a, b) => a.startedAt - b.startedAt);
}

export async function loadPlays(file = playsFile()): Promise<{ key: string; plays: Play[] }> {
  const st = await stat(file).catch(() => null);
  if (!st) return { key: "none", plays: [] };
  const key = `${st.mtimeMs}:${st.size}`;
  if (log?.key === key) return log;
  if (reading?.key !== key) {
    const done = readPlays(file).then((plays) => (log = { key, plays }));
    reading = { key, done };
    done.catch(() => {}).finally(() => reading?.done === done && (reading = null));
  }
  return reading.done;
}

// The analysis results (musike-analysis): only the genre of each track is read here.

const analysisDir = () => process.env.MUSIKE_ANALYSIS_DIR || path.join(homedir(), ".local", "share", "musike", "analysis");
let taste: { mtime: number; genres: Map<string, string> } | null = null;

/** Genre by track ID from taste.json, or null without it. A broken file counts as none. */
async function tasteGenres(): Promise<{ key: string; genres: Map<string, string> | null }> {
  const file = path.join(analysisDir(), "taste.json");
  const st = await stat(file).catch(() => null);
  if (!st) return { key: "none", genres: null };
  if (taste?.mtime !== st.mtimeMs) {
    const genres = new Map<string, string>();
    try {
      const data = JSON.parse(await readFile(file, "utf8")) as { songs?: { id?: unknown; genre?: unknown }[] };
      for (const s of Array.isArray(data.songs) ? data.songs : []) {
        if (typeof s?.id === "string" && typeof s.genre === "string" && s.genre) genres.set(s.id, s.genre);
      }
    } catch {
      // being rewritten or broken: no genres until it changes again
    }
    taste = { mtime: st.mtimeMs, genres };
  }
  return { key: String(taste.mtime), genres: taste.genres.size ? taste.genres : null };
}

const computed = new Map<string, Stats>();

export async function getStats(period: Period, now = Date.now()): Promise<Stats> {
  const [{ key, plays }, genres] = await Promise.all([loadPlays(), tasteGenres()]);
  const memoKey = `${key}|${genres.key}|${period}|${dayOf(now)}`;
  const hit = computed.get(memoKey);
  if (hit) return hit;
  const stats = computeStats(plays, period, now, genres.genres ? (id) => genres.genres!.get(id) : undefined);
  if (computed.size >= 12) computed.clear();
  computed.set(memoKey, stats);
  return stats;
}

/** A track as the app shows it: from the box, music folders or library; else rebuilt from its log line. */
function fromPlay(p: Play): Track {
  const own = isLocalId(p.id);
  const cover = `/api/local/${p.id}/cover`;
  return {
    id: p.id,
    title: p.title || p.id,
    artist: p.artist,
    ...(p.album ? { album: p.album } : {}),
    duration: p.duration,
    thumb: own ? cover : `https://i.ytimg.com/vi/${p.id}/mqdefault.jpg`,
    art: own ? cover : `https://i.ytimg.com/vi/${p.id}/hq720.jpg`,
    kind: "song",
    ...(own ? { source: "local" as const } : {}),
  };
}

const present = async (p: Play): Promise<Track> => local.annotate((await findTrack(p.id).catch(() => null)) ?? fromPlay(p));
const presentAll = (counts: { play: Play }[]) => Promise.all(counts.map((c) => present(c.play)));

// 「오늘 좋음」: data/daylikes.json, `{ "2026-11-18": [track + at] }`.

export type DayLike = Track & { at: number };
const MAX_PER_DAY = 500;
const likesFile = () => path.join(config.dataDir, "daylikes.json");
let likes: Record<string, DayLike[]> | null = null;
let writingLikes: Promise<void> = Promise.resolve();

async function loadLikes(): Promise<Record<string, DayLike[]>> {
  if (likes) return likes;
  const out: Record<string, DayLike[]> = {};
  try {
    const raw = JSON.parse(await readFile(likesFile(), "utf8")) as Record<string, unknown>;
    for (const [date, list] of Object.entries(raw ?? {})) {
      if (!DATE.test(date) || !Array.isArray(list)) continue;
      out[date] = list.flatMap((x) => {
        try {
          const at = (x as { at?: unknown }).at;
          return [{ ...library.sanitizeTrack(x), at: typeof at === "number" ? at : 0 }];
        } catch {
          return [];
        }
      });
    }
  } catch {
    // none yet, or unreadable: start empty
  }
  return (likes ??= out);
}

async function saveLikes(): Promise<void> {
  const json = JSON.stringify(likes);
  const file = likesFile();
  const write = writingLikes.then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, json, "utf8");
    await rename(`${file}.tmp`, file);
  });
  writingLikes = write.catch(() => {});
  await write;
}

function dateParam(v: unknown, now: number): string {
  if (v === undefined || v === "") return dayOf(now);
  if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, msg("invalidDate"));
  return v;
}

const dayView = async (date: string) => ({ date, tracks: ((await loadLikes())[date] ?? []).map(local.annotate) });

export function registerStatsRoutes(app: FastifyInstance) {
  app.get("/api/stats", async (req) => {
    const { period = "4w" } = req.query as { period?: string };
    if (!isPeriod(period)) throw new HttpError(400, msg("invalidPeriod"));
    const s = await getStats(period);
    const [topTracks, onRepeat, forgotten] = await Promise.all([presentAll(s.topTracks), presentAll(s.onRepeat), presentAll(s.forgotten)]);
    return {
      ...s,
      topTracks,
      onRepeat,
      forgotten,
      topArtists: s.topArtists.map((a) => ({ name: a.name, listens: a.listens, thumb: fromPlay(a.top).thumb })),
    };
  });

  app.get("/api/stats/day/:date", async (req) => {
    const date = dateParam((req.params as { date?: string }).date, Date.now());
    const day = dayPlays((await loadPlays()).plays, date);
    const [tracks, liked] = await Promise.all([Promise.all(day.tracks.map(present)), dayView(date)]);
    return { ...day, tracks, liked: liked.tracks };
  });

  app.get("/api/stats/track/:id", async (req) => {
    const id = (req.params as { id?: string }).id ?? "";
    if (!TRACK_ID.test(id)) throw new HttpError(400, msg("invalidTrackId"));
    const ids = new Set(isBundleId(id) ? (await library.getBundle(id)).parts.map((t) => t.id) : [id]);
    return trackRecord((await loadPlays()).plays, ids);
  });

  app.get("/api/daylikes", async (req) => dayView(dateParam((req.query as { date?: string }).date, Date.now())));

  /** Likes the track today (Seoul). */
  app.put("/api/daylikes/:id", async (req) => {
    const track = library.sanitizeTrack(req.body);
    if (track.id !== (req.params as { id: string }).id) throw new HttpError(400, msg("idMismatch"));
    const date = dayOf(Date.now());
    const all = await loadLikes();
    const list = all[date] ?? [];
    if (!list.some((t) => t.id === track.id)) {
      all[date] = [...list, { ...track, at: Date.now() }].slice(-MAX_PER_DAY);
      await saveLikes();
    }
    return dayView(date);
  });

  /** Unlikes it, today unless `?date=` says which day. */
  app.delete("/api/daylikes/:id", async (req) => {
    const date = dateParam((req.query as { date?: string }).date, Date.now());
    const { id } = req.params as { id: string };
    const all = await loadLikes();
    const list = all[date] ?? [];
    if (list.some((t) => t.id === id)) {
      const rest = list.filter((t) => t.id !== id);
      if (rest.length) all[date] = rest;
      else delete all[date];
      await saveLikes();
    }
    return dayView(date);
  });
}
