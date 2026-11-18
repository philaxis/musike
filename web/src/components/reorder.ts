import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Track } from "../lib/types";
import { swallowNextClick } from "./menuTrigger";
import { dropTargetAt, dropTracks, useTrackDrag } from "./TrackDrag";

/** A row being dragged: where it started, the slot it would land in, how far it moved and its height. */
interface Drag {
  from: number;
  to: number;
  dy: number;
  height: number;
}

interface Options {
  /** On touch, a row held and let go without moving: open its menu (the long press is taken by dragging). */
  onHold?: (index: number, x: number, y: number) => void;
  /** The tracks a row stands for when dropped on a sidebar playlist instead of into a new slot. */
  dropTracks?: (index: number) => Track[];
}

const LONG_PRESS_MS = 350;
/** A finger that moves this far before the long press is scrolling, not dragging. */
const TOUCH_SLOP = 8;
/** A mouse that moves this far with the button down starts a drag. */
const MOUSE_SLOP = 6;

/**
 * Drag rows of a list into a new order: with the mouse, press and move; on touch, press and hold, then move.
 * `onMove(from, to)` runs once on release, with indexes into the list as it was.
 * Released over a sidebar playlist, the row's tracks go there instead (`dropTracks`).
 */
export function useDragReorder(enabled: boolean, onMove: (from: number, to: number) => void, opts: Options = {}) {
  const list = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const start = (index: number) => (e: ReactPointerEvent) => {
    const el = list.current;
    if (!enabled || !el || e.button !== 0) return;
    const touch = e.pointerType !== "mouse";
    const pointer = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let current: Drag | null = null;
    let mids: number[] = [];
    let timer: number | undefined;
    let last = { x: x0, y: y0 };

    const begin = () => {
      const rects = Array.from(el.children, (c) => c.getBoundingClientRect());
      mids = rects.map((r) => r.top + r.height / 2);
      current = { from: index, to: index, dy: 0, height: rects[index]?.height ?? 0 };
      setDrag(current);
      document.body.style.userSelect = "none";
      if (touch) navigator.vibrate?.(10);
      if (opts.dropTracks) useTrackDrag.setState({ tracks: opts.dropTracks(index), ghost: false, x: x0, y: y0 });
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      last = { x: ev.clientX, y: ev.clientY };
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!current) {
        if (touch) {
          if (Math.hypot(dx, dy) > TOUCH_SLOP) cleanup();
          return;
        }
        if (Math.hypot(dx, dy) < MOUSE_SLOP) return;
        begin();
      }
      const center = mids[index]! + dy;
      const to = mids.filter((m, i) => i !== index && m < center).length;
      current = { ...current!, to, dy };
      setDrag(current);
      if (opts.dropTracks) useTrackDrag.setState({ x: ev.clientX, y: ev.clientY, over: dropTargetAt(ev.clientX, ev.clientY) });
    };

    // While dragging, the page must not scroll under the finger nor open the row's menu on a long press.
    const blockTouch = (ev: TouchEvent) => current && ev.preventDefault();
    const block = (ev: Event) => {
      if (!current) return;
      ev.preventDefault();
      ev.stopPropagation();
    };

    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      const done = current;
      const over = done && opts.dropTracks ? dropTargetAt(ev.clientX, ev.clientY) : null;
      cleanup();
      if (!done) return;
      // Releasing the mouse would also click the row, which plays it.
      swallowNextClick();
      if (over) return dropTracks(over, opts.dropTracks!(done.from));
      if (done.to !== done.from) return onMove(done.from, done.to);
      if (touch && ev.type === "pointerup" && Math.hypot(last.x - x0, last.y - y0) < TOUCH_SLOP) opts.onHold?.(index, x0, y0);
    };

    function cleanup() {
      clearTimeout(timer);
      current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.removeEventListener("touchmove", blockTouch);
      window.removeEventListener("contextmenu", block, true);
      document.body.style.userSelect = "";
      setDrag(null);
      if (opts.dropTracks) useTrackDrag.setState({ tracks: null, over: null });
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    document.addEventListener("touchmove", blockTouch, { passive: false });
    window.addEventListener("contextmenu", block, true);
    if (touch) timer = window.setTimeout(begin, LONG_PRESS_MS);
  };

  /** The dragged row follows the pointer; the rows between its old and new slot move over to make room. */
  const styleFor = (i: number): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (i === drag.from) {
      return { transform: `translateY(${drag.dy}px)`, zIndex: 20, position: "relative", boxShadow: "0 12px 32px rgb(0 0 0 / 0.35)" };
    }
    const shift =
      drag.from < drag.to && i > drag.from && i <= drag.to
        ? -drag.height
        : drag.to < drag.from && i >= drag.to && i < drag.from
          ? drag.height
          : 0;
    return { transform: shift ? `translateY(${shift}px)` : undefined, transition: "transform 160ms ease-out" };
  };

  return { list, start, styleFor };
}
