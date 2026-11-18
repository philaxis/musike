import { CaretDownIcon, MagnifyingGlassIcon, RadioIcon, SkipForwardIcon, VideoCameraSlashIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useDragControls, useIsPresent, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { useT } from "../i18n";
import { capabilities } from "../lib/api";
import { queueRows, trackTitle } from "../lib/bundles";
import { cn } from "../lib/format";
import { isLocal } from "../lib/server";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer, useStatusText } from "../player/player";
import { useUi, type PanelTab } from "../stores/ui";
import { Artwork } from "./Artwork";
import { DayLikeButton, FavoriteButton, ModeSwitch, Scrubber, Transport } from "./Controls";
import { IconButton } from "./IconButton";
import { QueueList } from "./Queue";
import { SLOT, VideoSlot } from "./Video";
import { menuTrigger, NO_CALLOUT } from "./menuTrigger";

/** Right-click or long press on what is playing: the same menu as its row. */
const currentMenu = (track: Track) => menuTrigger(() => ({ kind: "track", track }));

/** Artwork or the live video, with a soft ambient glow from the cover behind it. */
function Stage({ track, slot, className }: { track: Track; slot: number; className?: string }) {
  const t = useT();
  const showsVideo = usePlayer((s) => s.mediaKind === "video");
  const aspect = usePlayer((s) => s.videoAspect);
  // In Video mode on a song: say we're looking for its clip, or that it has none.
  const note = usePlayer((s) =>
    s.preferVideo ? (s.videoNote ?? (s.statusText === "findingClip" ? s.statusText : null)) : null,
  );
  if (showsVideo) {
    const portrait = aspect < 1;
    return (
      <div className="flex justify-center">
        <VideoSlot
          priority={slot}
          expandable
          className={cn("rounded-[16px]", portrait ? "h-[min(52dvh,560px)]" : "w-full")}
          style={{ aspectRatio: Math.min(16 / 9, Math.max(9 / 16, aspect)) }}
        />
      </div>
    );
  }
  return (
    <div className={cn("relative mx-auto aspect-square w-full", className)}>
      <img
        src={track.thumb}
        alt=""
        aria-hidden="true"
        className="absolute inset-[8%] h-[84%] w-[84%] scale-110 rounded-full object-cover opacity-50 blur-3xl"
      />
      <Artwork
        src={track.art}
        fallback={track.thumb}
        alt={t.nowPlaying.coverOf(track.title)}
        iconSize={48}
        className="relative size-full rounded-[18px] shadow-[0_24px_60px_rgb(0_0_0/0.45)]"
      />
      {note && (
        <span className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-full bg-black/65 px-3 py-2 text-center text-[13px] font-medium text-white backdrop-blur-md">
          {note === "findingClip" ? (
            <MagnifyingGlassIcon size={16} className="shrink-0" />
          ) : (
            <VideoCameraSlashIcon size={16} className="shrink-0" />
          )}{" "}
          {note === "findingClip" ? t.player.status.findingClip : t.player.noClip}
        </span>
      )}
    </div>
  );
}

function TrackHeading({ track, large = false }: { track: Track; large?: boolean }) {
  const statusText = useStatusText();
  const status = usePlayer((s) => s.status);
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <h2 className={cn("truncate font-semibold tracking-tight", large ? "text-[22px] leading-tight" : "text-lg")}>{trackTitle(track)}</h2>
        <p className={cn("truncate", large ? "text-base" : "text-sm", status === "error" ? "text-danger" : "text-fg-2")}>
          {statusText ?? [track.part?.title, track.artist, track.album].filter(Boolean).join(" · ")}
        </p>
        {track.part && (
          <button
            type="button"
            onClick={() => usePlayer.getState().skipBundle()}
            className="mt-1.5 flex h-8 items-center gap-1.5 rounded-full bg-surface-1 px-3 text-xs font-medium text-fg-2 ring-1 ring-line hover:text-fg"
          >
            <SkipForwardIcon size={14} /> {t.songBox.skipBundle}
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        <FavoriteButton track={track} size={large ? "lg" : "md"} />
        <DayLikeButton track={track} size={large ? "lg" : "md"} />
      </div>
    </div>
  );
}

/** On the server the taste analysis makes radios of local files too (player.startRadio). */
function RadioButton({ track }: { track: Track }) {
  const startRadio = usePlayer((s) => s.startRadio);
  const t = useT();
  if (isLocal(track) && !capabilities.serverLibrary) return null;
  return (
    <button
      type="button"
      onClick={() => void startRadio(track)}
      className="flex h-11 items-center justify-center gap-2 rounded-full bg-surface-1 text-sm font-medium ring-1 ring-line transition-colors hover:bg-surface-3 active:scale-[0.98]"
    >
      <RadioIcon size={18} /> {t.nowPlaying.startRadio}
    </button>
  );
}

/** The next rows of the queue (a bundle's parts are one row); pressing one plays it. `scroll`: fills its box, scrolling. */
function UpNext({ rows, scroll = false, onShowQueue }: { rows: number; scroll?: boolean; onShowQueue?: () => void }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const jumpTo = usePlayer((s) => s.jumpTo);
  const t = useT();
  const next = queueRows(queue.slice(index + 1)).slice(0, rows);
  if (!next.length) return null;
  return (
    <div className={cn("rounded-[14px] bg-surface-1 p-3 ring-1 ring-line", scroll && "flex max-h-full min-h-0 flex-col")}>
      <div className="flex items-center justify-between pb-1">
        <p className="text-xs font-medium text-fg-3">{t.nowPlaying.upNext}</p>
        {onShowQueue && (
          <button type="button" onClick={onShowQueue} className="text-xs font-medium text-fg-2 hover:text-fg">
            {t.nowPlaying.showQueue}
          </button>
        )}
      </div>
      <ul className={cn("-mx-1.5", scroll && "scroll-area min-h-0 overflow-y-auto")}>
        {next.map(({ start }) => {
          const at = index + 1 + start;
          const track = queue[at];
          const title = track.part ? track.part.title : track.title;
          return (
            <li key={`${track.id}-${at}`}>
              <button
                type="button"
                onClick={() => jumpTo(at)}
                aria-label={t.common.playX(title)}
                className="flex w-full items-center gap-3 rounded-[10px] px-1.5 py-1.5 text-left transition-colors hover:bg-surface-3"
              >
                <Artwork src={track.thumb} className="size-10 rounded-[8px]" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{title}</span>
                  <span className="block truncate text-xs text-fg-2">{track.artist}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PanelBody({ tab, slot }: { tab: PanelTab; slot: number }) {
  const track = usePlayer(selectCurrent);
  const t = useT();

  if (tab === "queue") return <QueueList />;
  if (!track) {
    return <p className="px-2 py-16 text-center text-sm text-fg-2">{t.nowPlaying.playSomething}</p>;
  }
  return (
    <div className="flex flex-col gap-5 px-1 pb-4">
      <div {...currentMenu(track)} className={cn("flex flex-col gap-5", NO_CALLOUT)}>
        <Stage track={track} slot={slot} />
        <TrackHeading track={track} />
      </div>
      <ModeSwitch />
      <RadioButton track={track} />
      <UpNext rows={1} />
    </div>
  );
}

/** How many upcoming rows the wide sheet lists before 「대기열 보기」. */
const UP_NEXT_ROWS = 50;

/**
 * Now Playing on a wide sheet: the big cover beside the details (landscape window) or above them (portrait),
 * with the upcoming tracks filling the rest of the height.
 */
function WidePlaying({ track, onShowQueue }: { track: Track; onShowQueue: () => void }) {
  return (
    <div className="mx-auto grid h-full w-full max-w-[1400px] grid-cols-2 grid-rows-[auto_minmax(0,1fr)] gap-x-10 gap-y-6 px-6 pt-1 pb-6">
      <div {...currentMenu(track)} className={cn("min-w-0 portrait:col-span-2 landscape:row-span-2 landscape:self-center", NO_CALLOUT)}>
        <Stage
          track={track}
          slot={SLOT.panel}
          className="portrait:max-w-[min(100%,44dvh)] landscape:max-w-[min(100%,calc(100dvh-260px))]"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-5 self-start">
        <div {...currentMenu(track)} className={NO_CALLOUT}>
          <TrackHeading track={track} large />
        </div>
        <ModeSwitch />
        <RadioButton track={track} />
      </div>
      <div className="min-h-0 min-w-0 portrait:row-start-2 portrait:col-start-2">
        <UpNext rows={UP_NEXT_ROWS} scroll onShowQueue={onShowQueue} />
      </div>
    </div>
  );
}

function PanelTabs({ tab, onTab }: { tab: PanelTab; onTab: (t: PanelTab) => void }) {
  const t = useT();
  return (
    <div role="tablist" className="flex gap-1">
      {(
        [
          ["playing", t.nowPlaying.tabPlaying],
          ["queue", t.nowPlaying.tabQueue],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={cn(
            "h-9 rounded-full px-4 text-sm font-medium transition-colors",
            tab === id ? "bg-surface-4 text-fg" : "text-fg-2 hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Docked right column (≥1280px). */
export function SidePanel() {
  const tab = useUi((s) => s.panelTab);
  const openPanel = useUi((s) => s.openPanel);
  const togglePanel = useUi((s) => s.togglePanel);
  const t = useT();
  return (
    <aside className="island hidden w-[360px] shrink-0 xl:flex" aria-label={t.nowPlaying.panel}>
      <div className="island-core flex w-full flex-col overflow-hidden">
        <div className="flex h-16 items-center justify-between px-3">
          <PanelTabs tab={tab} onTab={openPanel} />
          <IconButton label={t.nowPlaying.closePanel} size="sm" onClick={() => togglePanel(tab)}>
            <XIcon size={18} />
          </IconButton>
        </div>
        <div className="scroll-area flex-1 overflow-y-auto px-2">
          <PanelBody tab={tab} slot={SLOT.panel} />
        </div>
      </div>
    </aside>
  );
}

/**
 * Now Playing and the queue as a sheet that slides up from the player: over the area above the player bar
 * (768-1279px), or the whole screen with the transport on phones. Esc, ⌄ or dragging the top bar down closes it.
 */
function Sheet({ tab, onTab, onClose, phone = false }: { tab: PanelTab; onTab: (tab: PanelTab) => void; onClose: () => void; phone?: boolean }) {
  const track = usePlayer(selectCurrent);
  const reduce = useReducedMotion();
  const drag = useDragControls();
  const self = useRef<HTMLElement>(null);
  const present = useIsPresent();
  const t = useT();
  // Latest close and presence for the key listener, added once so a menu opened later handles its Esc first.
  const live = useRef({ onClose, present });
  live.current = { onClose, present };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !live.current.present || useUi.getState().theater) return;
      // A menu or dialog over the sheet closes first.
      const over = [...document.querySelectorAll("[role=dialog],[role=menu]")].some((el) => el !== self.current);
      if (!over) live.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <motion.section
      ref={self}
      role={phone ? "dialog" : undefined}
      aria-modal={phone || undefined}
      aria-label={t.nowPlaying.panel}
      data-escape-closes
      initial={reduce ? { opacity: 0 } : { y: "100%" }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { y: "100%" }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      drag="y"
      dragListener={false}
      dragControls={drag}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.9 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 120 || info.velocity.y > 700) onClose();
      }}
      className={
        phone ? "fixed inset-0 z-40 flex flex-col overflow-hidden bg-bg md:hidden" : "island pointer-events-auto absolute inset-0 flex flex-col"
      }
    >
      <div className={cn("relative flex min-h-0 flex-1 flex-col overflow-hidden", phone ? "overlay-top" : "island-core")}>
        {track && (
          <>
            <img
              src={track.thumb}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-1/2 w-full scale-125 object-cover opacity-25 blur-3xl"
            />
            <div
              className={cn(
                "pointer-events-none absolute inset-0 bg-linear-to-b from-transparent",
                phone ? "via-bg/70 to-bg" : "via-surface-2/70 to-surface-2",
              )}
            />
          </>
        )}

        <div
          onPointerDown={(e) => drag.start(e)}
          className="relative flex h-16 shrink-0 cursor-grab touch-none items-center justify-between px-3 select-none active:cursor-grabbing"
        >
          <span aria-hidden="true" className="pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-fg-3/50" />
          <IconButton label={t.common.close} onClick={onClose} className="text-fg">
            <CaretDownIcon size={24} />
          </IconButton>
          <PanelTabs tab={tab} onTab={onTab} />
          <span aria-hidden="true" className="size-10" />
        </div>

        {tab === "queue" ? (
          <div className="scroll-area relative min-h-0 flex-1 overflow-y-auto px-2 pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto max-w-2xl">
              <QueueList />
            </div>
          </div>
        ) : !track ? (
          <p className="relative px-2 py-16 text-center text-sm text-fg-2">{t.nowPlaying.playSomething}</p>
        ) : phone ? (
          <div className="relative flex flex-1 flex-col justify-evenly gap-4 px-5 pb-[calc(16px+env(safe-area-inset-bottom))]">
            <div
              className={cn("touch-none", NO_CALLOUT)}
              onContextMenu={currentMenu(track).onContextMenu}
              onPointerDown={(e) => {
                currentMenu(track).onPointerDown(e);
                drag.start(e);
              }}
            >
              <Stage track={track} slot={SLOT.sheet} className="max-w-[min(100%,46dvh)]" />
            </div>
            <div className="flex flex-col gap-4">
              <div {...currentMenu(track)} className={NO_CALLOUT}>
                <TrackHeading track={track} large />
              </div>
              <Scrubber touch />
              <Transport big />
              <ModeSwitch className="justify-center" />
            </div>
          </div>
        ) : (
          <div className="scroll-area relative min-h-0 flex-1 overflow-y-auto">
            <WidePlaying track={track} onShowQueue={() => onTab("queue")} />
          </div>
        )}
      </div>
    </motion.section>
  );
}

/** The sheet over the area above the player bar (768-1279px); wider windows dock SidePanel instead. */
export function PanelSheet() {
  const open = useUi((s) => s.sheetOpen);
  const tab = useUi((s) => s.panelTab);
  const openPanel = useUi((s) => s.openPanel);
  const close = useUi((s) => s.closePanel);
  const { pathname } = useLocation();

  // Going to another page (an album from the track menu, say) shows that page.
  useEffect(() => {
    close();
  }, [pathname, close]);

  // Clipped at the player bar, so the sheet comes up from behind it.
  return (
    <div className="pointer-events-none absolute inset-0 z-40 hidden overflow-clip md:block xl:hidden">
      <AnimatePresence>{open && <Sheet tab={tab} onTab={openPanel} onClose={close} />}</AnimatePresence>
    </div>
  );
}

/** Full-screen Now Playing for phones, opened by the mini player (its own history entry, so Back closes it). */
export function NowPlayingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const track = usePlayer(selectCurrent);
  const [tab, setTab] = useState<PanelTab>("playing");

  return createPortal(
    <AnimatePresence onExitComplete={() => setTab("playing")}>
      {open && track && <Sheet phone tab={tab} onTab={setTab} onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  );
}
