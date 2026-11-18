import { useEffect } from "react";
import { useNavigate } from "react-router";
import { clearActiveSelection, selectAllInActiveList } from "../components/Selection";
import { paths } from "../lib/routes";
import { selectCurrent, usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { useUi } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** A menu, dialog or sheet is open: its own keys (Esc closes it) come first. */
const overlayOpen = () => !!document.querySelector("[data-escape-closes]");

/** Desktop keyboard shortcuts. Listed in the "?" dialog. */
export function useShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const focusSearch = () => {
      // Already searching: keep the query and select it, ready to type over.
      if (window.location.pathname !== paths.search) navigate(paths.search);
      requestAnimationFrame(() => {
        const input = document.getElementById("search-input");
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const command = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (command && !e.shiftKey && key === "f" && !isTvMode()) {
        e.preventDefault();
        return focusSearch();
      }
      // Ctrl/Cmd+A picks every track of the list in use instead of selecting the page's text.
      if (command && !e.shiftKey && key === "a" && !overlayOpen()) {
        if (selectAllInActiveList()) e.preventDefault();
        return;
      }
      if (command) return;
      if (e.key === "Escape") {
        if (!overlayOpen() && clearActiveSelection()) e.preventDefault();
        return;
      }
      if (useUi.getState().menu || useUi.getState().addToPlaylist) return;
      // On Android TV the arrow keys belong to focus navigation, not to volume/seek.
      if (isTvMode() && /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight| )$/.test(e.key)) return;
      const p = usePlayer.getState();
      const ui = useUi.getState();
      const current = selectCurrent(p);
      const handled = () => e.preventDefault();

      switch (e.key) {
        case " ": {
          // Space plays and pauses even after clicking a track (its row keeps the focus), as in other players.
          // Inside a dialog or menu, and on sliders, checkboxes and switches, Space stays theirs.
          const el = e.target instanceof Element ? e.target : null;
          if (el?.closest("[role=dialog],[role=menu],[data-escape-closes]")) return;
          if (/^(slider|checkbox|switch|tab|radio)$/.test(el?.getAttribute("role") ?? "")) return;
          handled();
          p.toggle();
          break;
        }
        case "ArrowRight":
          handled();
          if (e.shiftKey) p.next();
          else p.seek(p.position + 5);
          break;
        case "ArrowLeft":
          handled();
          if (e.shiftKey) p.prev();
          else p.seek(p.position - 5);
          break;
        case "ArrowUp":
          handled();
          p.setVolume(p.volume + 0.05);
          break;
        case "ArrowDown":
          handled();
          p.setVolume(p.volume - 0.05);
          break;
        case "m":
        case "M":
          p.toggleMute();
          break;
        case "l":
        case "L":
          if (current) void useLibrary.getState().toggleFavorite(current);
          break;
        case "s":
        case "S":
          p.toggleShuffle();
          break;
        case "r":
        case "R":
          p.cycleRepeat();
          break;
        case "v":
        case "V":
          p.setPreferVideo(!p.preferVideo);
          break;
        case "f":
        case "F":
          if (p.mediaKind === "video") ui.setTheater(!ui.theater);
          break;
        case "q":
        case "Q":
          ui.togglePanel("queue");
          break;
        case "/":
          handled();
          focusSearch();
          break;
        case "?":
          ui.setShortcutsOpen(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
