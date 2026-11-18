import { ClockCounterClockwiseIcon, HeartIcon, MagnifyingGlassIcon, PauseIcon, PlayIcon, SunIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { MyAlbumTile, TILE, TileRow } from "../components/AlbumTiles";
import { Artwork } from "../components/Artwork";
import { LogoMark } from "../components/Brand";
import { menuTrigger, NO_CALLOUT } from "../components/menuTrigger";
import { favoritesMenu, historyMenu, mixMenu, playlistMenu } from "../components/menus";
import { MoreLink, PageHeader, Section } from "../components/Page";
import { TrackCard } from "../components/TasteCards";
import { TrackList, TrackListSkeleton } from "../components/TrackList";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { capabilities } from "../lib/api";
import { cn, formatTime, seoulDay } from "../lib/format";
import { paths } from "../lib/routes";
import { server } from "../lib/server";
import { mixAbout, mixTitle } from "../lib/taste";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useAppearance } from "../stores/appearance";
import { useDayLikes } from "../stores/dayLikes";
import { useLibrary } from "../stores/library";
import type { MenuTarget } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";

function Shortcut({ to, label, tracks, cover, menu }: { to: string; label: string; tracks: Track[]; cover: ReactNode; menu: () => MenuTarget }) {
  const playList = usePlayer((s) => s.playList);
  const t = useT();
  return (
    <div
      {...menuTrigger(menu)}
      className={`group relative flex h-14 items-center gap-3 overflow-hidden rounded-[12px] bg-surface-2 pr-2 transition-colors hover:bg-surface-3 md:h-16 ${NO_CALLOUT}`}
    >
      <Link to={to} className="absolute inset-0" aria-label={label} draggable={false} />
      <span className="pointer-events-none size-14 shrink-0 overflow-hidden md:size-16">{cover}</span>
      <span className="pointer-events-none min-w-0 flex-1 truncate text-[13px] font-semibold md:text-sm">{label}</span>
      {tracks.length > 0 && (
        <button
          type="button"
          onClick={() => playList(tracks, 0)}
          aria-label={t.common.playX(label)}
          className="relative z-10 hidden size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink opacity-0 shadow-[0_6px_18px_rgb(0_0_0/0.35)] transition-[opacity,transform] duration-200 ease-out-expo group-hover:opacity-100 hover:scale-105 active:scale-95 md:grid"
        >
          <PlayIcon size={18} weight="fill" />
        </button>
      )}
    </div>
  );
}

/** A track as a cover tile in a TileRow; plays from it. Right-click or long press: the track menu. */
function TrackTile({ track, note, onPlay }: { track: Track; note?: string; onPlay: () => void }) {
  return (
    <li className={TILE}>
      <button
        type="button"
        onClick={onPlay}
        {...menuTrigger(() => ({ kind: "track", track }))}
        className={`group flex w-full flex-col gap-2 text-left ${NO_CALLOUT}`}
      >
        <span className="relative block">
          <Artwork src={track.art} fallback={track.thumb} className="aspect-square w-full rounded-[14px]" />
          <span className="absolute right-2 bottom-2 grid size-11 translate-y-1 place-items-center rounded-full bg-accent text-accent-ink opacity-0 shadow-[0_8px_20px_rgb(0_0_0/0.4)] transition-[opacity,transform] duration-200 ease-out-expo group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            <PlayIcon size={20} weight="fill" />
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{track.title}</span>
          <span className="block truncate text-xs text-fg-2">{note ?? track.artist}</span>
        </span>
      </button>
    </li>
  );
}

function StartCard() {
  const navigate = useNavigate();
  const t = useT();
  return (
    <div className="mx-4 flex flex-col items-start gap-5 rounded-[20px] bg-surface-2 p-6 ring-1 ring-line md:mx-6 md:flex-row md:items-center md:p-8">
      <span className="grid size-16 shrink-0 place-items-center rounded-[18px] bg-accent text-accent-ink">
        <LogoMark className="size-10" />
      </span>
      <div className="flex-1">
        <p className="text-xl font-semibold tracking-tight">{t.home.startTitle}</p>
        <p className="mt-1 max-w-[52ch] text-sm text-fg-2">{t.home.startBody}</p>
      </div>
      <button
        type="button"
        onClick={() => navigate(paths.search)}
        className="flex h-12 items-center gap-2 rounded-full bg-accent pr-6 pl-5 font-semibold text-accent-ink transition-transform active:scale-[0.97]"
      >
        <MagnifyingGlassIcon size={20} weight="bold" /> {t.common.searchMusic}
      </button>
    </div>
  );
}

/** 「이어 듣기」: this device's current track, ▶ resumes it where it was; on a fresh device the last one played. */
function ResumeCard() {
  const t = useT();
  const current = usePlayer((s) => s.queue[s.index]);
  const position = usePlayer((s) => s.position);
  const status = usePlayer((s) => s.status);
  const history = useLibrary((s) => s.history);
  const track = current ?? history[0];
  if (!track) return null;
  const playing = !!current && (status === "playing" || status === "loading");
  const resume = () => (current ? usePlayer.getState().toggle() : usePlayer.getState().playList(history, 0, 0, true));
  const at = current && position >= 5 ? t.home.resumeAt(formatTime(position)) : null;
  return (
    <div className="px-4 md:px-6">
      <button
        type="button"
        onClick={resume}
        {...menuTrigger(() => ({ kind: "track", track }))}
        className={cn("group flex w-full max-w-xl items-center gap-3 rounded-[16px] bg-surface-2 p-2 pr-3 text-left ring-1 ring-line transition-colors hover:bg-surface-3", NO_CALLOUT)}
      >
        <Artwork src={track.thumb} className="size-14 shrink-0 rounded-[10px]" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-accent-text">{t.home.resume}</span>
          <span className="block truncate font-semibold">{track.title}</span>
          <span className="block truncate text-xs text-fg-2">{[track.artist, at].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-transform group-active:scale-95" aria-hidden="true">
          {playing ? <PauseIcon size={20} weight="fill" /> : <PlayIcon size={20} weight="fill" />}
        </span>
        <span className="sr-only">{playing ? t.common.pause : t.common.playX(track.title)}</span>
      </button>
    </div>
  );
}

/** Home with the server: what to listen to now, new every day. */
function TodayHome() {
  const t = useT();
  const { favorites, playlists, history, status } = useLibrary();
  const playList = usePlayer((s) => s.playList);
  const empty = status === "ready" && !favorites.length && !playlists.length && !history.length;
  // Kept for the day, so coming back to Home shows it at once; a new day loads a new one.
  const day = seoulDay();
  const home = useRemote(`home:${day}`, (signal) => server.home(signal));
  const mixes = useRemote(`home-mixes:${day}`, (signal) => server.mixes(signal));
  const liked = useDayLikes((s) => s.ids);
  const [sun, setSun] = useState<Track[] | null>(null);
  const likedKey = Object.keys(liked).join();
  useEffect(() => {
    const ctrl = new AbortController();
    server.dayLikesOn(day, ctrl.signal).then(
      (d) => setSun(d.tracks),
      (e: Error) => e.name !== "AbortError" && setSun([]),
    );
    return () => ctrl.abort();
  }, [likedKey, day]);
  const dateText = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(t.locale, { timeZone: "UTC", month: "short", day: "numeric" });

  if (status === "loading") return <TrackListSkeleton rows={6} />;
  if (empty) return <StartCard />;
  const yearAgo = home.status === "ok" ? home.data.yearAgo : null;
  return (
    <div className="flex flex-col gap-9">
      <ResumeCard />

      {sun && (
        <Section title={t.home.sunToday} action={<MoreLink to={paths.sun()}>{t.home.sunMore}</MoreLink>}>
          <TileRow>
            {sun.map((x, i) => (
              <TrackTile key={x.id} track={x} onPlay={() => playList(sun, i, 0, true)} />
            ))}
            {!sun.length && (
              <li className={TILE}>
                <Link to={paths.sun()} className="flex flex-col gap-2">
                  <span className="grid aspect-square w-full place-items-center rounded-[14px] border border-dashed border-line-strong text-accent-text">
                    <SunIcon size={44} weight="fill" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t.home.sunHint}</span>
                    <span className="block truncate text-xs text-fg-2">{t.home.sunHintSub}</span>
                  </span>
                </Link>
              </li>
            )}
          </TileRow>
        </Section>
      )}

      {mixes.status === "ok" && mixes.data.mixes.length > 0 && (
        <Section title={t.home.mixes} sub={t.home.daily} action={<MoreLink to={paths.mixes}>{t.home.seeAll}</MoreLink>}>
          <TileRow>
            {mixes.data.mixes.map((m) => (
              <TrackCard key={m.id} className={TILE} to={paths.mix(m.id)} title={mixTitle(m, t)} sub={mixAbout(m, t)} tracks={m.tracks} menu={() => mixMenu(m)} />
            ))}
          </TileRow>
        </Section>
      )}

      {home.status === "ok" && home.data.albums.length > 0 && (
        <Section title={t.home.albums} sub={t.home.albumsSub}>
          <TileRow>
            {home.data.albums.map((a) => (
              <MyAlbumTile key={a.key} album={a} className={TILE} />
            ))}
          </TileRow>
        </Section>
      )}

      {yearAgo && (
        <Section title={t.home.yearAgo} sub={t.home.yearAgoSub(dateText(yearAgo.from), dateText(yearAgo.to))}>
          <TileRow>
            {yearAgo.tracks.map((x, i) => (
              <TrackTile key={x.id} track={x} note={i < yearAgo.liked ? `☀ · ${x.artist}` : undefined} onPlay={() => playList(yearAgo.tracks, i, 0, true)} />
            ))}
          </TileRow>
        </Section>
      )}
    </div>
  );
}

/** Home without the server (and in TV mode): shortcuts, recently played and favorites, as the settings choose. */
function ClassicHome() {
  const { favorites, playlists, history, status } = useLibrary();
  const playList = usePlayer((s) => s.playList);
  const t = useT();
  const show = useAppearance();
  const empty = status === "ready" && !favorites.length && !playlists.length && !history.length;

  if (status === "loading") return <TrackListSkeleton rows={6} />;
  if (empty) return <StartCard />;
  return (
    <div className="flex flex-col gap-10">
      {show.homeShortcuts && (
        <div className="grid grid-cols-2 gap-2 px-4 md:px-6 lg:grid-cols-3 2xl:grid-cols-4">
          <Shortcut
            to={paths.favorites}
            label={t.nav.favorites}
            tracks={favorites}
            cover={
              <span className="grid size-full place-items-center bg-accent-soft text-accent-text">
                <HeartIcon size={24} weight="fill" />
              </span>
            }
            menu={favoritesMenu}
          />
          <Shortcut
            to={paths.history}
            label={t.nav.recentlyPlayed}
            tracks={history}
            cover={
              <span className="grid size-full place-items-center bg-surface-3 text-fg-2">
                <ClockCounterClockwiseIcon size={24} />
              </span>
            }
            menu={historyMenu}
          />
          {playlists.slice(0, 6).map((p) => (
            <Shortcut
              key={p.id}
              to={paths.playlist(p.id)}
              label={p.name}
              tracks={p.tracks}
              cover={<Artwork src={p.tracks[0]?.thumb} className="size-full" />}
              menu={() => playlistMenu(p)}
            />
          ))}
        </div>
      )}

      {show.homeRecent && history.length > 0 && (
        <Section title={t.nav.recentlyPlayed} action={<MoreLink to={paths.history}>{t.home.seeAll}</MoreLink>}>
          <TileRow>
            {history.slice(0, 16).map((x, i) => (
              <TrackTile key={x.id} track={x} onPlay={() => playList(history, i, 0, true)} />
            ))}
          </TileRow>
        </Section>
      )}

      {show.homeFavorites && favorites.length > 0 && (
        <Section title={t.home.yourFavorites} action={<MoreLink to={paths.favorites}>{t.home.seeAll}</MoreLink>}>
          <div className="px-2 md:px-3">
            <TrackList tracks={favorites.slice(0, 5)} context={favorites} header={false} showAlbum={false} selectable={false} />
          </div>
        </Section>
      )}
    </div>
  );
}

/** With the server, Home changes every day (what to listen to now); TV mode and the app without the server keep the classic Home. */
export default function Home() {
  const t = useT();
  return (
    <div className="pb-8">
      <PageHeader />
      <div className="px-4 pt-2 pb-6 md:px-6 md:pt-8">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight md:text-4xl">{t.time.greeting(new Date().getHours())}</h1>
      </div>
      {capabilities.serverLibrary && !isTvMode() ? <TodayHome /> : <ClassicHome />}
    </div>
  );
}
