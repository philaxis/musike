import type { Icon } from "@phosphor-icons/react";
import { create } from "zustand";
import { desktop } from "../lib/desktop";
import type { Track } from "../lib/types";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
  action?: ToastAction;
}

/** An extra entry of a group menu: hide an album, rename or delete a playlist. */
export interface MenuExtra {
  label: string;
  icon: Icon;
  run: () => void;
  danger?: boolean;
}

/** What a context menu (right-click, long press or ⋯) is about. */
export type MenuTarget =
  | {
      kind: "track";
      track: Track;
      /** The row on a playlist page, for 「이 재생목록에서 빼기」. */
      row?: { playlistId: string; at: number };
      /** The row's entries in the queue (a bundle is several), for 「대기열에서 빼기」. */
      queued?: { at: number; count: number };
      /** Starts picking several tracks of this list, from this row. */
      select?: () => void;
    }
  | {
      /** The tracks picked in a list. */
      kind: "tracks";
      tracks: Track[];
      rows?: { playlistId: string; at: number[] };
      /** Empties the selection (after the tracks left the playlist). */
      clear?: () => void;
    }
  | {
      /** An album, playlist or folder: its tracks are fetched when an entry is picked. */
      kind: "group";
      title: string;
      sub?: string;
      thumb?: string;
      load: () => Promise<Track[]>;
      extras?: MenuExtra[];
    };

/** Anchor point for the desktop popover. Mobile renders a bottom sheet instead. */
export type MenuState = MenuTarget & { x: number; y: number };

export type DuplicateChoice = "skip" | "all";

type Theme = "dark" | "light";
export type PanelTab = "playing" | "queue";

interface UiState {
  theme: Theme;
  panelOpen: boolean;
  drawerOpen: boolean;
  panelTab: PanelTab;
  toasts: Toast[];
  menu: MenuState | null;
  /** Tracks waiting for the "add to playlist" dialog: one from a track menu, many from a selection or album. */
  addToPlaylist: Track[] | null;
  /** Adding tracks a playlist already has: asks whether to leave those out (components/Dialogs.tsx). */
  duplicates: { name: string; dupes: number; total: number; answer: (c: DuplicateChoice | null) => void } | null;
  /** A playlist being renamed or about to be deleted from any menu. */
  playlistEdit: { kind: "rename" | "delete"; id: string } | null;
  /** The track whose tags are being edited, and the one whose other versions are shown (components/Tags.tsx). */
  tagsFor: Track | null;
  versionsFor: Track | null;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  /** Cinema view: the video maximized over everything. */
  theater: boolean;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  openPanel: (tab: PanelTab) => void;
  togglePanel: (tab: PanelTab) => void;
  /** Settings switch for the docked Now Playing panel on wide screens. */
  setPanelDocked: (open: boolean) => void;
  closePanel: () => void;
  toast: (message: string, tone?: Toast["tone"], action?: ToastAction) => void;
  dismissToast: (id: number) => void;
  openMenu: (m: MenuState) => void;
  closeMenu: () => void;
  openAddToPlaylist: (tracks: Track[] | null) => void;
  askDuplicates: (name: string, dupes: number, total: number) => Promise<DuplicateChoice | null>;
  setPlaylistEdit: (edit: UiState["playlistEdit"]) => void;
  openTags: (track: Track | null) => void;
  openVersions: (track: Track | null) => void;
  setShortcutsOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setTheater: (open: boolean) => void;
}

const readTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const readPanel = (): boolean => {
  try {
    return localStorage.getItem("musike:panel") !== "closed";
  } catch {
    return true;
  }
};

let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  theme: readTheme(),
  panelOpen: readPanel(),
  drawerOpen: false,
  panelTab: "playing",
  toasts: [],
  menu: null,
  addToPlaylist: null,
  duplicates: null,
  playlistEdit: null,
  tagsFor: null,
  versionsFor: null,
  shortcutsOpen: false,
  settingsOpen: false,
  theater: false,

  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0B0C0F" : "#E9EBEF");
    desktop?.setTheme(theme);
    try {
      localStorage.setItem("musike:theme", theme);
    } catch {
      /* private mode */
    }
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),

  openPanel: (panelTab) => {
    if (window.matchMedia("(min-width: 1280px)").matches) set({ panelOpen: true, panelTab });
    else set({ drawerOpen: true, panelTab });
  },
  togglePanel: (tab) => {
    const { panelOpen, drawerOpen, panelTab } = get();
    // ≥1280px the panel is a docked column (remembered); below it is a temporary drawer.
    if (!window.matchMedia("(min-width: 1280px)").matches) {
      return set({ drawerOpen: !(drawerOpen && panelTab === tab), panelTab: tab });
    }
    const open = !(panelOpen && panelTab === tab);
    try {
      localStorage.setItem("musike:panel", open ? "open" : "closed");
    } catch {
      /* private mode */
    }
    set({ panelOpen: open, panelTab: tab });
  },
  closePanel: () => set({ drawerOpen: false }),
  setPanelDocked: (open) => {
    try {
      localStorage.setItem("musike:panel", open ? "open" : "closed");
    } catch {
      /* private mode */
    }
    set({ panelOpen: open });
  },

  toast: (message, tone = "info", action) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone, action }] }));
    // Toasts with an action stay longer so there is time to reach the button.
    setTimeout(() => get().dismissToast(id), action ? 9000 : tone === "error" ? 5200 : 2800);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),
  openAddToPlaylist: (addToPlaylist) => set({ addToPlaylist, menu: null }),
  askDuplicates: (name, dupes, total) =>
    new Promise((resolve) => {
      // A question still open is answered "never mind" before the new one replaces it.
      get().duplicates?.answer(null);
      set({
        duplicates: {
          name,
          dupes,
          total,
          answer: (c) => {
            set({ duplicates: null });
            resolve(c);
          },
        },
      });
    }),
  setPlaylistEdit: (playlistEdit) => set({ playlistEdit, menu: null }),
  openTags: (tagsFor) => set({ tagsFor, menu: null }),
  openVersions: (versionsFor) => set({ versionsFor, menu: null }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setTheater: (theater) => set({ theater }),
}));

export const toast = (message: string, tone?: Toast["tone"], action?: ToastAction) =>
  useUi.getState().toast(message, tone, action);
