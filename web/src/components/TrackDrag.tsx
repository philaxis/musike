import { MusicNotesIcon } from "@phosphor-icons/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useT } from "../i18n";
import type { Track } from "../lib/types";
import { useLibrary } from "../stores/library";
import { isTvMode } from "../tv/tvMode";
import { swallowNextClick } from "./menuTrigger";

/** Tracks being dragged with the mouse towards the sidebar, and the drop target under the pointer. */
interface DragState {
  tracks: Track[] | null;
  x: number;
  y: number;
  /** `data-drop` of the target under the pointer: "favorites" or "playlist:<id>". */
  over: string | null;
  /** The chip following the pointer; a row reordered inside its list shows it only over a target. */
  ghost: boolean;
}

export const useTrackDrag = create<DragState>(() => ({ tracks: null, x: 0, y: 0, over: null, ghost: false }));

/** The drop target under a point: an element marked `data-drop` (sidebar playlists and Favorites). */
export function dropTargetAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
  return el?.dataset.drop ?? null;
}

/** Adds dropped tracks to where they were dropped (asking about duplicates, with a toast). */
export function dropTracks(target: string, tracks: Track[]) {
  const lib = useLibrary.getState();
  if (target === "favorites") void lib.addFavorites(tracks);
  else if (target.startsWith("playlist:")) void lib.addToPlaylist(target.slice("playlist:".length), tracks);
}

/** A mouse that moves this far with the button down starts a drag. */
const SLOP = 6;

/**
 * Mouse only: press on a track and move to drag it (or the picked tracks) onto a playlist or Favorites in the
 * sidebar. `tracks` is read when the drag starts. Touch keeps scrolling and long presses.
 */
export function startTrackDrag(e: ReactPointerEvent, tracks: () => Track[]) {
  if (e.pointerType !== "mouse" || e.button !== 0 || isTvMode()) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let dragging = false;

  const move = (ev: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < SLOP) return;
      const list = tracks();
      if (!list.length) return cleanup();
      dragging = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
      useTrackDrag.setState({ tracks: list, ghost: true });
    }
    useTrackDrag.setState({ x: ev.clientX, y: ev.clientY, over: dropTargetAt(ev.clientX, ev.clientY) });
  };

  const up = (ev: PointerEvent) => {
    const { tracks: list } = useTrackDrag.getState();
    const over = dragging ? dropTargetAt(ev.clientX, ev.clientY) : null;
    const was = dragging;
    cleanup();
    if (!was) return;
    // Releasing would also click the row under the pointer, which plays it.
    swallowNextClick();
    if (over && list) dropTracks(over, list);
  };

  function cleanup() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cleanup);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    useTrackDrag.setState({ tracks: null, over: null, ghost: false });
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cleanup);
}

/** The chip under the pointer while tracks are dragged: how many, and where they can go. */
export function DragGhost() {
  const { tracks, x, y, over, ghost } = useTrackDrag();
  const t = useT();
  if (!tracks || !(ghost || over)) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[70] flex max-w-72 items-center gap-2 rounded-full border border-line-strong bg-surface-3 py-1.5 pr-3.5 pl-2 text-sm font-medium shadow-[0_8px_30px_rgb(0_0_0/0.4)]"
      style={{ left: x + 14, top: y + 14 }}
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
        <MusicNotesIcon size={14} weight="bold" />
      </span>
      <span className="truncate">{tracks.length === 1 ? tracks[0].title : t.basics.tracks(tracks.length)}</span>
      {!over && <span className="shrink-0 text-xs text-fg-2">· {t.basics.dragHint}</span>}
    </div>,
    document.body,
  );
}
