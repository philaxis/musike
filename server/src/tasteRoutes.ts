import type { FastifyInstance } from "fastify";
import * as box from "./box.js";
import { msg } from "./i18n.js";
import { aliases } from "./ledger.js";
import * as library from "./library.js";
import * as local from "./local.js";
import { buildMixes, type KnownTrack } from "./mixes.js";
import { loadPlays, type Play } from "./plays.js";
import { dayLikeIds, dayOf } from "./stats.js";
import { trackId } from "./serverRoutes.js";
import { loadTaste, probeOf, radio, simsTo, type Taste } from "./taste.js";
import { HttpError, VIDEO_ID, type Track } from "./types.js";

// The taste API (#26): genres and sound groups of the analysis, the alike-tracks radio and the automatic playlists.
// Track details (title, cover) come from the song box and the music folders; tracks in neither, and YouTube tracks
// that won't play here (put aside in the box) without a kept copy, are left out.

interface Known {
  track: Track;
  addedAt: number;
}

/** A track the analysis knows, as it can be played now (also the music map's tracks), or null. */
export async function lookup(id: string): Promise<Known | null> {
  const entry = await box.boxEntry(id);
  if (entry) {
    const track = local.annotate(entry.track);
    return entry.blocked && !track.kept ? null : { track, addedAt: entry.addedAt };
  }
  const track = local.localTrack(id);
  return track && !track.unavailable ? { track, addedAt: 0 } : null;
}

/** The analysed tracks that can be played now, by ID (also the albums and works of works.ts). */
export async function catalog(taste: Taste): Promise<Map<string, Known>> {
  const out = new Map<string, Known>();
  for (const s of taste.songs) {
    const known = await lookup(s.id);
    if (known) out.set(s.id, known);
  }
  return out;
}

/** A YouTube track known only from the listening log. */
const playTrack = (p: Play): Track => ({
  id: p.id,
  title: p.title,
  artist: p.artist,
  ...(p.album ? { album: p.album } : {}),
  duration: p.duration,
  thumb: `https://i.ytimg.com/vi/${p.id}/mqdefault.jpg`,
  art: `https://i.ytimg.com/vi/${p.id}/hq720.jpg`,
  kind: "song",
});

/** The most common artists of some tracks, most first. */
function topArtists(tracks: Track[], count: number): string[] {
  const n = new Map<string, number>();
  for (const t of tracks) if (t.artist) n.set(t.artist, (n.get(t.artist) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).slice(0, count).map(([a]) => a);
}

/** Songs of one sound group (or of a genre without a group: `none:<genre>`), most typical first. */
function groupSongs(taste: Taste, known: Map<string, Known>, gid: string): number[] {
  const none = gid.startsWith("none:") ? gid.slice(5) : null;
  const members = taste.songs
    .map((_, i) => i)
    .filter((i) => {
      const s = taste.songs[i];
      return known.has(s.id) && (none === null ? s.group === gid : s.genre === none && !s.group);
    });
  const rel = simsTo(taste, probeOf(taste, members));
  return members.sort((a, b) => rel[b] - rel[a]);
}

async function currentMixes(now = Date.now()) {
  const [taste, { plays }, lib, daylikes] = await Promise.all([loadTaste(), loadPlays(), library.getLibrary(), dayLikeIds()]);
  const known = await catalog(taste);
  // Tracks heard but not analysed (yet) still make "on repeat" and "forgotten".
  const lastPlay = new Map(plays.map((p) => [p.id, p]));
  for (const [id, p] of lastPlay) {
    if (known.has(id)) continue;
    const found = await lookup(id);
    if (found) known.set(id, found);
    else if (VIDEO_ID.test(id)) known.set(id, { track: playTrack(p), addedAt: 0 });
  }
  const mixes = buildMixes({
    taste,
    plays,
    now,
    day: dayOf(now),
    favorites: lib.favorites.map((t) => t.id),
    daylikes,
    known: new Map([...known].map(([id, k]): [string, KnownTrack] => [id, { artist: k.track.artist, addedAt: k.addedAt }])),
  });
  return {
    ready: taste.songs.length > 0,
    mixes: mixes.map(({ ids, ...mix }) => {
      const tracks = ids.map((id) => known.get(id)!.track);
      return { ...mix, artists: topArtists(tracks, 3), tracks };
    }),
  };
}

export function registerTasteRoutes(app: FastifyInstance) {
  /** Genres with how many playable tracks and sound groups each has and four typical tracks, biggest first. */
  app.get("/api/taste/genres", async () => {
    const taste = await loadTaste();
    const known = await catalog(taste);
    const genres = new Map<string, { songs: number[]; groups: Set<string> }>();
    taste.songs.forEach((s, i) => {
      if (!known.has(s.id)) return;
      const g = genres.get(s.genre) ?? { songs: [], groups: new Set() };
      g.songs.push(i);
      g.groups.add(s.group ?? "");
      genres.set(s.genre, g);
    });
    return {
      ready: taste.songs.length > 0,
      genres: [...genres]
        .sort((a, b) => b[1].songs.length - a[1].songs.length)
        .map(([genre, g]) => {
          const rel = simsTo(taste, probeOf(taste, g.songs));
          const typical = [...g.songs].sort((a, b) => rel[b] - rel[a]).slice(0, 4);
          return { genre, count: g.songs.length, groups: g.groups.size, tracks: typical.map((i) => known.get(taste.songs[i].id)!.track) };
        }),
    };
  });

  /**
   * A genre's sound groups: name, size, main artists and four typical tracks. When another group has the same name,
   * `tell` is an artist that sets this one apart (a main artist of it that isn't one of the other's).
   */
  app.get("/api/taste/genres/:genre", async (req) => {
    const { genre } = req.params as { genre: string };
    const taste = await loadTaste();
    const known = await catalog(taste);
    const ids = [...new Set(taste.songs.filter((s) => s.genre === genre && known.has(s.id)).map((s) => s.group ?? `none:${genre}`))];
    if (!ids.length) throw new HttpError(404, msg("tasteGenreNotFound"));
    const groups = ids.map((id) => {
      const songs = groupSongs(taste, known, id);
      const tracks = songs.map((i) => known.get(taste.songs[i].id)!.track);
      const name = taste.groups.find((g) => g.id === id)?.name ?? null;
      return { id, name, size: songs.length, artists: topArtists(tracks, 6), tracks: tracks.slice(0, 4) };
    });
    const rank = (id: string) => (id.startsWith("none:") ? 2 : id.endsWith("·etc") ? 1 : 0);
    groups.sort((a, b) => rank(a.id) - rank(b.id) || b.size - a.size);
    return {
      genre,
      count: groups.reduce((n, g) => n + g.size, 0),
      groups: groups.map(({ artists, ...g }) => {
        const twins = groups.filter((x) => x.id !== g.id && !!g.name && x.name === g.name);
        const theirs = new Set(twins.flatMap((x) => x.artists.slice(0, 3)));
        const tell = twins.length ? (artists.find((a) => !theirs.has(a)) ?? artists[0] ?? null) : null;
        return { ...g, artists: artists.slice(0, 3), tell };
      }),
    };
  });

  app.get("/api/taste/groups/:gid", async (req) => {
    const { gid } = req.params as { gid: string };
    const taste = await loadTaste();
    const known = await catalog(taste);
    const songs = groupSongs(taste, known, gid);
    if (!songs.length) throw new HttpError(404, msg("tasteGroupNotFound"));
    const tracks = songs.map((i) => known.get(taste.songs[i].id)!.track);
    const group = taste.groups.find((g) => g.id === gid);
    return {
      group: { id: gid, name: group?.name ?? null, genre: group?.genre ?? taste.songs[songs[0]].genre, artists: topArtists(tracks, 3) },
      tracks,
    };
  });

  /**
   * The alike-tracks radio of an analysed track, the track first; `analyzed: false` for one the analysis lacks. A
   * replaced video's radio is that of the video in its place.
   */
  app.get("/api/taste/radio/:id", async (req) => {
    const id = (await aliases()).resolve(trackId(req.params));
    const taste = await loadTaste();
    const seed = taste.index.get(id);
    if (seed === undefined) return { analyzed: false, seed: null, tracks: [] };
    const known = await catalog(taste);
    const seedTrack = known.get(id)?.track ?? (await box.findTrack(id));
    const picked = radio(
      taste,
      seed,
      (i) => known.has(taste.songs[i].id),
      (i) => (i === seed ? seedTrack?.artist ?? "" : known.get(taste.songs[i].id)!.track.artist),
    );
    const tracks = picked.map((i) => (i === seed ? seedTrack : known.get(taste.songs[i].id)!.track)).filter((t): t is Track => !!t);
    return { analyzed: true, seed: seedTrack, tracks };
  });

  app.get("/api/taste/mixes", () => currentMixes());

  app.get("/api/taste/mixes/:mid", async (req) => {
    const { mid } = req.params as { mid: string };
    const mix = (await currentMixes()).mixes.find((m) => m.id === mid);
    if (!mix) throw new HttpError(404, msg("mixNotFound"));
    return mix;
  });
}
