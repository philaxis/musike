import { msg } from "./i18n.js";
import * as library from "./library.js";
import { HttpError, VIDEO_ID, type Playlist, type Track } from "./types.js";
import { run } from "./ytdlp.js";

// YouTube / YouTube Music playlist links → Musike playlists. Only the list is read (yt-dlp --flat-playlist);
// nothing is downloaded, tracks stream through the server when played.

const LIST_TIMEOUT_MS = 180_000;
const CACHE_MS = 5 * 60_000;
const MAX_TRACKS = 5000;
/** Liked videos, Watch later, Liked music: they need a signed-in account, which this server doesn't have. */
const LOGIN_ONLY = ["LL", "WL", "LM"];
const LIST_ID = /^[A-Za-z0-9_-]{2,80}$/;
const BARE_LIST_ID = /^(PL|OLAK5uy_|UU|RD)[A-Za-z0-9_-]{10,}$/;
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com)$|^youtu\.be$/i;

export interface PlaylistLink {
  listId: string;
  /** What yt-dlp reads. */
  url: string;
  /** music.youtube.com links and album lists hold songs rather than videos. */
  music: boolean;
}

/**
 * The playlist a link points to: `playlist?list=`, `watch?v=…&list=` (the list, not the video), music.youtube.com,
 * album lists (OLAK5uy_…) or a bare list ID. Null when it isn't a playlist link; login-only lists are refused.
 */
export function parsePlaylistLink(input: string): PlaylistLink | null {
  const s = input.trim();
  let listId: string | null = null;
  let video: string | null = null;
  let music = false;
  if (BARE_LIST_ID.test(s) || LOGIN_ONLY.includes(s)) {
    listId = s;
  } else {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    } catch {
      return null;
    }
    if (!YOUTUBE_HOST.test(url.hostname)) return null;
    listId = url.searchParams.get("list");
    video = url.searchParams.get("v");
    music = /^music\./i.test(url.hostname);
  }
  if (!listId || !LIST_ID.test(listId)) return null;
  if (LOGIN_ONLY.includes(listId)) throw new HttpError(400, msg("loginRequired"));
  // Mixes (RD…) only exist around a video.
  const url =
    listId.startsWith("RD") && video && VIDEO_ID.test(video)
      ? `https://www.youtube.com/watch?v=${video}&list=${listId}`
      : `https://www.youtube.com/playlist?list=${listId}`;
  return { listId, url, music: music || listId.startsWith("OLAK5uy_") };
}

interface FlatEntry {
  id?: string;
  title?: string;
  duration?: number | null;
  channel?: string | null;
  uploader?: string | null;
  availability?: string | null;
}

export interface YoutubePlaylist {
  title: string;
  tracks: Track[];
  /** Private or deleted entries left out. */
  skipped: number;
}

const UNPLAYABLE_TITLE = /^\[(Private|Deleted) video\]$/i;
const UNPLAYABLE_AVAILABILITY = ["private", "needs_auth", "premium_only", "subscriber_only"];
const cache = new Map<string, { at: number; list: Promise<YoutubePlaylist> }>();

function toPlaylist(data: { title?: string; entries?: FlatEntry[] }, link: PlaylistLink): YoutubePlaylist {
  const seen = new Set<string>();
  const tracks: Track[] = [];
  let skipped = 0;
  for (const e of data.entries ?? []) {
    const id = e.id ?? "";
    if (!VIDEO_ID.test(id) || UNPLAYABLE_TITLE.test(e.title ?? "") || UNPLAYABLE_AVAILABILITY.includes(e.availability ?? "")) {
      skipped++;
      continue;
    }
    if (seen.has(id) || tracks.length >= MAX_TRACKS) continue;
    seen.add(id);
    const channel = e.channel ?? e.uploader ?? "";
    tracks.push({
      id,
      title: (e.title ?? "").slice(0, 300) || id,
      artist: channel.replace(/ - Topic$/, "").slice(0, 300),
      duration: Math.max(0, Math.round(e.duration ?? 0)),
      // Same images as YouTube search results (search.ts).
      thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      art: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
      kind: link.music || / - Topic$/.test(channel) ? "song" : "video",
    });
  }
  const title = (data.title ?? "").replace(/^Album - /, "").trim();
  return { title, tracks, skipped };
}

/** Reads a playlist's entries (cached for a few minutes, so a preview followed by an import asks YouTube once). */
export function readPlaylist(input: string): Promise<YoutubePlaylist> {
  const link = parsePlaylistLink(input);
  if (!link) throw new HttpError(400, msg("notPlaylistUrl"));
  const hit = cache.get(link.url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  const list = run(["-J", "--flat-playlist", "--no-warnings", link.url], LIST_TIMEOUT_MS).then((stdout) =>
    toPlaylist(JSON.parse(stdout) as { title?: string; entries?: FlatEntry[] }, link),
  );
  cache.set(link.url, { at: Date.now(), list });
  list.catch(() => cache.delete(link.url));
  return list;
}

export async function previewPlaylist(input: string) {
  const list = await readPlaylist(input);
  return { title: list.title, count: list.tracks.length, skipped: list.skipped, tracks: list.tracks.slice(0, 20) };
}

export interface ImportedPlaylist {
  playlist: Playlist;
  created: boolean;
  added: number;
  skipped: number;
  total: number;
}

/** Creates a playlist named after the YouTube one; when it exists already, only the missing tracks are appended. */
export async function importPlaylist(input: string, name?: string): Promise<ImportedPlaylist> {
  const list = await readPlaylist(input);
  if (!list.tracks.length) throw new HttpError(404, msg("playlistEmpty"));
  const finalName = (name?.trim() || list.title || "YouTube").slice(0, 80).trim();
  const existing = (await library.getLibrary()).playlists.find((p) => p.name.toLocaleLowerCase() === finalName.toLocaleLowerCase());
  const base = { skipped: list.skipped, total: list.tracks.length };
  if (existing) {
    const before = existing.tracks.length;
    const playlist = await library.addToPlaylist(existing.id, list.tracks);
    return { playlist, created: false, added: playlist.tracks.length - before, ...base };
  }
  const playlist = await library.createPlaylist(finalName, list.tracks);
  return { playlist, created: true, added: list.tracks.length, ...base };
}
