import { request } from "./http";
import type { LocalAlbum, LocalRoot, Playlist, Track } from "./types";

/**
 * What only the Musike server offers (the web app on a home server): its own music folders, YouTube playlist import,
 * tracks kept on the server and direct links. The Android backend has none of it; check `capabilities.serverLibrary`.
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

export interface PlaylistImport {
  playlist: Playlist;
  created: boolean;
  added: number;
  skipped: number;
  total: number;
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
  importPlaylist: (url: string, name?: string) =>
    request<PlaylistImport>("/api/import/youtube", { method: "POST", json: { url, name } }),

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
