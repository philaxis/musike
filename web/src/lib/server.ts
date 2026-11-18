import { request } from "./http";
import type { Bundle, LocalAlbum, LocalRoot, Playlist, Track } from "./types";

/**
 * What only the Musike server offers (the web app on a home server): its own music folders, YouTube playlist import,
 * tracks kept on the server, direct links, the song box with its tags, bundles and the connected YouTube account.
 * The Android backend has none of it; check `capabilities.serverLibrary`.
 */

/** Local tracks: `L` + 20 characters (YouTube ids are 11). */
export const isLocalId = (id: string) => id.length === 21 && id.startsWith("L");
export const isLocal = (t: Pick<Track, "id" | "source">) => t.source === "local" || isLocalId(t.id);

export interface PlaylistPreview {
  title: string;
  count: number;
  /** The first ones only. */
  tracks: Track[];
}

/** Where a song-box track came from: a YouTube playlist (`ref` its ID), the liked videos, a music folder, a link, a search. */
export interface BoxSource {
  kind: "youtube-playlist" | "youtube-liked" | "local" | "link" | "search";
  ref: string;
  name: string;
  /** When it first came from there (ms); 0 for music folders. */
  at: number;
}

export interface BoxItem {
  track: Track;
  sources: BoxSource[];
  tags: string[];
  addedAt: number;
  /** Deleted or made private on YouTube; still kept. */
  gone?: true;
}

export interface BoxQuery {
  filter?: "untagged";
  /** A source kind, or kind:ref for one playlist or folder. */
  source?: string;
  tag?: string;
  /** Words in the title, artist, album, tags or source names. */
  q?: string;
  cursor?: string;
}

export interface BoxPage {
  items: BoxItem[];
  total: number;
  /** Cursor of the next 200, null at the end. */
  next: string | null;
}

export interface BoxImport {
  title: string;
  added: number;
  merged: number;
  skipped: number;
  total: number;
}

export interface TagEdit {
  updated: string[];
  /** Tracks that are neither in the box, the music folders nor bundles. */
  missing: string[];
}

export interface Versions {
  works: string[];
  originals: { track: Track; tags: string[] }[];
  arrangements: { track: Track; tags: string[] }[];
}

export interface GoogleStatus {
  connected: boolean;
  email?: string | null;
  /** Why not connected: no sign-in settings on the server, never connected, or Google ended the connection. */
  reason?: "no_client" | "not_connected" | "revoked";
}

export interface GooglePlaylist {
  id: string;
  title: string;
  count: number;
  privacy: string;
  thumb: string;
  excluded: boolean;
}

export interface GoogleSync {
  added: { id: string; title: string; source: string }[];
  merged: number;
  gone: number;
  playlists: number;
}

export type KeepStatus = "downloading" | "done" | "error";

export interface KeepItem {
  id: string;
  status: KeepStatus;
  /** 0–1 while downloading, when the server knows. */
  progress?: number;
}

/** What to hide or show again: local tracks, a whole music folder, or both. */
export interface HideTarget {
  ids?: string[];
  root?: string;
}

export type StatsPeriod = "4w" | "6m" | "all";

/** 「내 기록」 for a period (see server/src/stats.ts). Seconds heard; dates are Seoul's "YYYY-MM-DD". */
export interface Stats {
  period: StatsPeriod;
  /** First and last day of the calendar; `from` is null with nothing heard yet. */
  from: string | null;
  to: string;
  /** Listens ever. */
  total: number;
  summary: { seconds: number; listens: number; newTracks: number; skipRate: number; lines: number };
  /** Only the days something was heard. */
  days: { date: string; seconds: number; listens: number }[];
  /** Seconds heard by the hour a track started, 0–23. */
  hours: number[];
  topTracks: Track[];
  topArtists: { name: string; listens: number; thumb: string }[];
  /** Null without the analysis results. */
  genres: { genre: string; listens: number }[] | null;
  onRepeat: Track[];
  forgotten: Track[];
}

export interface StatsDay {
  date: string;
  seconds: number;
  listens: number;
  tracks: Track[];
  /** That day's 「오늘 좋음 ☀」. */
  liked: Track[];
}

/** One track's record; times in ms, null when never heard. */
export interface TrackRecord {
  listens: number;
  skips: number;
  lines: number;
  seconds: number;
  first: number | null;
  last: number | null;
}

export interface DayLikes {
  date: string;
  tracks: Track[];
}

/** A genre of the taste analysis: playable tracks, sound groups and four typical tracks (for the cover). */
export interface TasteGenre {
  genre: string;
  count: number;
  groups: number;
  tracks: Track[];
}

/** A sound group inside a genre; `id` is `none:<genre>` for the tracks without one. */
export interface TasteGroupCard {
  id: string;
  name: string | null;
  size: number;
  artists: string[];
  /** The most typical four. */
  tracks: Track[];
  /** Another group of the genre has the same name: an artist that sets this one apart. */
  tell: string | null;
}

export type MixKind = "daily" | "onRepeat" | "forgotten" | "newForYou" | "upbeat" | "calm";

/** An automatic playlist of today. */
export interface Mix {
  id: string;
  kind: MixKind;
  n?: number;
  /** Daily mixes: the sound group or genre they come from. */
  name?: string;
  artists: string[];
  tracks: Track[];
}

/** Where a track leads (the taste analysis' album, composer, performance); each null when the analysis lacks it. */
export interface TrackWorks {
  /** My tracks on the album; a local file's own music-folder album is `local`. */
  album: { key: string; name: string; count: number; local?: { root: string; key: string } } | null;
  composer: string | null;
  /** One recording of one work (the same string for its movements); `count` of my tracks. */
  instance: { key: string; work: string; performer: string; count: number } | null;
}

export interface Performance {
  key: string;
  composer: string | null;
  work: string;
  performer: string;
  album: string;
}

export interface ComposerCard {
  name: string;
  count: number;
  works: number;
  tracks: Track[];
}

export interface ComposerPage {
  composer: string;
  count: number;
  works: { work: string; count: number; instances: { key: string; performer: string; album: string; tracks: Track[] }[] }[];
  /** The composer's tracks without a work. */
  others: Track[];
  /** Row titles of the tracks with a movement ("II. Adagio"), by track ID. */
  titles: Record<string, string>;
}

const q = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** `hidden=1`: "내 음악" listings include hidden items, marked `hidden`. */
const shown = (showHidden: boolean) => (showHidden ? 1 : undefined);

export const server = {
  roots: (showHidden = false) =>
    request<{ roots: LocalRoot[] }>(`/api/local/roots${q({ hidden: shown(showHidden) })}`).then((r) => r.roots),
  rescan: () => request<{ roots: LocalRoot[] }>("/api/local/rescan", { method: "POST" }).then((r) => r.roots),
  albums: (root: string, showHidden: boolean, signal?: AbortSignal) =>
    request<{ albums: LocalAlbum[] }>(`/api/local/albums${q({ root, hidden: shown(showHidden) })}`, { signal }).then((r) => r.albums),
  album: (root: string, key: string, showHidden: boolean, signal?: AbortSignal) =>
    request<{ album: LocalAlbum; tracks: Track[] }>(`/api/local/album${q({ root, key, hidden: shown(showHidden) })}`, { signal }),
  searchLocal: (text: string, limit: number, signal?: AbortSignal) =>
    request<{ tracks: Track[] }>(`/api/local${q({ q: text, limit })}`, { signal }).then((r) => r.tracks),
  /** Every (shown) track of one music folder, in folder order: what 「전체 재생」 of a folder plays. */
  rootTracks: (root: string) => request<{ tracks: Track[] }>(`/api/local${q({ root, limit: 5000 })}`).then((r) => r.tracks),
  hiddenItems: () => request<{ ids: string[]; roots: string[] }>("/api/local/hidden"),
  hide: (target: HideTarget) => request<unknown>("/api/local/hidden", { method: "POST", json: target }),
  unhide: (target: HideTarget) => request<unknown>("/api/local/hidden", { method: "DELETE", json: target }),

  /** Any track by id, local or YouTube: what a /play/<id> link opens. */
  track: (id: string, signal?: AbortSignal) =>
    request<{ track: Track }>(`/api/track/${encodeURIComponent(id)}`, { signal }).then((r) => r.track),
  /** The local track of a file on the server, by its absolute path: what an /open?path= link opens. */
  lookup: (path: string, signal?: AbortSignal) =>
    request<{ track: Track }>(`/api/local/lookup${q({ path })}`, { signal }).then((r) => r.track),

  /** Saves a playlist's new order: `ids` must be exactly its tracks, rearranged. */
  reorderPlaylist: (id: string, ids: string[]) => request<Playlist>(`/api/playlists/${id}/tracks`, { method: "PUT", json: { ids } }),

  previewPlaylist: (url: string, signal?: AbortSignal) =>
    request<PlaylistPreview>(`/api/import/youtube/preview${q({ url })}`, { signal }),
  /** Every track of a pasted playlist link into the song box; no playlist is made. */
  importToBox: (url: string) => request<BoxImport>("/api/import/youtube/box", { method: "POST", json: { url } }),

  box: (query: BoxQuery, signal?: AbortSignal) => request<BoxPage>(`/api/box${q({ ...query })}`, { signal }),
  boxSources: () => request<{ sources: (Omit<BoxSource, "at"> & { count: number })[]; total: number }>("/api/box/sources"),
  /** YouTube tracks into the box, as added by hand. */
  addToBox: (tracks: Track[]) => request<unknown>("/api/box", { method: "POST", json: { tracks, source: { kind: "link" } } }),

  tags: () => request<{ tags: { tag: string; count: number }[] }>("/api/tags").then((r) => r.tags),
  addTags: (ids: string[], tags: string[]) => request<TagEdit>("/api/tags", { method: "POST", json: { ids, tags } }),
  removeTags: (ids: string[], tags: string[]) => request<TagEdit>("/api/tags", { method: "DELETE", json: { ids, tags } }),
  versions: (id: string) => request<Versions>(`/api/tracks/${id}/versions`),

  bundle: (id: string) => request<Bundle>(`/api/bundles/${id}`),

  googleStatus: () => request<GoogleStatus>("/api/google/status"),
  googlePlaylists: () => request<{ playlists: GooglePlaylist[] }>("/api/google/playlists").then((r) => r.playlists),
  setGoogleExcluded: (ids: string[]) => request<unknown>("/api/google/excluded", { method: "PUT", json: { ids } }),
  googleSync: () => request<GoogleSync>("/api/google/sync", { method: "POST" }),
  googleDisconnect: () => request<unknown>("/api/google", { method: "DELETE" }),

  keepList: () => request<{ items: KeepItem[] }>("/api/keep").then((r) => r.items),
  keep: (id: string) => request<{ id: string; status: KeepStatus }>(`/api/keep/${id}`, { method: "POST" }),
  unkeep: (id: string) => request<void>(`/api/keep/${id}`, { method: "DELETE" }),

  stats: (period: StatsPeriod, signal?: AbortSignal) => request<Stats>(`/api/stats${q({ period })}`, { signal }),
  statsDay: (date: string, signal?: AbortSignal) => request<StatsDay>(`/api/stats/day/${date}`, { signal }),
  trackRecord: (id: string, signal?: AbortSignal) => request<TrackRecord>(`/api/stats/track/${id}`, { signal }),
  /** Today's (Seoul) 「오늘 좋음 ☀」: the server says which day that is. */
  dayLikes: () => request<DayLikes>("/api/daylikes"),
  likeToday: (track: Track) => request<DayLikes>(`/api/daylikes/${track.id}`, { method: "PUT", json: track }),
  unlikeToday: (id: string) => request<DayLikes>(`/api/daylikes/${id}`, { method: "DELETE" }),

  tasteGenres: (signal?: AbortSignal) => request<{ ready: boolean; genres: TasteGenre[] }>("/api/taste/genres", { signal }),
  tasteGenre: (genre: string, signal?: AbortSignal) =>
    request<{ genre: string; count: number; groups: TasteGroupCard[] }>(`/api/taste/genres/${encodeURIComponent(genre)}`, { signal }),
  tasteGroup: (gid: string, signal?: AbortSignal) =>
    request<{ group: { id: string; name: string | null; genre: string; artists: string[] }; tracks: Track[] }>(
      `/api/taste/groups/${encodeURIComponent(gid)}`,
      { signal },
    ),
  /** Alike tracks of an analysed track, it first; `analyzed: false` when the analysis doesn't have it. */
  tasteRadio: (id: string, signal?: AbortSignal) =>
    request<{ analyzed: boolean; seed: Track | null; tracks: Track[] }>(`/api/taste/radio/${id}`, { signal }),
  mixes: (signal?: AbortSignal) => request<{ ready: boolean; mixes: Mix[] }>("/api/taste/mixes", { signal }),
  mix: (id: string, signal?: AbortSignal) => request<Mix>(`/api/taste/mixes/${encodeURIComponent(id)}`, { signal }),
  trackWorks: (id: string, signal?: AbortSignal) => request<TrackWorks>(`/api/works/track/${id}`, { signal }),
  workAlbum: (key: string, signal?: AbortSignal) =>
    request<{ album: { key: string; name: string; artists: string[] }; tracks: Track[]; titles: Record<string, string> }>(
      `/api/works/album${q({ key })}`,
      { signal },
    ),
  performance: (key: string, signal?: AbortSignal) =>
    request<{ instance: Performance; tracks: Track[]; titles: Record<string, string> }>(`/api/works/instance${q({ key })}`, { signal }),
  composers: (genre: string | undefined, signal?: AbortSignal) =>
    request<{ ready: boolean; composers: ComposerCard[] }>(`/api/works/composers${q({ genre })}`, { signal }),
  composer: (name: string, signal?: AbortSignal) => request<ComposerPage>(`/api/works/composer${q({ name })}`, { signal }),
};

/** A YouTube / YouTube Music playlist link (playlist?list=, watch?v=…&list=, album OLAK5uy_…), or null. */
export function playlistUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    const list = url.searchParams.get("list");
    // Radio mixes (RD…) are endless and made up per viewer: not a list to import.
    return list && /^[A-Za-z0-9_-]{2,}$/.test(list) && !list.startsWith("RD") ? url.href : null;
  } catch {
    return null;
  }
}
