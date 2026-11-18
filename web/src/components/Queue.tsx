import { CaretDownIcon, QueueIcon, XIcon } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useT } from "../i18n";
import { queueRows, trackTitle } from "../lib/bundles";
import { cn, formatTime } from "../lib/format";
import { usePlayer } from "../player/player";
import type { MenuTarget } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";
import { Artwork } from "./Artwork";
import { Equalizer } from "./Brand";
import { menuTrigger, NO_CALLOUT, openMenu } from "./menuTrigger";
import { useDragReorder } from "./reorder";

/** How many already-played tracks the queue panel lists above the current one (they all stay in the queue). */
const PAST_SHOWN = 50;

/** Drag handlers, position and menu of an upcoming row. */
interface RowDrag {
  onPointerDown?: (e: PointerEvent) => void;
  style?: CSSProperties;
  menu: () => MenuTarget;
}

/** Upcoming parts of one bundle as one row, like the bundle row in a playlist; the caret shows the parts. */
function BundleRow({ start, end, drag }: { start: number; end: number; drag: RowDrag }) {
  const t = useT();
  const parts = usePlayer((s) => s.queue).slice(start, end);
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeAt = usePlayer((s) => s.removeAt);
  const [open, setOpen] = useState(false);
  const first = parts[0];
  if (!first?.part) return null;
  const title = first.part.title;

  return (
    <li onPointerDown={drag.onPointerDown} onContextMenu={menuTrigger(drag.menu).onContextMenu} style={drag.style} className={NO_CALLOUT}>
      <div className={cn("group relative flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-3", drag.style?.zIndex && "bg-surface-3")}>
        <button type="button" onClick={() => jumpTo(start)} className="absolute inset-0 rounded-xl" aria-label={t.common.playX(title)} />
        <Artwork src={first.thumb} className="pointer-events-none size-10 rounded-[8px]" />
        <div className="pointer-events-none min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{title}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-fg-2">
            <span className="shrink-0 rounded-full bg-accent-soft px-1.5 leading-[18px] font-medium text-accent-text">
              {t.songBox.bundle(parts.length)}
            </span>
            <span className="truncate">{first.artist}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? t.songBox.hideParts : t.songBox.showParts}
          className="relative z-10 grid size-8 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg"
        >
          <CaretDownIcon size={16} className={cn("transition-transform duration-200", open && "rotate-180")} />
        </button>
        <button
          type="button"
          onClick={() => removeAt(start, end - start)}
          aria-label={t.queue.removeX(title)}
          title={t.queue.remove}
          className="relative z-10 hidden size-8 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg group-hover:grid max-md:grid"
        >
          <XIcon size={16} />
        </button>
      </div>
      {open && (
        <ol className="flex flex-col pl-12" onPointerDown={(e) => e.stopPropagation()}>
          {parts.map((part, k) => (
            <li key={`${part.id}-${k}`}>
              <button
                type="button"
                onClick={() => jumpTo(start + k)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-surface-3"
              >
                <span className="min-w-0 flex-1 truncate">{trackTitle(part)}</span>
                <span className="shrink-0 font-mono text-fg-3 tabular-nums">{part.duration ? formatTime(part.duration) : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function QueueList({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const live = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeAt = usePlayer((s) => s.removeAt);
  const clearUpcoming = usePlayer((s) => s.clearUpcoming);
  const autoRadio = usePlayer((s) => s.autoRadio);
  const setAutoRadio = usePlayer((s) => s.setAutoRadio);
  const unplayable = usePlayer((s) => s.unplayable);

  const current = queue[index];
  // What comes next, row by row: the rest of a bundle is one row.
  const upcoming = queueRows(queue.slice(index + 1)).map((r) => ({ start: r.start + index + 1, end: r.end + index + 1 }));
  // What already played stays in the queue (jumping ahead doesn't drop it): the last PAST_SHOWN, oldest first.
  const pastFrom = Math.max(0, index - PAST_SHOWN);
  const currentRef = useRef<HTMLElement>(null);
  // Opening the queue lands on the current track; the played ones are a scroll up.
  useLayoutEffect(() => currentRef.current?.scrollIntoView({ block: "start" }), []);
  const menuAt = (r: { start: number; end: number }): MenuTarget => ({
    kind: "track",
    track: queue[r.start],
    queued: { at: r.start, count: r.end - r.start },
  });
  // Upcoming rows drag into a new order (TV mode only plays); a row held still on touch opens its menu.
  const reorder = useDragReorder(
    !isTvMode(),
    (from, to) => {
      const moved = upcoming[from];
      const target = upcoming[to];
      if (moved && target) usePlayer.getState().moveRange(moved.start, moved.end, to > from ? target.end : target.start);
    },
    { onHold: (i, x, y) => upcoming[i] && openMenu(menuAt(upcoming[i]), x, y) },
  );

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-[14px] bg-surface-3 text-fg-3">
          <QueueIcon size={26} />
        </span>
        <p className="font-medium">{t.queue.emptyTitle}</p>
        <p className="max-w-[28ch] text-sm text-fg-2">{t.queue.emptyBody}</p>
      </div>
    );
  }

  const row = (i: number, isCurrent: boolean, drag?: RowDrag, past = false) => {
    const track = queue[i];
    const title = trackTitle(track);
    // Won't play here (the server's mark, or found ahead of time): skipped when its turn comes.
    const blocked = track.blocked ?? unplayable[track.id];
    const menu = drag?.menu ?? ((): MenuTarget => ({ kind: "track", track }));
    return (
      <li
        key={`${track.id}-${i}`}
        onPointerDown={drag?.onPointerDown ?? menuTrigger(menu).onPointerDown}
        onContextMenu={menuTrigger(menu).onContextMenu}
        style={drag?.style}
        title={drag ? t.basics.reorderQueue : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-3",
          NO_CALLOUT,
          drag?.style?.zIndex && "bg-surface-3",
          past && !blocked && "opacity-55 hover:opacity-100",
          blocked && "opacity-45",
        )}
      >
        <button type="button" onClick={() => jumpTo(i)} className="absolute inset-0 rounded-xl" aria-label={t.common.playX(title)} />
        <Artwork src={track.thumb} className="pointer-events-none size-10 rounded-[8px]" />
        <div className="pointer-events-none min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", isCurrent ? "text-accent-text" : "text-fg")}>{title}</p>
          <p className="truncate text-xs text-fg-2">
            {blocked && (
              <span className="text-danger">
                {t.aside.cantPlay} · {t.aside.reason[blocked]} ·{" "}
              </span>
            )}
            {track.part ? `${track.part.title} · ${track.artist}` : track.artist}
          </p>
        </div>
        {isCurrent ? (
          <Equalizer live={live} className="mr-2" />
        ) : (
          <>
            <span className="pointer-events-none font-mono text-xs text-fg-3 tabular-nums group-hover:hidden">
              {track.duration ? formatTime(track.duration) : ""}
            </span>
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={t.queue.removeX(title)}
              title={t.queue.remove}
              className="relative z-10 hidden size-8 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg group-hover:grid max-md:grid"
            >
              <XIcon size={16} />
            </button>
          </>
        )}
      </li>
    );
  };

  return (
    <div className={cn("flex flex-col gap-4", compact ? "" : "pb-4")}>
      {index > 0 && (
        <section>
          <h3 className="px-2 pb-1.5 text-xs font-medium text-fg-3">
            {t.queue.played} <span className="font-mono">{index}</span>
          </h3>
          <ul>{Array.from({ length: index - pastFrom }, (_, k) => row(pastFrom + k, false, undefined, true))}</ul>
        </section>
      )}

      <section ref={currentRef} className="scroll-mt-2">
        <h3 className="px-2 pb-1.5 text-xs font-medium text-fg-3">{t.queue.nowPlaying}</h3>
        <ul>{row(index, true)}</ul>
      </section>

      <section>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <h3 className="text-xs font-medium text-fg-3">
            {t.queue.upNext} <span className="font-mono">{upcoming.length}</span>
          </h3>
          {upcoming.length > 0 && (
            <button type="button" onClick={clearUpcoming} className="text-xs font-medium text-fg-2 hover:text-fg">
              {t.queue.clear}
            </button>
          )}
        </div>
        {upcoming.length ? (
          <ul ref={reorder.list}>
            {upcoming.map((r, k) => {
              const drag: RowDrag = { onPointerDown: reorder.start(k), style: reorder.styleFor(k), menu: () => menuAt(r) };
              return queue[r.start].part ? (
                <BundleRow key={`${queue[r.start].part!.run}-${r.start}`} start={r.start} end={r.end} drag={drag} />
              ) : (
                row(r.start, false, drag)
              );
            })}
          </ul>
        ) : (
          <p className="px-2 text-sm text-fg-2">
            {t.queue.nothingQueued} {autoRadio ? t.queue.radioContinues : ""}
          </p>
        )}
      </section>

      <label className="mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface-1 px-3 py-2.5 ring-1 ring-line">
        <span>
          <span className="block text-sm font-medium">{t.queue.autoRadio}</span>
          <span className="block text-xs text-fg-2">{t.queue.autoRadioBody}</span>
        </span>
        <input
          type="checkbox"
          checked={autoRadio}
          onChange={(e) => setAutoRadio(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
            autoRadio ? "bg-accent" : "bg-surface-4",
          )}
        >
          <span
            className={cn(
              "absolute top-1 left-1 size-4 rounded-full transition-transform duration-200 ease-out-expo",
              autoRadio ? "translate-x-4 bg-accent-ink" : "bg-fg-2",
            )}
          />
        </span>
      </label>
    </div>
  );
}
