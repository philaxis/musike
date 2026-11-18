import { CheckIcon, HeartIcon, ListPlusIcon, PlayIcon, PlaylistIcon, QueueIcon, TrashIcon, VideoCameraIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { useUi, type MenuTarget } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";
import { Artwork } from "./Artwork";
import { Equalizer } from "./Brand";
import { menuTrigger, NO_CALLOUT } from "./menuTrigger";
import { startTrackDrag } from "./TrackDrag";

export function Check({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md ring-1 transition-colors",
        on ? "bg-accent text-accent-ink ring-accent" : "ring-line-strong",
      )}
    >
      {on && <CheckIcon size={15} weight="bold" />}
    </span>
  );
}

type Modifiers = Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">;

interface Handle {
  selectAll: () => void;
  clear: () => boolean;
}

// The list Ctrl+A and Esc act on: the last one pressed in, else the first one shown on the page.
let active: { current: Handle } | null = null;

/** Ctrl/Cmd+A: picks every track of the list in use. False when there is no such list. */
export const selectAllInActiveList = () => (active ? (active.current.selectAll(), true) : false);
/** Esc: empties the selection of the list in use. False when nothing was picked. */
export const clearActiveSelection = () => active?.current.clear() ?? false;

export interface ListSelection {
  enabled: boolean;
  /**
   * Selection mode: on from a Ctrl/Cmd-click, a Shift-click, a Shift-drag or 「여러 곡 고르기」 until Esc or ✕ —
   * even with nothing picked. While on, a plain click picks a row instead of playing it.
   */
  mode: boolean;
  has: (id: string) => boolean;
  /** The picked tracks, in list order, each once. */
  chosen: Track[];
  /** Rows holding a picked track (a track added twice to a playlist is picked in both rows). */
  positions: number[];
  /** Flips row `i`; with `range`, picks every row from the last one flipped to `i`. */
  toggle: (i: number, range?: boolean) => void;
  /** A click on row `i`: Ctrl/Cmd flips it, Shift picks a range, in selection mode a plain click flips. True when handled. */
  click: (i: number, e: Modifiers) => boolean;
  /**
   * Shift + press on row `i` with the mouse: picks every row the pointer passes over until release (rows carry
   * `data-row={i}`). True when it started, so the caller skips its own press handling (no drag, no menu).
   */
  paint: (i: number, e: ReactPointerEvent) => boolean;
  selectAll: () => void;
  /** Unpicks everything and leaves selection mode. */
  clear: () => void;
  /** Makes this the list Ctrl+A and Esc act on. */
  activate: () => void;
  /** The menu for row `i`: the whole selection when the row is in it, else the row's own (with 「여러 곡 고르기」). */
  menuFor: (i: number, own: Extract<MenuTarget, { kind: "track" }>, playlistId?: string) => MenuTarget;
}

/** Picking several tracks of one list, shared by every track list, the song box and the album pages. */
export function useListSelection(tracks: Track[], enabled = true): ListSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [mode, setMode] = useState(false);
  const anchor = useRef<number | null>(null);
  const handle = useRef<Handle>({ selectAll: () => {}, clear: () => false });

  const seen = new Set<string>();
  const chosen: Track[] = [];
  const positions: number[] = [];
  tracks.forEach((t, i) => {
    if (!selected.has(t.id)) return;
    positions.push(i);
    if (!seen.has(t.id)) chosen.push(t);
    seen.add(t.id);
  });

  const toggle = (i: number, range = false) => {
    const from = anchor.current;
    anchor.current = i;
    setMode(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && from !== null && from !== i) {
        for (let k = Math.min(from, i); k <= Math.max(from, i); k++) if (tracks[k]) next.add(tracks[k].id);
      } else if (tracks[i] && !next.delete(tracks[i].id)) next.add(tracks[i].id);
      return next;
    });
  };

  const selectAll = () => {
    setMode(true);
    setSelected(new Set(tracks.map((t) => t.id)));
  };
  const clear = () => {
    anchor.current = null;
    setMode(false);
    setSelected(new Set());
  };
  handle.current = {
    selectAll,
    clear: () => {
      if (!mode && !chosen.length) return false;
      clear();
      return true;
    },
  };

  const paint = (start: number, e: ReactPointerEvent) => {
    if (!enabled || !e.shiftKey || e.pointerType !== "mouse" || e.button !== 0) return false;
    e.preventDefault();
    e.stopPropagation();
    const base = new Set(selected);
    const rowAt = (x: number, y: number) => {
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-row]");
      return row ? Number(row.dataset.row) : null;
    };
    const spread = (to: number) => {
      const next = new Set(base);
      for (let k = Math.min(start, to); k <= Math.max(start, to); k++) if (tracks[k]) next.add(tracks[k].id);
      setSelected(next);
    };
    anchor.current = start;
    setMode(true);
    spread(start);
    const move = (ev: PointerEvent) => {
      const to = rowAt(ev.clientX, ev.clientY);
      if (to !== null) spread(to);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return true;
  };

  useEffect(() => {
    if (!enabled) return;
    active ??= handle;
    return () => {
      if (active === handle) active = null;
    };
  }, [enabled]);

  // Rows that left the list (a removal, more results) leave the selection too.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(tracks.map((t) => t.id));
      return [...prev].every((id) => ids.has(id)) ? prev : new Set([...prev].filter((id) => ids.has(id)));
    });
  }, [tracks]);

  return {
    enabled,
    mode: enabled && mode,
    has: (id) => enabled && selected.has(id),
    chosen,
    positions,
    toggle,
    click: (i, e) => {
      if (!enabled) return false;
      if (e.ctrlKey || e.metaKey) toggle(i);
      else if (e.shiftKey) toggle(i, true);
      else if (mode) toggle(i);
      else return false;
      return true;
    },
    paint,
    selectAll,
    clear,
    activate: () => {
      if (enabled) active = handle;
    },
    menuFor: (i, own, playlistId) =>
      enabled && tracks[i] && selected.has(tracks[i].id) && chosen.length > 1
        ? { kind: "tracks", tracks: chosen, rows: playlistId ? { playlistId, at: positions } : undefined, clear }
        : { ...own, select: enabled ? () => toggle(i) : undefined },
  };
}

function Action({
  icon,
  label,
  phoneLabel,
  onClick,
  disabled,
  primary,
  danger,
  iconOnly,
}: {
  icon: ReactNode;
  label: string;
  phoneLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  /** Never shows the text (it stays as tooltip and accessible name). */
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium whitespace-nowrap transition-transform active:scale-[0.97] disabled:opacity-40 lg:px-3.5",
        primary ? "bg-accent text-accent-ink" : "bg-surface-3 hover:bg-surface-4",
        danger ? "text-danger" : !primary && "text-fg",
      )}
    >
      {icon}
      {/* Phones and narrow windows keep only "Play"; the icons are familiar enough for the rest. */}
      {primary ? (
        <Short phone={phoneLabel ?? label} wide={label} />
      ) : (
        !iconOnly && <span className="hidden @4xl:inline">{label}</span>
      )}
    </button>
  );
}

/** Phones get the short text, so the bar keeps its buttons on one line at 320 px. */
export function Short({ phone, wide }: { phone: ReactNode; wide: ReactNode }) {
  return (
    <>
      <span className="sm:hidden">{phone}</span>
      <span className="hidden sm:inline">{wide}</span>
    </>
  );
}

/** "3 of 150 songs", or "3 of 150" on phones. */
export function SelectedCount({ n, total }: { n: number; total: number }) {
  const t = useT();
  return <Short phone={t.selection.countShort(n, total)} wide={t.selection.count(n, total)} />;
}

/**
 * Sticky bar under the page header: select all, then play, queue, favorite or add the selection to a playlist
 * (or take it out of the playlist shown). With nothing selected, "Play all" plays every track.
 */
export function SelectionBar({
  chosen,
  all,
  allSelected,
  onToggleAll,
  onClear,
  selecting,
  rows,
  label,
  className,
}: {
  chosen: Track[];
  all: Track[];
  allSelected: boolean;
  onToggleAll: () => void;
  /** Shows ✕ to empty the selection and leave selection mode. */
  onClear?: () => void;
  /** Selection mode is on (✕ shows even before anything is picked). */
  selecting?: boolean;
  /** On a playlist page: the picked rows, for 「재생목록에서 빼기」. */
  rows?: { playlistId: string; at: number[] };
  label: ReactNode;
  className?: string;
}) {
  const player = usePlayer.getState;
  const addFavorites = useLibrary((s) => s.addFavorites);
  const openAddToPlaylist = useUi((s) => s.openAddToPlaylist);
  const toPlay = chosen.length ? chosen : all;
  const none = !chosen.length;
  const tv = isTvMode();
  const t = useT();

  return (
    <div
      data-selection-bar
      className={cn(
        "@container sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-[5] border-b border-line bg-bg/80 px-4 py-2.5 backdrop-blur-xl md:top-16 md:bg-surface-1/80 md:px-6",
        className,
      )}
    >
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={allSelected}
          disabled={!all.length}
          onClick={onToggleAll}
          className="flex h-9 min-w-0 items-center gap-2 rounded-full pr-1 pl-1.5 text-sm font-medium text-fg-2 hover:text-fg disabled:opacity-40 sm:pr-3"
        >
          <Check on={allSelected} />
          <span className="truncate">{label}</span>
        </button>
        <span className="flex-1" />
        <Action
          primary
          icon={<PlayIcon size={16} weight="fill" />}
          label={chosen.length ? t.common.play : t.common.playAll}
          phoneLabel={t.common.play}
          disabled={!toPlay.length}
          onClick={() => player().playList(toPlay, 0)}
        />
        <Action icon={<QueueIcon size={16} />} label={t.trackMenu.playNext} disabled={none} onClick={() => player().playNext(chosen)} />
        <Action icon={<ListPlusIcon size={16} />} label={t.trackMenu.addToQueue} disabled={none} onClick={() => player().addToQueue(chosen)} />
        {/* The queue (what is playing now) and a saved playlist are different places: keep the two adds apart. */}
        <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-line sm:block" />
        {!tv && (
          <Action icon={<PlaylistIcon size={16} />} label={t.trackMenu.addToPlaylist} disabled={none} onClick={() => openAddToPlaylist(chosen)} />
        )}
        {/* The heart says it on its own: its room goes to the two "add" labels. */}
        <Action iconOnly icon={<HeartIcon size={16} />} label={t.common.favorite} disabled={none} onClick={() => void addFavorites(chosen)} />
        {!tv && rows && (
          <Action
            danger
            icon={<TrashIcon size={16} />}
            label={t.basics.removeFromPlaylist}
            disabled={none}
            onClick={() => {
              void useLibrary.getState().removeRows(rows.playlistId, rows.at);
              onClear?.();
            }}
          />
        )}
        {onClear && (selecting || !none) && (
          <button
            type="button"
            onClick={onClear}
            aria-label={t.basics.clearSelection}
            title={`${t.basics.clearSelection} (Esc)`}
            className="grid size-9 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
          >
            <XIcon size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A track row with a checkbox (song box, list search). The artwork plays; the title toggles the selection,
 * so picking many songs is a run of taps on the text. Ctrl/Cmd and Shift work as in every track list.
 */
export function SelectableRow({
  track,
  selected,
  onToggle,
  onPlay,
  menu,
  drag,
  position,
  note,
  below,
  dim,
  trailing,
  row,
  paint,
}: {
  track: Track;
  selected: boolean;
  /** A click on the checkbox or the title; Shift picks a range where the list supports it. */
  onToggle: (e: MouseEvent) => void;
  onPlay: () => void;
  /** Right-click and long press. */
  menu: () => MenuTarget;
  /** The tracks a mouse drag carries to a sidebar playlist (this one, or the selection). */
  drag: () => Track[];
  position?: number;
  /** Extra context after the artist, e.g. what was searched. */
  note?: ReactNode;
  /** Lines under the artist (the song box's source and tags). */
  below?: ReactNode;
  /** Faded, like a track gone from YouTube. */
  dim?: boolean;
  trailing?: ReactNode;
  /** This row's index in its list, for Shift-drag picking (`data-row`). */
  row?: number;
  /** Shift + press: picks the rows dragged over (see `ListSelection.paint`); true when it took the press. */
  paint?: (e: ReactPointerEvent) => boolean;
}) {
  const isCurrent = usePlayer((s) => selectCurrent(s)?.id === track.id);
  const isPlaying = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const isFavorite = useLibrary((s) => s.favorites.some((f) => f.id === track.id));
  const t = useT();
  const trigger = menuTrigger(menu);

  return (
    <div
      data-row={row}
      onContextMenu={trigger.onContextMenu}
      onPointerDown={(e) => {
        if (paint?.(e)) return;
        trigger.onPointerDown(e);
        startTrackDrag(e, drag);
      }}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-surface-2 md:px-3",
        NO_CALLOUT,
        selected && "bg-accent-soft hover:bg-accent-soft",
        dim && "opacity-50",
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={t.selection.select(track.title)}
        onClick={onToggle}
        className="-m-2 p-2"
      >
        <Check on={selected} />
      </button>

      {position !== undefined && (
        <span className="hidden w-6 shrink-0 text-center font-mono text-[13px] text-fg-3 tabular-nums md:block">{position}</span>
      )}

      <button type="button" onClick={onPlay} aria-label={t.common.playX(track.title)} className="group/art relative shrink-0">
        <Artwork src={track.thumb} className="size-11 rounded-[10px]" />
        <span
          className={cn(
            "absolute inset-0 grid place-items-center rounded-[10px] bg-black/45 text-white transition-opacity",
            isCurrent ? "opacity-100" : "opacity-0 group-hover/art:opacity-100 group-focus-visible/art:opacity-100",
          )}
        >
          {isCurrent ? <Equalizer live={isPlaying} /> : <PlayIcon size={18} weight="fill" />}
        </span>
      </button>

      <button type="button" onClick={onToggle} className={cn("min-w-0 flex-1 text-left", !selected && "opacity-60")}>
        <span className={cn("block truncate text-[15px] leading-tight font-medium", isCurrent && "text-accent-text")}>{track.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-fg-2">
          {track.kind === "video" && <VideoCameraIcon size={13} className="shrink-0 text-fg-3" aria-label={t.common.video} />}
          <span className="truncate">
            {track.artist || t.common.youtube}
            {note}
          </span>
        </span>
        {below}
      </button>

      {isFavorite && <HeartIcon size={15} weight="fill" className="shrink-0 text-accent-text" aria-label={t.common.inFavorites} />}

      <span className="hidden w-11 shrink-0 text-right font-mono text-[13px] text-fg-3 tabular-nums md:block">
        {track.duration ? formatTime(track.duration) : ""}
      </span>

      {trailing}
    </div>
  );
}
