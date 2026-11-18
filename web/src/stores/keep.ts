import { create } from "zustand";
import { getT } from "../i18n";
import { server, type KeepItem } from "../lib/server";
import type { Track } from "../lib/types";
import { toast } from "./ui";

/**
 * YouTube tracks kept on the server (an m4a the server plays instead of YouTube). `none` marks a track whose kept
 * file was just deleted, so a stale `kept` flag from the library doesn't show it as kept.
 */
type Status = KeepItem["status"] | "none";

interface KeepState {
  items: Record<string, { status: Status; progress?: number }>;
  load: () => Promise<void>;
  keep: (track: Track) => Promise<void>;
  remove: (track: Track) => Promise<void>;
}

const POLL_MS = 2000;
let poll: number | undefined;
/** Titles of the downloads started here, to name them when they finish. */
const titles = new Map<string, string>();

export const useKeep = create<KeepState>((set, get) => {
  const schedule = () => {
    clearTimeout(poll);
    poll = window.setTimeout(() => void get().load(), POLL_MS);
  };

  return {
    items: {},

    load: async () => {
      let list: KeepItem[];
      try {
        list = await server.keepList();
      } catch {
        return;
      }
      const before = get().items;
      const items: KeepState["items"] = {};
      for (const it of list) items[it.id] = { status: it.status, progress: it.progress };
      // Deleted here: stays marked so the library's stale `kept` flag doesn't show it as kept.
      for (const [id, it] of Object.entries(before)) if (it.status === "none" && !items[id]) items[id] = it;
      const t = getT();
      for (const [id, title] of titles) {
        const status = items[id]?.status;
        if (status === "downloading") continue;
        titles.delete(id);
        if (status === "error") toast(t.keep.failed(title), "error");
        else toast(t.keep.done(title));
      }
      set({ items });
      if (list.some((it) => it.status === "downloading")) schedule();
    },

    keep: async (track) => {
      set((s) => ({ items: { ...s.items, [track.id]: { status: "downloading" } } }));
      try {
        const r = await server.keep(track.id);
        set((s) => ({ items: { ...s.items, [track.id]: { status: r.status } } }));
        if (r.status === "done") return toast(getT().keep.done(track.title));
        titles.set(track.id, track.title);
        toast(getT().keep.started(track.title));
        schedule();
      } catch (e) {
        set((s) => ({ items: { ...s.items, [track.id]: { status: "error" } } }));
        toast((e as Error).message, "error");
      }
    },

    remove: async (track) => {
      const prev = get().items[track.id];
      set((s) => ({ items: { ...s.items, [track.id]: { status: "none" } } }));
      try {
        await server.unkeep(track.id);
        toast(getT().keep.removed);
      } catch (e) {
        set((s) => ({ items: { ...s.items, [track.id]: prev ?? { status: "done" } } }));
        toast((e as Error).message, "error");
      }
    },
  };
});

/** What the server holds for a track: its live status, else the `kept` flag the library came with. */
export function useKeepStatus(track: Track): Status {
  const live = useKeep((s) => s.items[track.id]?.status);
  return live ?? (track.kept ? "done" : "none");
}
