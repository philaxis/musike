import { create } from "zustand";
import { getT } from "../i18n";
import { server } from "../lib/server";
import type { LocalRoot } from "../lib/types";
import { toast } from "./ui";

/** The server's music folders. `generation` changes after a rescan, so album pages fetch afresh. */
interface LocalState {
  roots: LocalRoot[] | null;
  status: "idle" | "loading" | "ready" | "error";
  generation: number;
  load: () => Promise<void>;
  rescan: () => Promise<void>;
}

export const useLocal = create<LocalState>((set) => ({
  roots: null,
  status: "idle",
  generation: 0,

  load: async () => {
    set((s) => ({ status: s.roots ? s.status : "loading" }));
    try {
      set({ roots: await server.roots(), status: "ready" });
    } catch {
      set((s) => ({ status: s.roots ? "ready" : "error" }));
    }
  },

  rescan: async () => {
    try {
      const roots = await server.rescan();
      set((s) => ({ roots, status: "ready", generation: s.generation + 1 }));
      toast(getT().local.rescanned);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  },
}));
