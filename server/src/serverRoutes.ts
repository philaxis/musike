import type { FastifyInstance, FastifyRequest } from "fastify";
import { parseTarget } from "./hidden.js";
import { langOf, msg } from "./i18n.js";
import { keep, keepItems, unkeep } from "./keep.js";
import * as local from "./local.js";
import { importPlaylist, previewPlaylist } from "./playlistImport.js";
import * as library from "./library.js";
import { HttpError, isBundleId, isLocalId, LOCAL_ID, TRACK_ID, type Track } from "./types.js";
import { resolveStreams } from "./ytdlp.js";

// Routes of the server edition: "내 음악" (local folders), YouTube playlist import, keep on server, track lookup.

export function trackId(params: unknown): string {
  const id = (params as { id?: string }).id ?? "";
  if (!TRACK_ID.test(id)) throw new HttpError(400, msg("invalidTrackId"));
  return id;
}

/** A track ID that has media of its own: a bundle plays through its parts, each streamed by its own ID. */
export function mediaId(params: unknown): string {
  const id = trackId(params);
  if (isBundleId(id)) throw new HttpError(400, msg("bundleNotPlayable"));
  return id;
}

/** A track by ID for links like /play/<id>: local ones from the index, YouTube ones resolved by yt-dlp. */
async function anyTrack(id: string): Promise<Track> {
  if (isBundleId(id)) return library.bundleTrack(await library.getBundle(id));
  if (isLocalId(id)) {
    const t = local.localTrack(id);
    if (!t) throw new HttpError(404, msg("localNotFound"));
    return t;
  }
  const kept = local.keptFile(id) ? local.keptTrack(id) : null;
  const thumbs = { thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, art: `https://i.ytimg.com/vi/${id}/hq720.jpg` };
  try {
    const r = await resolveStreams(id);
    const uploader = r.uploader ?? "";
    return {
      id,
      title: r.title,
      artist: uploader.replace(/ - Topic$/, ""),
      duration: Math.round(r.duration),
      ...thumbs,
      // Auto-generated "Artist - Topic" uploads are songs; anything else (yt-bulk links) a video.
      kind: / - Topic$/.test(uploader) ? "song" : "video",
      ...(kept ? { kept: true } : {}),
    };
  } catch (err) {
    // Gone from YouTube but kept here: still playable.
    if (!kept) throw err;
    return { id, title: kept.title, artist: kept.artist, duration: kept.duration, ...thumbs, kind: "song", kept: true };
  }
}

/** `?hidden=1`: "내 음악" listings include hidden items, marked `hidden: true`. */
const showHidden = (req: FastifyRequest) => (req.query as { hidden?: string }).hidden === "1";

export function registerServerRoutes(app: FastifyInstance) {
  app.get("/api/track/:id", async (req) => ({ track: await anyTrack(trackId(req.params)) }));

  // Local folders

  app.get("/api/local/roots", (req) => ({ roots: local.listRoots(showHidden(req)) }));

  app.post("/api/local/rescan", async () => {
    await local.rescan();
    return { roots: local.listRoots() };
  });

  app.get("/api/local/albums", (req) => {
    const { root } = req.query as { root?: string };
    return { albums: local.listAlbums(root ?? "", showHidden(req)) };
  });

  app.get("/api/local/album", (req) => {
    const { root, key } = req.query as { root?: string; key?: string };
    return local.getAlbum(root ?? "", key ?? "", showHidden(req));
  });

  app.get("/api/local", (req) => {
    const { q, root, limit } = req.query as { q?: string; root?: string; limit?: string };
    const n = Number(limit);
    const max = Number.isInteger(n) && n > 0 ? Math.min(n, 5000) : 500;
    return { tracks: local.searchLocal((q ?? "").slice(0, 200), root || undefined, max, showHidden(req)) };
  });

  // Hidden tracks and roots: left out of the listings above, never deleted.

  app.get("/api/local/hidden", () => local.hiddenItems());

  app.post("/api/local/hidden", (req) => local.hide(parseTarget(req.body)));

  app.delete("/api/local/hidden", (req) => local.unhide(parseTarget(req.body)));

  // Album files split into songs (data/segments.json): `path` is the file's path inside the root.

  app.get("/api/local/segments", (req) => {
    const { root, path } = req.query as { root?: string; path?: string };
    return local.getSegments(root ?? "", path || undefined);
  });

  app.put("/api/local/segments", (req) => {
    const { root, path } = req.query as { root?: string; path?: string };
    return local.setSegments(root ?? "", path ?? "", (req.body as { segments?: unknown } | null)?.segments);
  });

  app.get("/api/local/lookup", async (req) => {
    const { path } = req.query as { path?: string };
    return { track: await local.lookupPath(path ?? "") };
  });

  app.get("/api/local/:id/cover", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!LOCAL_ID.test(id)) throw new HttpError(400, msg("invalidTrackId"));
    return local.serveCover(req, reply, id);
  });

  // YouTube playlist import

  app.get("/api/import/youtube/preview", (req) => previewPlaylist((req.query as { url?: string }).url ?? ""));

  app.post("/api/import/youtube", (req) => {
    const { url, name } = (req.body ?? {}) as { url?: unknown; name?: unknown };
    return importPlaylist(typeof url === "string" ? url : "", typeof name === "string" ? name : undefined);
  });

  // Keep on server

  app.get("/api/keep", (req) => keepItems(langOf(req)));

  app.post("/api/keep/:id", (req) => keep((req.params as { id: string }).id));

  app.delete("/api/keep/:id", async (req, reply) => {
    await unkeep((req.params as { id: string }).id);
    return reply.code(204).send();
  });
}
