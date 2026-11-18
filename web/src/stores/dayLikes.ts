import { create } from "zustand";
import { getT } from "../i18n";
import { capabilities } from "../lib/api";
import { server, type DayLikes } from "../lib/server";
import type { Track } from "../lib/types";
import { toast } from "./ui";

/**
 * 「오늘 좋음 ☀」: the tracks liked today (the server's Seoul date), apart from the ♥ favorites. Loaded at start and
 * whenever the app comes back into view, so a new day starts empty.
 */
interface DayLikeState {
  date: string | null;
  ids: Record<string, true>;
  load: () => Promise<void>;
  toggle: (track: Track) => Promise<void>;
}

const idsOf = (d: DayLikes) => Object.fromEntries(d.tracks.map((t) => [t.id, true as const]));

export const useDayLikes = create<DayLikeState>((set, get) => ({
  date: null,
  ids: {},

  load: async () => {
    if (!capabilities.serverLibrary) return;
    try {
      const d = await server.dayLikes();
      set({ date: d.date, ids: idsOf(d) });
    } catch {
      /* offline: keep what is shown */
    }
  },

  toggle: async (track) => {
    const prev = get().ids;
    const on = !prev[track.id];
    // Optimistic, like the heart; the server's answer also says which day it went to.
    const { [track.id]: _, ...rest } = prev;
    set({ ids: on ? { ...prev, [track.id]: true } : rest });
    try {
      const d = on ? await server.likeToday(track) : await server.unlikeToday(track.id);
      set({ date: d.date, ids: idsOf(d) });
      if (on) toast(getT().stats.likedToday);
    } catch (e) {
      set({ ids: prev });
      toast((e as Error).message, "error");
    }
  },
}));

/** Starts following the day: loads now and each time the app is shown again (it may be tomorrow by then). */
export function startDayLikes() {
  if (!capabilities.serverLibrary) return;
  void useDayLikes.getState().load();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void useDayLikes.getState().load();
  });
}
