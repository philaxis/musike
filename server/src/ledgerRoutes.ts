import type { FastifyInstance } from "fastify";
import * as box from "./box.js";
import { checkBox, videoTrack } from "./google.js";
import { msg } from "./i18n.js";
import * as ledger from "./ledger.js";
import { HttpError, VIDEO_ID, type Track } from "./types.js";

// The video ledger's API (see ledger.ts): the 「변경 기록」 list, one track's history, and a check on demand.

const PAGE = 100;

/** A video as the ledger last saw it on YouTube. */
async function videoOf(id: string) {
  const rec = await ledger.videoRecord(id);
  return { id, title: rec?.title ?? "", channel: rec?.channel ?? "" };
}

/**
 * Events as the app shows them: each with `track`, the track standing for that video now as the box shows it (the
 * user's title; the new video after a replacement), `video`, the event's own video as YouTube named it, and for a
 * replacement or an undo `other`, the video on the other side.
 */
async function present(events: ledger.VideoEvent[]) {
  const { resolve } = await ledger.aliases();
  const annotate = await box.annotator();
  const tracks = new Map<string, Promise<Track>>();
  const trackOf = (id: string) => {
    let t = tracks.get(id);
    if (!t) {
      t = (async () => {
        const found = await box.findTrack(id);
        if (found) return annotate(found);
        const rec = await ledger.videoRecord(id);
        return videoTrack(id, rec?.title ?? "", rec?.channel ?? "", rec?.duration ?? 0);
      })();
      tracks.set(id, t);
    }
    return t;
  };
  return Promise.all(
    events.map(async (e) => ({
      ...e,
      track: await trackOf(resolve(e.id)),
      video: await videoOf(e.id),
      ...(e.kind === "replaced" ? { other: await videoOf(e.to) } : e.kind === "restored" ? { other: await videoOf(e.from) } : {}),
    })),
  );
}

export function registerLedgerRoutes(app: FastifyInstance) {
  /** `?cursor=&limit=`: changes newest first (100 a page), and how many recorded videos have each status. */
  app.get("/api/videos/events", async (req) => {
    const { cursor, limit } = req.query as { cursor?: string; limit?: string };
    const n = Math.min(Math.max(Number(limit) || PAGE, 1), 500);
    const page = await ledger.recentEvents(n, Math.max(Number(cursor) || 0, 0));
    return { events: await present(page.events), total: page.total, next: page.next === null ? null : String(page.next), summary: await ledger.summary() };
  });

  /** One track's record: what YouTube last said of it, and every change of it or of the videos it stands for. */
  app.get("/api/videos/:id", async (req) => {
    const id = (req.params as { id?: string }).id ?? "";
    if (!VIDEO_ID.test(id)) throw new HttpError(400, msg("invalidVideoId"));
    const ids = await ledger.family(id);
    const { events } = await ledger.recentEvents(Number.MAX_SAFE_INTEGER, 0, ids);
    return { video: await ledger.videoRecord(id), current: (await ledger.aliases()).resolve(id), events: await present(events) };
  });

  /** Checks every box video now (as an account sync does after bringing tracks in). */
  app.post("/api/videos/check", () => checkBox());
}
