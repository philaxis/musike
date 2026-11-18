import {
  CaretDownIcon,
  ClockIcon,
  CloudArrowDownIcon,
  CloudCheckIcon,
  DotsThreeIcon,
  HardDrivesIcon,
  HeartIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import { isLocal } from "../lib/server";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer } from "../player/player";
import { useAppearance } from "../stores/appearance";
import { useKeepStatus } from "../stores/keep";
import { useLibrary } from "../stores/library";
import type { MenuTarget } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";
import { Artwork } from "./Artwork";
import { Equalizer } from "./Brand";
import { menuTrigger, NO_CALLOUT, openMenu, openMenuFromButton, startLongPress } from "./menuTrigger";
import { useDragReorder } from "./reorder";
import { Check, SelectedCount, SelectionBar, Short, useListSelection } from "./Selection";
import { startTrackDrag } from "./TrackDrag";

interface RowProps {
  track: Track;
  position: number;
  /** A click on the row: plays it, or picks it (Ctrl/Shift, or while picking). */
  onClick: (e: MouseEvent) => void;
  /** A bundle row: play it from one of its parts (0-based). */
  onPlayPart: (part: number) => void;
  showAlbum: boolean;
  menu: () => MenuTarget;
  /**
   * "always": a checkbox on every row (while picking); "phone": on phones always, on desktop on hover (pages that
   * always offer picking keep their track numbers); "hover": on desktop hover only; "none": not selectable.
   */
  check: "always" | "phone" | "hover" | "none";
  selected: boolean;
  onCheck: (e: MouseEvent) => void;
  onPointerDown: (e: PointerEvent) => void;
  /** Set where rows can be dragged into a new order. */
  reorderable: boolean;
  dragStyle?: CSSProperties;
}

function TrackRow({
  track,
  position,
  onClick,
  onPlayPart,
  showAlbum,
  menu,
  check,
  selected,
  onCheck,
  onPointerDown,
  reorderable,
  dragStyle,
}: RowProps) {
  // Which part of this bundle row is playing (1-based), 0 when none.
  const playingPart = usePlayer((s) => {
    const part = selectCurrent(s)?.part;
    return part?.bundle === track.id ? part.n : 0;
  });
  const isCurrent = usePlayer((s) => selectCurrent(s)?.id === track.id) || playingPart > 0;
  const bundle = useLibrary((s) => (track.kind === "bundle" ? s.bundles?.find((b) => b.id === track.id) : undefined));
  const [expanded, setExpanded] = useState(false);
  const isPlaying = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const isFavorite = useLibrary((s) => s.favorites.some((t) => t.id === track.id));
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const keepStatus = useKeepStatus(track);
  const t = useT();
  // Phones show the checkbox column only while picking (or on pages that always offer it).
  const phoneCol = check === "always" || check === "phone";
  // Desktop swaps the track number for the checkbox on hover, or for good once picking.
  const deskCheck = check === "always" || (check !== "none" && selected);

  return (
    <li
      data-row={position}
      onContextMenu={menuTrigger(menu).onContextMenu}
      onPointerDown={onPointerDown}
      style={dragStyle}
      title={reorderable ? t.collection.dragToReorder : undefined}
      aria-selected={check === "none" ? undefined : selected}
      className={cn(
        "group relative grid items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-150 hover:bg-surface-2 md:px-3",
        // A long press opens the menu (or starts a drag): it mustn't select the title's text instead.
        NO_CALLOUT,
        selected && "bg-accent-soft hover:bg-accent-soft",
        dragStyle?.zIndex && "bg-surface-3",
        // A server file that is gone: still listed (and kept in playlists), skipped when playing.
        // A hidden one only shows up while "숨긴 것 보기" is on.
        (track.unavailable || track.hidden) && "opacity-45",
        phoneCol ? "grid-cols-[auto_auto_1fr_auto]" : "grid-cols-[auto_1fr_auto]",
        showAlbum
          ? "md:grid-cols-[28px_auto_1fr_auto_auto] lg:grid-cols-[28px_auto_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]"
          : "md:grid-cols-[28px_auto_1fr_auto_auto]",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={t.common.playX(track.title)}
        className="absolute inset-0 rounded-xl focus-visible:outline-offset-[-2px]"
      />

      <span className={cn("relative justify-center font-mono text-[13px] text-fg-3 tabular-nums", phoneCol ? "flex" : "hidden md:flex")}>
        {check !== "none" && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={t.selection.select(track.title)}
            onClick={(e) => {
              e.stopPropagation();
              onCheck(e);
            }}
            className={cn(
              "relative z-10 -m-2 p-2",
              phoneCol ? "grid" : "hidden",
              deskCheck ? "md:grid" : "md:hidden md:group-hover:grid md:focus-visible:grid",
            )}
          >
            <Check on={selected} />
          </button>
        )}
        {check === "none" ? (
          <span className="pointer-events-none">{isCurrent ? <Equalizer live={isPlaying} /> : position + 1}</span>
        ) : (
          <span className={cn("pointer-events-none", phoneCol && "max-md:hidden", deskCheck ? "md:hidden" : "md:group-hover:hidden")}>
            {isCurrent ? <Equalizer live={isPlaying} /> : position + 1}
          </span>
        )}
      </span>

      <div className="pointer-events-none relative">
        <Artwork src={track.thumb} className="size-11 rounded-[10px]" />
        {isCurrent && (
          <span className="absolute inset-0 grid place-items-center rounded-[10px] bg-black/45 md:hidden">
            <Equalizer live={isPlaying} />
          </span>
        )}
      </div>

      <div className="pointer-events-none min-w-0">
        <p className={cn("truncate text-[15px] leading-tight font-medium", isCurrent ? "text-accent-text" : "text-fg")}>
          {track.title}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-fg-2">
          {track.kind === "video" && <VideoCameraIcon size={13} className="shrink-0 text-fg-3" aria-label={t.common.video} />}
          {bundle && (
            <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[11px] leading-[18px] font-medium text-accent-text">
              {t.songBox.bundle(bundle.parts.length)}
            </span>
          )}
          {isLocal(track) ? (
            <HardDrivesIcon size={13} className="shrink-0 text-fg-3" aria-label={t.local.badge} />
          ) : keepStatus === "done" ? (
            <CloudCheckIcon size={13} className="shrink-0 text-accent-text" aria-label={t.keep.kept} />
          ) : (
            keepStatus === "downloading" && (
              <CloudArrowDownIcon size={13} className="shrink-0 animate-pulse text-fg-3" aria-label={t.keep.downloading} />
            )
          )}
          {track.unavailable && <span className="shrink-0 text-danger">{t.local.unavailable} ·</span>}
          {track.hidden && <span className="shrink-0">{t.hide.badge} ·</span>}
          <span className="truncate">{track.artist || t.common.youtube}</span>
        </p>
      </div>

      {showAlbum && <p className="pointer-events-none hidden truncate text-sm text-fg-2 lg:block">{track.album ?? ""}</p>}

      <div className="relative z-10 hidden items-center gap-1 md:flex">
        <button
          type="button"
          onClick={() => void toggleFavorite(track)}
          aria-label={isFavorite ? t.common.removeFromFavorites : t.common.addToFavorites}
          title={isFavorite ? t.common.removeFromFavorites : t.common.addToFavorites}
          className={cn(
            "grid size-8 place-items-center rounded-full transition-[opacity,transform] active:scale-90",
            isFavorite ? "text-accent-text" : "text-fg-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-fg",
          )}
        >
          <HeartIcon size={17} weight={isFavorite ? "fill" : "regular"} />
        </button>
        <span className="pointer-events-none w-11 text-right font-mono text-[13px] text-fg-3 tabular-nums">
          {track.duration ? formatTime(track.duration) : ""}
        </span>
      </div>

      <div className="relative z-10 flex items-center">
        {bundle && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? t.songBox.hideParts : t.songBox.showParts}
            title={expanded ? t.songBox.hideParts : t.songBox.showParts}
            className="grid size-9 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
          >
            <CaretDownIcon size={18} className={cn("transition-transform duration-200", expanded && "rotate-180")} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => openMenuFromButton(e, menu())}
          aria-label={t.trackList.moreFor(track.title)}
          title={t.trackList.more}
          className="grid size-9 place-items-center rounded-full text-fg-2 transition-[opacity,background-color] hover:bg-surface-3 hover:text-fg md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <DotsThreeIcon size={22} weight="bold" />
        </button>
      </div>

      {expanded && bundle && (
        // The parts, played from where you tap; inside the row so dragging still moves the bundle as one.
        <ol className="relative z-10 col-span-full -mt-1 mb-1 flex flex-col md:pl-10" onPointerDown={(e) => e.stopPropagation()}>
          {bundle.parts.map((part, n) => (
            <li key={`${part.id}-${n}`}>
              <button
                type="button"
                onClick={() => onPlayPart(n)}
                aria-label={t.common.playX(part.title)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-3"
              >
                <span className="w-6 shrink-0 text-center font-mono text-xs text-fg-3 tabular-nums">
                  {playingPart === n + 1 ? <Equalizer live={isPlaying} /> : n + 1}
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-sm", playingPart === n + 1 ? "text-accent-text" : "text-fg")}>
                  {part.title}
                </span>
                <span className="shrink-0 font-mono text-xs text-fg-3 tabular-nums">{part.duration ? formatTime(part.duration) : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

interface ListProps {
  tracks: Track[];
  /** Full list to queue when a row is played, if `tracks` is only a preview of it. */
  context?: Track[];
  playlistId?: string;
  showAlbum?: boolean;
  header?: boolean;
  /** Rows can be dragged into a new order; called once on release with indexes into `tracks`. */
  onReorder?: (from: number, to: number) => void;
  /** Picking several rows: Ctrl/Cmd and Shift clicks, checkboxes, the selection bar. Never in TV mode. */
  selectable?: boolean;
  /** The selection bar and checkboxes stay up with nothing picked ("모두 고르기 · 모두 재생"). */
  alwaysBar?: boolean;
  /** Where the sticky selection bar sticks on pages without a desktop header (`md:top-0`). */
  barClassName?: string;
}

export function TrackList({
  tracks,
  context,
  playlistId,
  showAlbum: albumWanted = true,
  header = true,
  onReorder,
  selectable = true,
  alwaysBar = false,
  barClassName,
}: ListProps) {
  const playList = usePlayer((s) => s.playList);
  const t = useT();
  const tv = isTvMode();
  // Pages ask for the album column where it makes sense; Settings can turn it off everywhere.
  const showAlbum = useAppearance((s) => s.albumColumn) && albumWanted;
  const sel = useListSelection(tracks, selectable && !tv);
  const picking = sel.chosen.length > 0;
  const selecting = sel.mode;
  const allSelected = picking && sel.chosen.length === new Set(tracks.map((x) => x.id)).size;
  // Dragged onto a sidebar playlist, a picked row carries the whole selection.
  const carried = (i: number) => (sel.has(tracks[i].id) && sel.chosen.length > 1 ? sel.chosen : [tracks[i]]);
  const menuFor = (i: number) =>
    sel.menuFor(i, { kind: "track", track: tracks[i], row: playlistId ? { playlistId, at: i } : undefined }, playlistId);
  const reorder = useDragReorder(!!onReorder, (from, to) => onReorder?.(from, to), {
    onHold: (i, x, y) => openMenu(menuFor(i), x, y),
    dropTracks: tv ? undefined : carried,
  });
  // The bar comes and goes with selection mode above the rows; scroll by the same amount so the row under the
  // pointer stays put (a Shift-drag keeps painting the rows it started on).
  const root = useRef<HTMLDivElement>(null);
  const rowsOffset = useRef<number | null>(null);
  useLayoutEffect(() => {
    const ul = root.current?.querySelector(":scope > ul");
    if (!root.current || !ul) return;
    const offset = ul.getBoundingClientRect().top - root.current.getBoundingClientRect().top;
    const shift = rowsOffset.current === null ? 0 : offset - rowsOffset.current;
    if (shift) scrollParent(root.current).scrollBy(0, shift);
    rowsOffset.current = offset;
  }, [selecting]);

  return (
    <div ref={root} onPointerDownCapture={sel.activate}>
      {sel.enabled && (selecting || alwaysBar) && (
        <SelectionBar
          className={cn("-mx-2 mb-1 md:-mx-3", barClassName)}
          chosen={sel.chosen}
          all={tracks}
          allSelected={allSelected}
          onToggleAll={allSelected ? sel.clear : sel.selectAll}
          onClear={sel.clear}
          selecting={selecting}
          rows={playlistId && picking ? { playlistId, at: sel.positions } : undefined}
          label={
            picking ? (
              <SelectedCount n={sel.chosen.length} total={tracks.length} />
            ) : selecting ? (
              <Short phone={t.selection.modeShort} wide={t.selection.mode} />
            ) : (
              <Short phone={t.selection.all} wide={t.selection.selectAll} />
            )
          }
        />
      )}
      {header && (
        <div
          className={cn(
            "mb-1 hidden items-center gap-3 border-b border-line px-3 pb-2 text-xs font-medium tracking-wide text-fg-3 md:grid",
            showAlbum
              ? "md:grid-cols-[28px_44px_1fr_auto_auto] lg:grid-cols-[28px_44px_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]"
              : "md:grid-cols-[28px_44px_1fr_auto_auto]",
          )}
        >
          <span className="text-center font-mono">#</span>
          <span />
          <span>{t.trackList.title}</span>
          {showAlbum && <span className="hidden lg:block">{t.trackList.album}</span>}
          <span className="flex w-[84px] justify-end pr-0.5">
            <ClockIcon size={15} aria-label={t.trackList.duration} />
          </span>
          <span className="w-9" />
        </div>
      )}
      <ul ref={reorder.list} className="flex flex-col">
        {tracks.map((track, i) => (
          <TrackRow
            key={`${track.id}-${i}`}
            track={track}
            position={i}
            showAlbum={showAlbum}
            check={!sel.enabled ? "none" : selecting ? "always" : alwaysBar ? "phone" : "hover"}
            selected={sel.has(track.id)}
            onCheck={(e) => sel.toggle(i, e.shiftKey)}
            onClick={(e) => {
              if (!sel.click(i, e)) playList(context ?? tracks, i);
            }}
            onPlayPart={(n) => playList(context ?? tracks, i, n)}
            menu={() => menuFor(i)}
            reorderable={!!onReorder}
            onPointerDown={(e) => {
              // Shift + drag paints a range and turns selection mode on; no track drag, no reorder.
              if (sel.paint(i, e)) return;
              if (onReorder) return reorder.start(i)(e);
              startLongPress(e, () => menuFor(i));
              startTrackDrag(e, () => carried(i));
            }}
            dragStyle={reorder.styleFor(i)}
          />
        ))}
      </ul>
    </div>
  );
}

function scrollParent(el: HTMLElement): Element {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement ?? document.documentElement;
}

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  const t = useT();
  return (
    <ul aria-label={t.common.loading} className="flex flex-col gap-1">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-1.5 md:px-3">
          <span className="hidden w-7 md:block" />
          <span className="skeleton size-11 rounded-[10px]" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="skeleton h-3.5 rounded-full" style={{ width: `${46 + ((i * 17) % 38)}%` }} />
            <span className="skeleton h-3 rounded-full" style={{ width: `${22 + ((i * 11) % 20)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
