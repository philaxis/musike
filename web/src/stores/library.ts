import { create } from "zustand";
import { getT } from "../i18n";
import { api, capabilities } from "../lib/api";
import { storedTracks } from "../lib/bundles";
import { server } from "../lib/server";
import type { Library, Playlist, Track } from "../lib/types";
import { toast, useUi } from "./ui";

// Tracks going into ♥ or a playlist are stored ones: a performance row of the server goes in as its movements.

interface LibraryState extends Library {
  status: "idle" | "loading" | "ready" | "error";
  load: () => Promise<void>;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (t: Track) => Promise<void>;
  addFavorites: (tracks: Track[]) => Promise<void>;
  recordPlay: (t: Track) => void;
  createPlaylist: (name: string, tracks?: Track[]) => Promise<Playlist | null>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  /** Appends tracks; when some are already there, asks whether to leave those out. Toast with undo. */
  addToPlaylist: (id: string, tracks: Track[]) => Promise<void>;
  /** Removes the rows at `at` (one copy of a twice-added track can go alone). Toast with undo unless `quiet`. */
  removeRows: (id: string, at: number[], quiet?: boolean) => Promise<void>;
  /** Moves the track at `from` to `to` (Musike server only). */
  reorderPlaylist: (id: string, from: number, to: number) => Promise<void>;
}

const replacePlaylist = (list: Playlist[], p: Playlist) => list.map((x) => (x.id === p.id ? p : x));
const fail = (e: unknown) => toast((e as Error).message, "error");
const undo = (run: () => void) => ({ label: getT().basics.undo, run });

export const useLibrary = create<LibraryState>((set, get) => {
  /** Puts a playlist back to `tracks` after rows were removed: adds them again, then (on the server) the old order. */
  const restore = async (id: string, tracks: Track[]) => {
    const current = get().playlists.find((p) => p.id === id);
    if (!current) return;
    const left = new Map<string, number>();
    for (const t of current.tracks) left.set(t.id, (left.get(t.id) ?? 0) + 1);
    const missing = tracks.filter((t) => {
      const n = left.get(t.id) ?? 0;
      left.set(t.id, n - 1);
      return n <= 0;
    });
    try {
      let p = await api.addToPlaylist(id, missing, true);
      if (capabilities.serverLibrary) {
        await server.reorderPlaylist(id, tracks.map((t) => t.id));
        p = { ...p, tracks };
      }
      set((s) => ({ playlists: replacePlaylist(s.playlists, p) }));
    } catch (e) {
      fail(e);
    }
  };

  return {
    favorites: [],
    playlists: [],
    history: [],
    bundles: [],
    status: "idle",

    load: async () => {
      set({ status: "loading" });
      try {
        const lib = await api.library();
        set({ ...lib, status: "ready" });
      } catch {
        set({ status: "error" });
      }
    },

    isFavorite: (id) => get().favorites.some((t) => t.id === id),

    toggleFavorite: async (track) => {
      const prev = get().favorites;
      const on = !prev.some((t) => t.id === track.id);
      // Optimistic: the heart responds instantly, then reconciles with the server.
      set({ favorites: on ? [track, ...prev] : prev.filter((t) => t.id !== track.id) });
      try {
        const { favorites } = on ? await api.addFavorite(track) : await api.removeFavorite(track.id);
        set({ favorites });
        toast(on ? getT().toasts.addedFavorite : getT().toasts.removedFavorite, "info", undo(() => void get().toggleFavorite(track)));
      } catch (e) {
        set({ favorites: prev });
        fail(e);
      }
    },

    addFavorites: async (given) => {
      const tracks = storedTracks(given);
      const prev = get().favorites;
      const fresh = tracks.filter((t, i) => !prev.some((f) => f.id === t.id) && tracks.findIndex((x) => x.id === t.id) === i);
      if (!fresh.length) return toast(getT().toasts.allAlreadyFavorites);
      set({ favorites: [...fresh, ...prev] });
      try {
        const { favorites } = await api.addFavorites(fresh);
        set({ favorites });
        const t = getT();
        toast(
          fresh.length === 1 ? t.toasts.addedFavorite : t.toasts.addedFavorites(fresh.length),
          "info",
          undo(async () => {
            try {
              for (const x of fresh) set({ favorites: (await api.removeFavorite(x.id)).favorites });
              toast(t.basics.favoritesUndone(fresh.length));
            } catch (e) {
              fail(e);
            }
          }),
        );
      } catch (e) {
        set({ favorites: prev });
        fail(e);
      }
    },

    recordPlay: (track) => {
      set((s) => ({ history: [track, ...s.history.filter((t) => t.id !== track.id)].slice(0, 60) }));
      api.pushHistory(track).catch(() => {});
    },

    createPlaylist: async (name, tracks = []) => {
      try {
        const p = await api.createPlaylist(name, storedTracks(tracks));
        set((s) => ({ playlists: [p, ...s.playlists] }));
        toast(getT().toasts.playlistCreated(p.name));
        return p;
      } catch (e) {
        fail(e);
        return null;
      }
    },

    renamePlaylist: async (id, name) => {
      try {
        const p = await api.renamePlaylist(id, name);
        set((s) => ({ playlists: replacePlaylist(s.playlists, p) }));
      } catch (e) {
        fail(e);
      }
    },

    deletePlaylist: async (id) => {
      const prev = get().playlists;
      const gone = prev.find((p) => p.id === id);
      set({ playlists: prev.filter((p) => p.id !== id) });
      try {
        await api.deletePlaylist(id);
        // Undo makes it again, under a new id, with the same name and tracks.
        toast(getT().toasts.playlistDeleted, "info", gone && undo(() => void get().createPlaylist(gone.name, gone.tracks)));
      } catch (e) {
        set({ playlists: prev });
        fail(e);
      }
    },

    addToPlaylist: async (id, given) => {
      const t = getT();
      const target = get().playlists.find((p) => p.id === id);
      const tracks = storedTracks(given);
      if (!target || !tracks.length) return;
      const have = new Set(target.tracks.map((x) => x.id));
      const dupes = tracks.filter((x) => have.has(x.id)).length;
      let duplicates = false;
      if (dupes) {
        const choice = await useUi.getState().askDuplicates(target.name, dupes, tracks.length);
        if (!choice) return;
        duplicates = choice === "all";
        if (!duplicates && dupes === tracks.length) return toast(t.toasts.allAlreadyIn(target.name));
      }
      try {
        const before = get().playlists.find((p) => p.id === id)?.tracks.length ?? 0;
        const p = await api.addToPlaylist(id, tracks, duplicates);
        set((s) => ({ playlists: replacePlaylist(s.playlists, p) }));
        const added = p.tracks.length - before;
        if (!added) return toast(t.toasts.allAlreadyIn(p.name));
        const rows = Array.from({ length: added }, (_, k) => before + k);
        toast(added === 1 ? t.toasts.addedTo(p.name) : t.toasts.addedManyTo(added, p.name), "info", undo(() => void get().removeRows(id, rows, true)));
      } catch (e) {
        fail(e);
      }
    },

    removeRows: async (id, at, quiet = false) => {
      const prev = get().playlists;
      const playlist = prev.find((p) => p.id === id);
      if (!playlist || !at.length) return;
      const drop = new Set(at);
      set({ playlists: replacePlaylist(prev, { ...playlist, tracks: playlist.tracks.filter((_, i) => !drop.has(i)) }) });
      try {
        const p = await api.removeRows(id, at, at.map((i) => playlist.tracks[i]?.id ?? ""));
        set((s) => ({ playlists: replacePlaylist(s.playlists, p) }));
        const t = getT();
        toast(t.basics.removedFrom(at.length, p.name), "info", quiet ? undefined : undo(() => void restore(id, playlist.tracks)));
      } catch (e) {
        set({ playlists: prev });
        fail(e);
      }
    },

    reorderPlaylist: async (id, from, to) => {
      const prev = get().playlists;
      const playlist = prev.find((p) => p.id === id);
      if (!playlist) return;
      const tracks = playlist.tracks.slice();
      const [moved] = tracks.splice(from, 1);
      tracks.splice(to, 0, moved);
      set({ playlists: prev.map((p) => (p.id === id ? { ...p, tracks } : p)) });
      try {
        // The answer holds the same tracks in the same order; the local ones keep the library's annotations.
        await server.reorderPlaylist(id, tracks.map((t) => t.id));
      } catch {
        set({ playlists: prev });
        toast(getT().collection.reorderFailed, "error");
      }
    },
  };
});
