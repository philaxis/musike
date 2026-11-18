import type { FastifyInstance } from "fastify";
import { msg } from "./i18n.js";
import { aliases } from "./ledger.js";
import { loadPlays } from "./plays.js";
import {
  AGO_SPAN,
  agoWindow,
  albumCards,
  albumShelves,
  dailyAlbums,
  firstSunMonth,
  lastListens,
  listensBetween,
  sunAgo,
  sunCounts,
  sunMonth,
} from "./shelves.js";
import { dayOf, loadLikes, periodStart, present, presentLike } from "./stats.js";
import { loadWorks } from "./tasteRoutes.js";
import { HttpError, type Track } from "./types.js";

// Home (changes every day: what to listen to now) and Library (stays put: find my music), and the 「오늘 좋음 ☀」 page
// (#26). The lists are worked out in shelves.ts.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Home's 「1년 전 이맘때」 row: how many tracks at most. */
const YEAR_AGO_SIZE = 20;

async function currentAlbums() {
  const [{ works }, { plays }] = await Promise.all([loadWorks(), loadPlays()]);
  return { ready: works.taste.songs.length > 0, cards: albumCards(works, lastListens(plays)), plays };
}

export function registerHomeRoutes(app: FastifyInstance) {
  /**
   * Albums of my tracks with 3 or more of them, one shelf per genre (most albums first), each heard lately first and
   * then by name. `genre` keeps to one shelf; `limit` cuts each shelf's albums (`count` stays the whole shelf's).
   */
  app.get("/api/works/albums", async (req) => {
    const { genre, limit } = req.query as { genre?: string; limit?: string };
    const { ready, cards } = await currentAlbums();
    const max = Number(limit);
    const shelves = albumShelves(genre ? cards.filter((c) => c.genre === genre) : cards, Number.isInteger(max) && max > 0 ? max : Infinity);
    if (genre && !shelves.length) throw new HttpError(404, msg("tasteGenreNotFound"));
    return { ready, total: genre ? shelves[0].count : cards.length, shelves };
  });

  /**
   * What Home shows besides the mixes and today's ☀: 8 albums not heard in 30 days (the Seoul date seeds the pick, so
   * it stays all day) and 「1년 전 이맘때」, that day's ☀ and listens a year ago ±7 days (null when there are none).
   */
  app.get("/api/home", async () => {
    const now = Date.now();
    const today = dayOf(now);
    const [{ cards, plays }, likes, { resolve }] = await Promise.all([currentAlbums(), loadLikes(), aliases()]);
    const { from, to } = agoWindow(today);
    const liked = Object.keys(likes)
      .filter((d) => d >= from && d <= to)
      .sort()
      .flatMap((d) => likes[d]);
    const seen = new Set<string>();
    const tracks: Track[] = [];
    for (const t of await Promise.all(liked.map((l) => presentLike(l, resolve)))) {
      if (!seen.has(t.id) && !t.blocked) tracks.push(t);
      seen.add(t.id);
    }
    const sunCount = tracks.length;
    const heard = listensBetween(plays, from, to).filter((c) => !seen.has(c.id)).slice(0, YEAR_AGO_SIZE);
    for (const t of await Promise.all(heard.map((c) => present(c.play)))) if (!t.blocked) tracks.push(t);
    return {
      date: today,
      albums: dailyAlbums(cards, today, now),
      yearAgo: tracks.length ? { from, to, liked: sunCount, tracks: tracks.slice(0, YEAR_AGO_SIZE) } : null,
    };
  });

  /** 「오늘 좋음」 tracks by on how many days they got ☀ (the last 28 days, or ever), then the latest first. */
  app.get("/api/daylikes/top", async (req) => {
    const { period = "4w" } = req.query as { period?: string };
    if (period !== "4w" && period !== "all") throw new HttpError(400, msg("invalidPeriod"));
    const [all, { resolve }] = await Promise.all([loadLikes(), aliases()]);
    const from = period === "4w" ? dayOf(periodStart("4w", Date.now())!) : undefined;
    const items = await Promise.all(
      sunCounts(all, resolve, from).map(async (c) => ({ track: await presentLike(c.like, resolve), days: c.days, last: c.last })),
    );
    return { period, items };
  });

  /** A month's days with ☀ (each with its first ☀, for the cover); `first` is the month of the first ☀ ever. */
  app.get("/api/daylikes/calendar", async (req) => {
    const { month = dayOf(Date.now()).slice(0, 7) } = req.query as { month?: string };
    if (!MONTH.test(month)) throw new HttpError(400, msg("invalidMonth"));
    const [all, { resolve }] = await Promise.all([loadLikes(), aliases()]);
    const days = await Promise.all(
      sunMonth(all, resolve, month).map(async (d) => ({ date: d.date, count: d.count, track: await presentLike(d.first, resolve) })),
    );
    return { month, first: firstSunMonth(all), days };
  });

  /** 「이맘때」: ☀ of the same ±7 days in earlier years, the nearest year first. */
  app.get("/api/daylikes/ago", async () => {
    const today = dayOf(Date.now());
    const [all, { resolve }] = await Promise.all([loadLikes(), aliases()]);
    const items = await Promise.all(
      sunAgo(all, resolve, today).map(async (a) => ({ track: await presentLike(a.like, resolve), date: a.date, years: a.years })),
    );
    return { date: today, span: AGO_SPAN, items };
  });
}
