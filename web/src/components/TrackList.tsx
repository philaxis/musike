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
import { memo, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import { isLocal } from "../lib/server";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer } from "../player/player";
import { useAppearance } from "../stores/appearance";
import { useKeepStatus } from "../stores/keep";
import { useLibrary } from "../stores/library";
import { useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { Equalizer } from "./Brand";
import { useDragReorder } from "./reorder";

interface RowProps {
  track: Track;
  position: number;
  onPlay: () => void;
  /** A bundle row: play it from one of its parts (0-based). */
  onPlayPart: (part: number) => void;
  playlistId?: string;
  showAlbum: boolean;
  /** Set where rows can be dragged into a new order. */
  onDragStart?: (e: PointerEvent) => void;
  dragStyle?: CSSProperties;
}

const TrackRow = memo(function TrackRow({ track, position, onPlay, onPlayPart, playlistId, showAlbum, onDragStart, dragStyle }: RowProps) {
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
  const openMenu = useUi((s) => s.openMenu);
  const keepStatus = useKeepStatus(track);
  const t = useT();

  const menuAt = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fromButton = e.type === "click";
    openMenu({ track, playlistId, x: fromButton ? r.right - 256 : e.clientX, y: fromButton ? r.bottom + 6 : e.clientY });
  };

  return (
    <li
      onContextMenu={menuAt}
      onPointerDown={onDragStart}
      style={dragStyle}
      title={onDragStart ? t.collection.dragToReorder : undefined}
      className={cn(
        "group relative grid items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-150 hover:bg-surface-2 md:px-3",
        // A long press starts a drag on touch: it mustn't select the title's text instead.
        onDragStart && "select-none [-webkit-touch-callout:none]",
        dragStyle?.zIndex && "bg-surface-3",
        // A server file that is gone: still listed (and kept in playlists), skipped when playing.
        // A hidden one only shows up while "숨긴 것 보기" is on.
        (track.unavailable || track.hidden) && "opacity-45",
        showAlbum
          ? "grid-cols-[auto_1fr_auto] md:grid-cols-[28px_auto_1fr_auto_auto] lg:grid-cols-[28px_auto_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]"
          : "grid-cols-[auto_1fr_auto] md:grid-cols-[28px_auto_1fr_auto_auto]",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={t.common.playX(track.title)}
        className="absolute inset-0 rounded-xl focus-visible:outline-offset-[-2px]"
      />

      <span className="pointer-events-none hidden justify-center font-mono text-[13px] text-fg-3 tabular-nums md:flex">
        {isCurrent ? <Equalizer live={isPlaying} /> : position + 1}
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
          onClick={menuAt}
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
});

interface ListProps {
  tracks: Track[];
  /** Full list to queue when a row is played, if `tracks` is only a preview of it. */
  context?: Track[];
  playlistId?: string;
  showAlbum?: boolean;
  header?: boolean;
  /** Rows can be dragged into a new order; called once on release with indexes into `tracks`. */
  onReorder?: (from: number, to: number) => void;
}

export function TrackList({ tracks, context, playlistId, showAlbum: albumWanted = true, header = true, onReorder }: ListProps) {
  const playList = usePlayer((s) => s.playList);
  const t = useT();
  // Pages ask for the album column where it makes sense; Settings can turn it off everywhere.
  const showAlbum = useAppearance((s) => s.albumColumn) && albumWanted;
  const reorder = useDragReorder(!!onReorder, (from, to) => onReorder?.(from, to));
  return (
    <div>
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
        {tracks.map((t, i) => (
          <TrackRow
            key={`${t.id}-${i}`}
            track={t}
            position={i}
            playlistId={playlistId}
            showAlbum={showAlbum}
            onPlay={() => playList(context ?? tracks, i)}
            onPlayPart={(n) => playList(context ?? tracks, i, n)}
            onDragStart={onReorder && reorder.start(i)}
            dragStyle={reorder.styleFor(i)}
          />
        ))}
      </ul>
    </div>
  );
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
