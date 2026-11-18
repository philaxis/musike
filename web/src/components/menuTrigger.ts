import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useUi, type MenuTarget } from "../stores/ui";

const LONG_PRESS_MS = 500;
/** A finger that moves this far before the long press is scrolling. */
const SLOP = 10;
/** Width of the desktop popover, so a ⋯ button's menu opens leftwards from its right edge. */
const MENU_WIDTH = 256;

// Android also fires `contextmenu` on a long press: the menu our timer opened must not open twice.
let lastLongPress = 0;

const swallowClick = (ev: Event) => {
  ev.preventDefault();
  ev.stopPropagation();
};

/** Releasing a long press would also click what is under the finger (play the row): ignore that one click. */
export function swallowNextClick() {
  window.addEventListener("click", swallowClick, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallowClick, true), 600);
}

export const openMenu = (target: MenuTarget, x: number, y: number) => useUi.getState().openMenu({ ...target, x, y });

/** The ⋯ button: the menu opens under it. */
export function openMenuFromButton(e: ReactMouseEvent, target: MenuTarget | null) {
  e.preventDefault();
  e.stopPropagation();
  if (!target) return;
  const r = e.currentTarget.getBoundingClientRect();
  openMenu(target, r.right - MENU_WIDTH, r.bottom + 6);
}

/** Right-click opens the menu at the pointer instead of the browser's own. */
export function onMenuContext(e: ReactMouseEvent, target: () => MenuTarget | null) {
  e.preventDefault();
  e.stopPropagation();
  if (Date.now() - lastLongPress < 1000) return;
  const t = target();
  if (t) openMenu(t, e.clientX, e.clientY);
}

/** Touch: holding still for half a second opens the menu (the browser's own long-press menu is cancelled above). */
export function startLongPress(e: ReactPointerEvent, target: () => MenuTarget | null) {
  if (e.pointerType === "mouse" || e.button !== 0) return;
  const pointer = e.pointerId;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const cleanup = () => {
    clearTimeout(timer);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
  };
  const move = (ev: PointerEvent) => {
    if (ev.pointerId === pointer && Math.hypot(ev.clientX - x0, ev.clientY - y0) > SLOP) cleanup();
  };
  const timer = window.setTimeout(() => {
    cleanup();
    const t = target();
    if (!t) return;
    lastLongPress = Date.now();
    navigator.vibrate?.(10);
    swallowNextClick();
    openMenu(t, x0, y0);
  }, LONG_PRESS_MS);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}

/** Right-click and long press on an element (a card, a row): spread onto it. */
export const menuTrigger = (target: () => MenuTarget | null) => ({
  onContextMenu: (e: ReactMouseEvent) => onMenuContext(e, target),
  onPointerDown: (e: ReactPointerEvent) => startLongPress(e, target),
});

/** Classes for anything with a long-press menu: no text selection nor iOS callout under the finger. */
export const NO_CALLOUT = "select-none [-webkit-touch-callout:none]";
