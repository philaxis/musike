import { isListen, type Play } from "./plays.js";
import { dayStart } from "./stats.js";
import { seeded, shuffleWith } from "./taste.js";
import type { Track } from "./types.js";
import { albumName, type Works } from "./works.js";

// Home and Library (#26 「홈은 매일 바뀌고, 보관함은 그대로」): the albums of my tracks by genre (Library), today's
// albums to take out again and a year ago (Home), and the 「오늘 좋음 ☀」 lists (the ☀ page). Pure functions; the
// routes are in homeRoutes.ts. Days are Seoul's "YYYY-MM-DD".

const DAY = 86_400_000;
/** An album on the shelves has at least this many of my tracks. */
export const ALBUM_MIN = 3;
/** Home's 「오늘 꺼내 볼 앨범」: how many, and how long an album must have gone unheard. */
export const DAILY_ALBUMS = 8;
const UNHEARD_DAYS = 30;
/** 「이맘때」: this many days either side of the same date in an earlier year. */
export const AGO_SPAN = 7;

export interface AlbumCard {
  key: string;
  name: string;
  /** Its main artists, most tracks first (two at most). */
  artists: string[];
  /** The analysis' genre most of its tracks have. */
  genre: string;
  count: number;
  /** When one of its tracks was last listened to (ms), 0 when never. */
  last: number;
  /** Its first track, for the cover. */
  cover: Track;
}

/** When each track was last listened to (「한 번 들음」), by ID. `plays` already follow the video ledger's aliases. */
export function lastListens(plays: Play[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of plays) if (isListen(p) && p.startedAt > (out.get(p.id) ?? 0)) out.set(p.id, p.startedAt);
  return out;
}

function mostCommon(values: string[], count: number): string[] {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, count).map(([v]) => v);
}

/** Albums of my tracks with at least `min` of them, in no particular order. */
export function albumCards(works: Works, last: Map<string, number>, min = ALBUM_MIN): AlbumCard[] {
  const out: AlbumCard[] = [];
  for (const [key, ids] of works.albums) {
    if (ids.length < min) continue;
    const tracks = ids.map((i) => works.known.get(works.taste.songs[i].id)!);
    out.push({
      key,
      name: albumName(key),
      artists: mostCommon(tracks.map((t) => t.artist), 2),
      genre: mostCommon(ids.map((i) => works.taste.songs[i].genre), 1)[0] ?? "",
      count: ids.length,
      last: Math.max(0, ...tracks.map((t) => last.get(t.id) ?? 0)),
      cover: tracks[0],
    });
  }
  return out;
}

/** Library's order, the same every visit: albums heard lately first, then the rest by name. */
export const shelfOrder = (a: AlbumCard, b: AlbumCard) =>
  b.last - a.last || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.key.localeCompare(b.key);

export interface Shelf {
  genre: string;
  /** Albums in the genre (all of them, even when `albums` is cut short). */
  count: number;
  albums: AlbumCard[];
}

/** One shelf per genre, the genre with the most albums first; `limit` cuts each shelf's albums. */
export function albumShelves(cards: AlbumCard[], limit = Infinity): Shelf[] {
  const by = new Map<string, AlbumCard[]>();
  for (const c of cards) by.set(c.genre, [...(by.get(c.genre) ?? []), c]);
  return [...by]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([genre, albums]) => ({ genre, count: albums.length, albums: albums.sort(shelfOrder).slice(0, limit) }));
}

/** Home's 「오늘 꺼내 볼 앨범」: albums not heard in 30 days, shuffled with the Seoul date as seed (the same all day). */
export function dailyAlbums(cards: AlbumCard[], day: string, now: number, count = DAILY_ALBUMS): AlbumCard[] {
  const pool = cards.filter((c) => c.last < now - UNHEARD_DAYS * DAY).sort((a, b) => a.key.localeCompare(b.key));
  return shuffleWith(pool, seeded(`${day}:albums`)).slice(0, count);
}

const dayNo = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
const dateOfNo = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** The same date `years` earlier (29 February becomes 28 February). */
export function yearsBefore(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const back = new Date(Date.UTC(y - years, m - 1, d));
  return back.getUTCMonth() === m - 1 ? back.toISOString().slice(0, 10) : new Date(Date.UTC(y - years, m, 0)).toISOString().slice(0, 10);
}

/** The ±7 days around the same date a year (or `years`) before. */
export function agoWindow(today: string, years = 1, span = AGO_SPAN): { from: string; to: string } {
  const mid = dayNo(yearsBefore(today, years));
  return { from: dateOfNo(mid - span), to: dateOfNo(mid + span) };
}

/** How many years before `today` a date falls in that year's ±7-day window, or null when in none. */
export function yearsAgo(date: string, today: string, span = AGO_SPAN): number | null {
  const n = dayNo(date);
  const years = Number(today.slice(0, 4)) - Number(date.slice(0, 4));
  // Near New Year a window can reach into the year before or after its date's.
  for (const k of [years - 1, years, years + 1]) {
    if (k < 1) continue;
    if (Math.abs(n - dayNo(yearsBefore(today, k))) <= span) return k;
  }
  return null;
}

/** A 「오늘 좋음」 entry as daylikes.json keeps it. */
export type Like = Track & { at: number };
export type LikeDays = Record<string, Like[]>;

export interface SunCount {
  /** The track ID of now (a replaced video counts for the one in its place). */
  id: string;
  /** On how many days it got ☀, and the last of them. */
  days: number;
  last: string;
  /** Its latest entry. */
  like: Like;
}

/**
 * Tracks by how many days they got ☀ (from `from` on, else ever), then the latest first. A replaced video's days count
 * for the one in its place; a track liked under both IDs one day counts once.
 */
export function sunCounts(all: LikeDays, resolve: (id: string) => string, from?: string): SunCount[] {
  const by = new Map<string, SunCount>();
  for (const date of Object.keys(all).sort()) {
    if (from && date < from) continue;
    const seen = new Set<string>();
    for (const like of all[date]) {
      const id = resolve(like.id);
      const c = by.get(id);
      if (!seen.has(id)) {
        seen.add(id);
        if (c) c.days++;
        else by.set(id, { id, days: 1, last: date, like });
      }
      const now = by.get(id)!;
      now.last = date;
      if (like.at >= now.like.at) now.like = like;
    }
  }
  return [...by.values()].sort((a, b) => b.days - a.days || b.last.localeCompare(a.last) || b.like.at - a.like.at);
}

export interface SunDay {
  date: string;
  /** Tracks that got ☀ that day. */
  count: number;
  /** The day's first ☀ (its cover). */
  first: Like;
}

/** The days of a month ("YYYY-MM") with ☀, in date order. */
export function sunMonth(all: LikeDays, resolve: (id: string) => string, month: string): SunDay[] {
  return Object.keys(all)
    .filter((d) => d.startsWith(`${month}-`) && all[d].length > 0)
    .sort()
    .map((date) => {
      const list = [...all[date]].sort((a, b) => a.at - b.at);
      return { date, count: new Set(list.map((l) => resolve(l.id))).size, first: list[0] };
    });
}

/** The month ("YYYY-MM") of the first ☀ ever, or null. */
export function firstSunMonth(all: LikeDays): string | null {
  const first = Object.keys(all)
    .filter((d) => all[d].length > 0)
    .sort()[0];
  return first ? first.slice(0, 7) : null;
}

export interface SunAgo {
  id: string;
  date: string;
  years: number;
  like: Like;
}

/** ☀ of the same ±7 days in earlier years, the nearest year first, each track once (its latest such day). */
export function sunAgo(all: LikeDays, resolve: (id: string) => string, today: string, span = AGO_SPAN): SunAgo[] {
  const by = new Map<string, SunAgo>();
  for (const date of Object.keys(all).sort()) {
    const years = yearsAgo(date, today, span);
    if (years === null) continue;
    for (const like of all[date]) {
      const id = resolve(like.id);
      by.set(id, { id, date, years, like });
    }
  }
  return [...by.values()].sort((a, b) => a.years - b.years || b.date.localeCompare(a.date) || b.like.at - a.like.at);
}

/** Listens in a window of days (`from`–`to` inclusive), most listened first: ID, count and its latest log line. */
export function listensBetween(plays: Play[], from: string, to: string): { id: string; listens: number; play: Play }[] {
  const start = dayStart(from);
  const end = dayStart(to) + DAY;
  const by = new Map<string, { id: string; listens: number; play: Play }>();
  for (const p of plays) {
    if (p.startedAt < start || p.startedAt >= end || !isListen(p)) continue;
    const c = by.get(p.id);
    if (c) {
      c.listens++;
      c.play = p;
    } else by.set(p.id, { id: p.id, listens: 1, play: p });
  }
  return [...by.values()].sort((a, b) => b.listens - a.listens || b.play.startedAt - a.play.startedAt);
}
