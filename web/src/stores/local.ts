import { create } from "zustand";
import { getT } from "../i18n";
import { server, type HideTarget } from "../lib/server";
import type { LocalRoot } from "../lib/types";
import { toast } from "./ui";

/**
 * The server's music folders. `generation` changes after a rescan or a hide, so album pages fetch afresh.
 * `showHidden` lists hidden items too (dimmed, to show them again); TV mode never turns it on.
 */
interface LocalState {
  roots: LocalRoot[] | null;
  status: "idle" | "loading" | "ready" | "error";
  generation: number;
  showHidden: boolean;
  /** Something is hidden: the "숨긴 것 보기" switch is worth showing. */
  anyHidden: boolean;
  load: () => Promise<void>;
  rescan: () => Promise<void>;
  setShowHidden: (show: boolean) => void;
  /** Hides tracks or a folder, with "undo" on the toast. */
  hide: (target: HideTarget) => Promise<void>;
  unhide: (target: HideTarget, quiet?: boolean) => Promise<void>;
}

export const useLocal = create<LocalState>((set, get) => {
  /** Album pages and the folder list fetch again. */
  const refresh = () => {
    set((s) => ({ generation: s.generation + 1 }));
    void get().load();
  };

  return {
    roots: null,
    status: "idle",
    generation: 0,
    showHidden: false,
    anyHidden: false,

    load: async () => {
      set((s) => ({ status: s.roots ? s.status : "loading" }));
      try {
        const show = get().showHidden;
        const [roots, hidden] = await Promise.all([server.roots(show), server.hiddenItems()]);
        // The switch flipped meanwhile: a newer load brings the right list.
        if (show !== get().showHidden) return;
        set({ roots, anyHidden: hidden.ids.length + hidden.roots.length > 0, status: "ready" });
      } catch {
        set((s) => ({ status: s.roots ? "ready" : "error" }));
      }
    },

    rescan: async () => {
      try {
        let roots = await server.rescan();
        if (get().showHidden) roots = await server.roots(true);
        set((s) => ({ roots, status: "ready", generation: s.generation + 1 }));
        toast(getT().local.rescanned);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },

    setShowHidden: (showHidden) => {
      set({ showHidden });
      refresh();
    },

    hide: async (target) => {
      try {
        await server.hide(target);
        refresh();
        const t = getT();
        toast(target.root ? t.hide.folderHidden : t.hide.hidden, "info", { label: t.hide.undo, run: () => void get().unhide(target, true) });
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },

    unhide: async (target, quiet) => {
      try {
        await server.unhide(target);
        refresh();
        if (!quiet) toast(getT().hide.unhidden);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
  };
});
