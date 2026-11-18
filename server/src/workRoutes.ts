import type { FastifyInstance } from "fastify";
import { msg } from "./i18n.js";
import * as local from "./local.js";
import { trackId } from "./serverRoutes.js";
import { loadTaste } from "./taste.js";
import { catalog } from "./tasteRoutes.js";
import { HttpError, isLocalId } from "./types.js";
import { albumName, albumTracks, buildWorks, composerList, composerWorks, instanceTracks, parseInstance, trackWorks } from "./works.js";

// Albums, composers and performances from the taste analysis (#26), over my tracks only (song box, music folders).

async function currentWorks() {
  const taste = await loadTaste();
  const known = await catalog(taste);
  return buildWorks(taste, new Map([...known].map(([id, k]) => [id, k.track])));
}

export function registerWorkRoutes(app: FastifyInstance) {
  /**
   * Where a track leads, each null when the analysis lacks it: its album (a local file's own music-folder album as
   * `local`), composer and performance, with how many of my tracks each holds.
   */
  app.get("/api/works/track/:id", async (req) => {
    const id = trackId(req.params);
    const info = trackWorks(await currentWorks(), id);
    if (!isLocalId(id) || !info.album) return info;
    const folder = local.albumOf(id);
    return {
      ...info,
      album: folder ? { key: info.album.key, name: folder.name, count: folder.trackCount, local: { root: folder.root, key: folder.key } } : null,
    };
  });

  // Keys and names come in the query: they can run past the router's 100-character limit for a path segment.
  // `titles`: row titles of the tracks with a movement ("II. Adagio"), by track ID; tracks keep their own title.
  app.get("/api/works/album", async (req) => {
    const { key = "" } = req.query as { key?: string };
    const { tracks, titles } = albumTracks(await currentWorks(), key);
    if (!tracks.length) throw new HttpError(404, msg("workAlbumNotFound"));
    const artists = [...new Set(tracks.map((t) => t.artist).filter(Boolean))];
    return { album: { key, name: albumName(key), artists }, tracks, titles };
  });

  app.get("/api/works/instance", async (req) => {
    const { key = "" } = req.query as { key?: string };
    const { tracks, titles } = instanceTracks(await currentWorks(), key);
    if (!tracks.length) throw new HttpError(404, msg("instanceNotFound"));
    return { instance: { key, ...parseInstance(key) }, tracks, titles };
  });

  /** Composers of my tracks, most tracks first; `genre` keeps to one genre of the analysis. */
  app.get("/api/works/composers", async (req) => {
    const { genre } = req.query as { genre?: string };
    const works = await currentWorks();
    return { ready: works.taste.songs.length > 0, composers: composerList(works, genre || undefined) };
  });

  app.get("/api/works/composer", async (req) => {
    const { name = "" } = req.query as { name?: string };
    const page = composerWorks(await currentWorks(), name);
    if (!page) throw new HttpError(404, msg("composerNotFound"));
    return page;
  });
}
