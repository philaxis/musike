import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  ChartBarIcon,
  CheckSquareIcon,
  CloudArrowDownIcon,
  CloudCheckIcon,
  EyeIcon,
  EyeSlashIcon,
  HeartIcon,
  ListNumbersIcon,
  ListPlusIcon,
  MagnifyingGlassIcon,
  MinusCircleIcon,
  PlayIcon,
  PlaylistIcon,
  QueueIcon,
  RadioIcon,
  ShuffleIcon,
  SkipForwardIcon,
  StackIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
  VinylRecordIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { MD, useMediaQuery } from "../hooks/useMediaQuery";
import { useT, type Messages } from "../i18n";
import { capabilities } from "../lib/api";
import { shuffledWorks } from "../lib/bundles";
import { cn } from "../lib/format";
import { isLocal, server, type TrackWorks } from "../lib/server";
import { paths } from "../lib/routes";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useKeep } from "../stores/keep";
import { useLocal } from "../stores/local";
import { useLibrary } from "../stores/library";
import { toast, useUi, type MenuState, type MenuTarget } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";
import { Artwork } from "./Artwork";
import { performanceMenu, workAlbumMenu } from "./menus";

/** A menu entry; without `onClick` it is a status line (say, "Downloading to the server"). */
function Item({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] transition-colors md:py-2 md:text-sm",
        "hover:bg-surface-3 focus-visible:bg-surface-3 disabled:pointer-events-none",
        danger ? "text-danger" : "text-fg",
      )}
    >
      <span className={cn("shrink-0", danger ? "text-danger" : "text-fg-2")}>{icon}</span>
      {children}
    </button>
  );
}

const Divider = () => <div className="mx-3 my-1 h-px bg-line" />;

/** What the menu is about, for its heading and label. */
function heading(menu: MenuTarget, t: Messages): { title: string; sub?: string; thumb?: string } {
  if (menu.kind === "track") return { title: menu.track.title, sub: menu.track.artist, thumb: menu.track.thumb };
  if (menu.kind === "tracks") return { title: t.basics.selected(menu.tracks.length), thumb: menu.tracks[0]?.thumb };
  return { title: menu.title, sub: menu.sub, thumb: menu.thumb };
}

/** Where the analysis says a track belongs, asked when its menu opens; null until then or without a server. */
function useTrackWorks(track: Track): TrackWorks | null {
  const [works, setWorks] = useState<{ id: string; works: TrackWorks } | null>(null);
  const enabled = capabilities.serverLibrary && track.kind !== "bundle";
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    server.trackWorks(track.id, ctrl.signal).then(
      (w) => setWorks({ id: track.id, works: w }),
      () => undefined,
    );
    return () => ctrl.abort();
  }, [track.id, enabled]);
  return works?.id === track.id ? works.works : null;
}

/**
 * To the track's album and composer, and its whole performance or album (a group menu: play, queue, add to a
 * playlist). Each only when the analysis knows it; the "whole" ones only with more than this track.
 */
function WorkItems({ menu, run }: { menu: Extract<MenuState, { kind: "track" }>; run: (fn: () => void) => () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const works = useTrackWorks(menu.track);
  if (!works) return null;
  const { album, composer, instance } = works;
  if (!album && !composer && !instance) return null;
  const thumb = menu.track.thumb;
  const openGroup = (target: MenuTarget) => useUi.getState().openMenu({ ...target, x: menu.x, y: menu.y });
  const more = (label: string) => (
    <>
      <span className="min-w-0 flex-1">{label}</span>
      <CaretRightIcon size={14} className="shrink-0 text-fg-3" />
    </>
  );
  return (
    <>
      <Divider />
      {album && (
        <Item
          icon={<VinylRecordIcon size={18} />}
          onClick={run(() =>
            album.local
              ? navigate(paths.localAlbum(album.local.root, album.local.key), { state: { name: album.name } })
              : navigate(paths.workAlbum(album.key), { state: { name: album.name } }),
          )}
        >
          {t.works.goToAlbum}
        </Item>
      )}
      {composer && (
        <Item icon={<UserIcon size={18} />} onClick={run(() => navigate(paths.composer(composer)))}>
          {t.works.goToComposer}
        </Item>
      )}
      {instance && instance.count > 1 && (
        <Item icon={<ListNumbersIcon size={18} />} onClick={() => openGroup(performanceMenu(instance, thumb))}>
          {more(t.works.wholeWork)}
        </Item>
      )}
      {album && album.count > 1 && (
        <Item icon={<VinylRecordIcon size={18} />} onClick={() => openGroup(workAlbumMenu(album, thumb))}>
          {more(t.works.wholeAlbum)}
        </Item>
      )}
    </>
  );
}

/** Entries for one track. */
function TrackItems({ menu, run }: { menu: Extract<MenuState, { kind: "track" }>; run: (fn: () => void) => () => void }) {
  const t = useT();
  const track = menu.track;
  const openAddToPlaylist = useUi((s) => s.openAddToPlaylist);
  const isFavorite = useLibrary((s) => s.favorites.some((x) => x.id === track.id));
  const keepItem = useKeep((s) => s.items[track.id]);
  // Found this session not to play here (the server's mark comes on the track as `blocked`).
  const unplayable = usePlayer((s) => s.unplayable[track.id]);
  // The bundle this menu's row stands for (or a part of) is playing: offer to skip the rest of it.
  const inPlayingBundle = usePlayer((s) => {
    const part = s.queue[s.index]?.part;
    return !!part && (part.bundle === track.id || part.run === track.part?.run);
  });
  const local = isLocal(track);
  // YouTube-only actions (keep, open on YouTube) aren't for local files nor bundles.
  const youtube = !local && track.kind !== "bundle";
  // Radio: YouTube's, or on the server the taste analysis' alike tracks, which also knows local files.
  const radio = youtube || (capabilities.serverLibrary && track.kind !== "bundle");
  // TV mode only plays: no playlist editing or keeping there.
  const tv = isTvMode();
  const keepStatus = keepItem?.status ?? (track.kept ? "done" : "none");
  const progress = keepItem?.progress;
  const percent = progress === undefined ? null : Math.round(progress <= 1 ? progress * 100 : progress);
  const player = usePlayer.getState;

  return (
    <>
      {menu.select && (
        <>
          <Item icon={<CheckSquareIcon size={18} />} onClick={run(menu.select)}>
            {t.basics.select}
          </Item>
          <Divider />
        </>
      )}
      {youtube && capabilities.serverLibrary && !tv && (track.blocked || unplayable) && (
        <>
          <Item icon={<MagnifyingGlassIcon size={18} />} onClick={() => useUi.getState().openAlternatives(track)}>
            {t.aside.findOther}
          </Item>
          <Divider />
        </>
      )}
      <Item icon={<PlayIcon size={18} />} onClick={run(() => player().playTrack(track))}>
        {t.trackMenu.playNow}
      </Item>
      <Item icon={<QueueIcon size={18} />} onClick={run(() => player().playNext(track))}>
        {t.trackMenu.playNext}
      </Item>
      <Item icon={<ListPlusIcon size={18} />} onClick={run(() => player().addToQueue(track))}>
        {t.trackMenu.addToQueue}
      </Item>
      {menu.queued && (
        <Item icon={<MinusCircleIcon size={18} />} onClick={run(() => player().removeAt(menu.queued!.at, menu.queued!.count))}>
          {t.basics.removeFromQueue}
        </Item>
      )}
      {radio && (
        <Item icon={<RadioIcon size={18} />} onClick={run(() => void player().startRadio(track))}>
          {t.trackMenu.startRadio}
        </Item>
      )}
      {inPlayingBundle && (
        <Item icon={<SkipForwardIcon size={18} />} onClick={run(() => player().skipBundle())}>
          {t.songBox.skipBundle}
        </Item>
      )}
      <WorkItems menu={menu} run={run} />
      <Divider />
      <Item
        icon={<HeartIcon size={18} weight={isFavorite ? "fill" : "regular"} className={isFavorite ? "text-accent-text" : ""} />}
        onClick={run(() => void useLibrary.getState().toggleFavorite(track))}
      >
        {isFavorite ? t.common.removeFromFavorites : t.common.addToFavorites}
      </Item>
      {!tv && (
        <Item icon={<PlaylistIcon size={18} />} onClick={() => openAddToPlaylist([track])}>
          {t.trackMenu.addToPlaylist}
        </Item>
      )}
      {menu.row && !tv && (
        <Item danger icon={<TrashIcon size={18} />} onClick={run(() => void useLibrary.getState().removeRows(menu.row!.playlistId, [menu.row!.at]))}>
          {t.trackMenu.removeFromPlaylist}
        </Item>
      )}
      {local && capabilities.serverLibrary && !tv && (
        <Item
          icon={track.hidden ? <EyeIcon size={18} /> : <EyeSlashIcon size={18} />}
          onClick={run(() => void useLocal.getState()[track.hidden ? "unhide" : "hide"]({ ids: [track.id] }))}
        >
          {track.hidden ? t.hide.unhide : t.hide.hide}
        </Item>
      )}
      {capabilities.serverLibrary && (
        <>
          {/* Tags are edited on phones and laptops; TV mode only plays, but can still list other versions. */}
          {!tv && (
            <Item icon={<TagIcon size={18} />} onClick={() => useUi.getState().openTags(track)}>
              {t.songBox.tags}
            </Item>
          )}
          <Item icon={<StackIcon size={18} />} onClick={() => useUi.getState().openVersions(track)}>
            {t.songBox.versions}
          </Item>
          <Item icon={<ChartBarIcon size={18} />} onClick={() => useUi.getState().openRecord(track)}>
            {t.stats.trackRecord}
          </Item>
        </>
      )}
      {youtube && capabilities.serverLibrary && !tv && (
        <>
          <Divider />
          {keepStatus === "downloading" ? (
            <Item icon={<CloudArrowDownIcon size={18} className="animate-pulse" />}>
              {percent === null ? t.keep.downloading : t.keep.progress(percent)}
            </Item>
          ) : keepStatus === "done" ? (
            <>
              <Item icon={<CloudCheckIcon size={18} className="text-accent-text" />}>{t.keep.kept}</Item>
              <Item danger icon={<TrashIcon size={18} />} onClick={run(() => void useKeep.getState().remove(track))}>
                {t.keep.remove}
              </Item>
            </>
          ) : (
            <Item icon={<CloudArrowDownIcon size={18} />} onClick={run(() => void useKeep.getState().keep(track))}>
              {t.keep.keep}
            </Item>
          )}
        </>
      )}
      {youtube && (
        <>
          <Divider />
          <Item
            icon={<ArrowSquareOutIcon size={18} />}
            onClick={run(() => window.open(`https://www.youtube.com/watch?v=${track.id}`, "_blank", "noopener"))}
          >
            {t.trackMenu.openYoutube}
          </Item>
        </>
      )}
    </>
  );
}

/** Entries for many tracks: the ones picked in a list, or an album, playlist or folder (fetched when picked). */
function ManyItems({ menu, run }: { menu: Exclude<MenuState, { kind: "track" }>; run: (fn: () => void) => () => void }) {
  const t = useT();
  const tv = isTvMode();
  const player = usePlayer.getState;
  // The tracks, then what to do with them; a failed or empty load says so instead.
  const withTracks = (fn: (tracks: Track[]) => void) =>
    run(async () => {
      let tracks: Track[];
      try {
        tracks = menu.kind === "tracks" ? menu.tracks : await menu.load();
      } catch (e) {
        return toast(`${t.basics.loadFailed}: ${(e as Error).message}`, "error");
      }
      if (!tracks.length) return toast(t.basics.empty);
      fn(tracks);
    });

  return (
    <>
      <Item icon={<PlayIcon size={18} />} onClick={withTracks((list) => player().playList(list, 0))}>
        {menu.kind === "group" ? t.basics.playAll : t.common.play}
      </Item>
      <Item icon={<ShuffleIcon size={18} />} onClick={withTracks((list) => player().playList(shuffledWorks(list), 0))}>
        {t.basics.shuffle}
      </Item>
      <Item icon={<QueueIcon size={18} />} onClick={withTracks((list) => player().playNext(list))}>
        {t.trackMenu.playNext}
      </Item>
      <Item icon={<ListPlusIcon size={18} />} onClick={withTracks((list) => player().addToQueue(list))}>
        {t.trackMenu.addToQueue}
      </Item>
      <Divider />
      {menu.kind === "tracks" && (
        <Item icon={<HeartIcon size={18} />} onClick={withTracks((list) => void useLibrary.getState().addFavorites(list))}>
          {t.common.addToFavorites}
        </Item>
      )}
      {!tv && (
        <Item icon={<PlaylistIcon size={18} />} onClick={withTracks((list) => useUi.getState().openAddToPlaylist(list))}>
          {t.trackMenu.addToPlaylist}
        </Item>
      )}
      {menu.kind === "tracks" && menu.rows && !tv && (
        <Item
          danger
          icon={<TrashIcon size={18} />}
          onClick={run(() => {
            void useLibrary.getState().removeRows(menu.rows!.playlistId, menu.rows!.at);
            menu.clear?.();
          })}
        >
          {t.basics.removeFromPlaylist}
        </Item>
      )}
      {menu.kind === "tracks" && menu.clear && (
        <Item icon={<XIcon size={18} />} onClick={run(menu.clear)}>
          {t.basics.clearSelection}
        </Item>
      )}
      {menu.kind === "group" &&
        menu.extras?.map((x) => (
          <Item key={x.label} danger={x.danger} icon={<x.icon size={18} />} onClick={run(x.run)}>
            {x.label}
          </Item>
        ))}
    </>
  );
}

export function TrackMenu() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  const isMd = useMediaQuery(MD);
  const box = useRef<HTMLDivElement>(null);
  const t = useT();
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // Placed again when its entries change size (a track's album and composer entries arrive after it opens).
  useLayoutEffect(() => {
    const el = box.current;
    if (!menu || !isMd || !el) return;
    const place = () => {
      const { width, height } = el.getBoundingClientRect();
      setPos({
        left: Math.max(12, Math.min(menu.x, window.innerWidth - width - 12)),
        top: menu.y + height > window.innerHeight - 12 ? Math.max(12, menu.y - height) : menu.y,
      });
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(el);
    return () => watch.disconnect();
  }, [menu, isMd]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  const head = menu && heading(menu, t);
  const content = menu && head && (
    <div role="menu" aria-label={t.trackMenu.actionsFor(head.title)} data-escape-closes className="flex flex-col">
      {menu.kind === "track" ? <TrackItems menu={menu} run={run} /> : <ManyItems menu={menu} run={run} />}
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {menu && head && (
        <div className="fixed inset-0 z-50" onContextMenu={(e) => e.preventDefault()}>
          <motion.div
            className={cn("absolute inset-0", isMd ? "bg-transparent" : "bg-scrim")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          {isMd ? (
            <motion.div
              ref={box}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              style={pos}
              className="scroll-area absolute max-h-[calc(100dvh-24px)] w-64 origin-top-left overflow-y-auto rounded-2xl border border-line-strong bg-surface-2 p-1.5 shadow-[0_16px_48px_rgb(0_0_0/0.45)]"
            >
              {/* Many tracks: say which, since the menu isn't next to one row. */}
              {menu.kind !== "track" && (
                <>
                  <p className="truncate px-3 pt-1.5 pb-1 text-xs font-medium text-fg-2">{head.title}</p>
                  <Divider />
                </>
              )}
              {content}
            </motion.div>
          ) : (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              className="island safe-bottom absolute inset-x-0 bottom-0 max-h-[90dvh] rounded-b-none"
            >
              <div className="island-core scroll-area max-h-[90dvh] overflow-y-auto p-2">
                <div className="mx-auto mt-1 mb-2 h-1 w-9 rounded-full bg-surface-4" />
                <div className="flex items-center gap-3 px-3 pb-3">
                  <Artwork src={head.thumb} className="size-12 rounded-[10px]" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{head.title}</p>
                    {head.sub && <p className="truncate text-sm text-fg-2">{head.sub}</p>}
                  </div>
                </div>
                <div className="mx-3 mb-1 h-px bg-line" />
                {content}
              </div>
            </motion.div>
          )}
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
