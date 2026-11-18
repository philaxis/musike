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
