import type { FastifyInstance } from "fastify";
import * as box from "./box.js";
import { langOf, msg } from "./i18n.js";
import * as library from "./library.js";
import * as local from "./local.js";
import { parsePlaylistLink, readPlaylist } from "./playlistImport.js";
import { trackId } from "./serverRoutes.js";
import * as standIn from "./standIn.js";
import { BUNDLE_ID, HttpError, isBundleId, TRACK_ID, VIDEO_ID, type Bundle, type Track } from "./types.js";

// Song box, tags, bundles, and pasted playlist links into the box (see box.ts).

const MAX_IDS = 5000;

function idList(v: unknown, bundles = true): string[] {
  if (!Array.isArray(v) || !v.length || v.length > MAX_IDS) throw new HttpError(400, msg("idsRequired"));
  for (const id of v) {
    if (typeof id !== "string" || !TRACK_ID.test(id) || (!bundles && isBundleId(id))) throw new HttpError(400, msg("invalidTrackId"));
  }
  return [...new Set(v as string[])];
}

function tagList(v: unknown): string[] {
  const tags = library.cleanTags(v);
  if (!tags.length) throw new HttpError(400, msg("tagsRequired"));
  return tags;
}

function bundleId(params: unknown): string {
  const id = (params as { id?: string }).id ?? "";
  if (!BUNDLE_ID.test(id)) throw new HttpError(400, msg("invalidTrackId"));
  return id;
}

/** A bundle's parts, in the given order, from the box, the local folders or the library. */
async function parts(ids: unknown): Promise<Track[]> {
  const out: Track[] = [];
  for (const id of idList(ids, false)) {
    const t = await box.findTrack(id);
    if (!t) throw new HttpError(404, msg("trackNotFound", { id }));
    out.push(t);
  }
  return out;
}

const text = (v: unknown) => (typeof v === "string" ? v : undefined);
const presentBundle = (b: Bundle) => ({ ...b, parts: b.parts.map(local.annotate) });

function youtubeId(params: unknown): string {
  const id = (params as { id?: string }).id ?? "";
  if (!VIDEO_ID.test(id)) throw new HttpError(400, msg("invalidVideoId"));
  return id;
}

export function registerBoxRoutes(app: FastifyInstance) {
  // Song box

  app.get("/api/box", (req) => {
    const { filter, source, tag, q, cursor } = req.query as Record<string, string | undefined>;
    return box.listBox({ filter, source, tag, q: q?.slice(0, 200), cursor });
  });

  app.get("/api/box/sources", () => box.boxSources());

  /** `{ tracks, source?: { kind: "link" | "search", name? } }`: tracks the agent found, into the box. */
  app.post("/api/box", async (req) => {
    const body = (req.body ?? {}) as { tracks?: unknown; source?: { kind?: unknown; name?: unknown } };
    if (!Array.isArray(body.tracks) || !body.tracks.length) throw new HttpError(400, msg("tracksRequired"));
    const kind = body.source?.kind ?? "link";
    if (kind !== "link" && kind !== "search") throw new HttpError(400, msg("invalidSource"));
    const tracks = body.tracks.slice(0, MAX_IDS).map(library.sanitizeTrack);
    const name = (text(body.source?.name) ?? "").trim().slice(0, 200);
    const r = await box.addToBox(tracks, { kind, ref: "", name, at: Date.now() });
    return { added: r.added.length, merged: r.merged, skipped: r.skipped };
  });

  /**
   * Other versions of a track that won't play here (for a stand-in: of its original): where YouTube Music moved it
   * first, then up to 5 YouTube results with an alike title, each saying why it is offered (see `standIn.candidates`).
   */
  app.get("/api/box/:id/alternatives", async (req) => ({ alternatives: await standIn.candidates(youtubeId(req.params), langOf(req)) }));

  /** `{ track }`: puts it in place of track `id` in the box, playlists, favorites and bundles (see `box.replaceEntry`). */
  app.post("/api/box/:id/replace", async (req) => {
    const id = youtubeId(req.params);
    const track = library.sanitizeTrack(((req.body ?? {}) as { track?: unknown }).track);
    if (!VIDEO_ID.test(track.id)) throw new HttpError(400, msg("invalidTrack"));
    if (track.id === id) throw new HttpError(400, msg("sameTrack"));
    return standIn.replaceEverywhere(id, track, "manual");
  });

  /** 「되돌리기」: the original back in place of stand-in `id`, put aside again (see `standIn.restore`). */
  app.post("/api/box/:id/restore", (req) => standIn.restore(youtubeId(req.params)));

  /** A pasted playlist link: every track into the box under that playlist, no Musike playlist made. */
  app.post("/api/import/youtube/box", async (req) => {
    const url = text(((req.body ?? {}) as { url?: unknown }).url) ?? "";
    const list = await readPlaylist(url);
    const listId = parsePlaylistLink(url)!.listId;
    const r = await box.addToBox(list.tracks, { kind: "youtube-playlist", ref: listId, name: list.title || listId, at: Date.now() });
    return { title: list.title, added: r.added.length, merged: r.merged, skipped: list.skipped, total: list.tracks.length };
  });

  // Tags

  app.get("/api/tags", async () => ({ tags: await box.allTags() }));

  app.post("/api/tags", (req) => {
    const body = (req.body ?? {}) as { ids?: unknown; tags?: unknown };
    const tags = tagList(body.tags);
    return box.editTags(idList(body.ids), (have) => [...have, ...tags]);
  });

  app.delete("/api/tags", (req) => {
    const body = (req.body ?? {}) as { ids?: unknown; tags?: unknown };
    const tags = tagList(body.tags);
    return box.editTags(idList(body.ids), (have) => have.filter((t) => !tags.includes(t)));
  });

  app.get("/api/tracks/:id/versions", (req) => box.versions(trackId(req.params)));

  // Bundles

  app.post("/api/bundles", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const bundle = await library.createBundle({
      title: text(body.title),
      artist: text(body.artist),
      parts: await parts(body.ids),
      tags: library.cleanTags(body.tags),
    });
    return presentBundle(bundle);
  });

  app.get("/api/bundles/:id", async (req) => presentBundle(await library.getBundle(bundleId(req.params))));

  /** Any of `{ title, artist, ids, tags }`; `ids` replaces the parts, `tags` the tags. */
  app.patch("/api/bundles/:id", async (req) => {
    const id = bundleId(req.params);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const bundle = await library.updateBundle(id, {
      title: text(body.title),
      artist: text(body.artist),
      parts: body.ids === undefined ? undefined : await parts(body.ids),
      tags: Array.isArray(body.tags) ? library.cleanTags(body.tags) : undefined,
    });
    return presentBundle(bundle);
  });

  app.delete("/api/bundles/:id", async (req, reply) => {
    await library.deleteBundle(bundleId(req.params));
    return reply.code(204).send();
  });
}
