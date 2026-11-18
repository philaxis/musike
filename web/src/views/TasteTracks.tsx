import { PauseIcon, PlayIcon, PlaylistIcon, ShuffleIcon, WarningCircleIcon, YoutubeLogoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Cover } from "../components/Cover";
import { IconButton, PlayDisc } from "../components/IconButton";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { TrackList, TrackListSkeleton } from "../components/TrackList";
import { useRemote } from "../hooks/useRemote";
import { getT, useT, type Messages } from "../i18n";
import { shuffled } from "../lib/format";
import { paths } from "../lib/routes";
import { server } from "../lib/server";
import { groupTitle, mixAbout, mixTitle } from "../lib/taste";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useUi } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";

type Kind = "group" | "mix" | "radio" | "album" | "performance";

interface Loaded {
  tracks: Track[];
  /** Labels are made when shown, so switching languages changes them. */
  describe: (t: Messages) => { kicker: string; title: string; sub: string };
  /** An album of my YouTube tracks: what to search YouTube Music's albums for. */
  youtubeQuery?: string;
}

async function load(kind: Kind, id: string, signal: AbortSignal): Promise<Loaded> {
  if (kind === "album") {
    const { album, tracks } = await server.workAlbum(id, signal);
    return {
      tracks,
      describe: (t) => ({ kicker: t.works.album, title: album.name, sub: album.artists.slice(0, 3).join(", ") }),
      youtubeQuery: [album.name, album.artists.length === 1 ? album.artists[0] : ""].filter(Boolean).join(" "),
    };
  }
  if (kind === "performance") {
    const { instance, tracks } = await server.performance(id, signal);
    return {
      tracks,
      describe: (t) => ({
        kicker: [t.works.performance, instance.composer].filter(Boolean).join(" · "),
        title: instance.work,
        sub: [instance.performer || t.works.unknownPerformer, instance.album].filter(Boolean).join(" · "),
      }),
    };
  }
  if (kind === "group") {
    const { group, tracks } = await server.tasteGroup(id, signal);
    return {
      tracks,
      describe: (t) => ({ kicker: `${t.taste.group} · ${group.genre}`, title: groupTitle(group, t), sub: t.taste.groupSub(tracks.length, group.artists) }),
    };
  }
  if (kind === "mix") {
    const mix = await server.mix(id, signal);
    return { tracks: mix.tracks, describe: (t) => ({ kicker: t.taste.mixes, title: mixTitle(mix, t), sub: mixAbout(mix, t) }) };
  }
  const radio = await server.tasteRadio(id, signal);
  if (!radio.analyzed || !radio.tracks.length) throw new Error(getT().taste.notAnalyzed);
  return {
    tracks: radio.tracks,
    describe: (t) => ({ kicker: t.taste.radio, title: t.taste.radioOf(radio.seed?.title ?? radio.tracks[0].title), sub: t.taste.radioAbout }),
  };
}

/** A list made from the taste analysis: a sound group, an automatic playlist, a radio, an album of my tracks or a performance. */
export default function TasteTracks({ kind }: { kind: Kind }) {
  const { id = "" } = useParams();
  const location = useLocation();
  const t = useT();
  // Mixes and radios are made again each visit (listening changes them); the rest stay for the session.
  const [visit] = useState(Date.now);
  const page = useRemote(`taste-${kind}:${id}:${kind === "mix" || kind === "radio" ? visit : ""}`, (signal) => load(kind, id, signal));
  const playList = usePlayer((s) => s.playList);
  const toggle = usePlayer((s) => s.toggle);
  const queue = usePlayer((s) => s.queue);
  const status = usePlayer((s) => s.status);
  const openAddToPlaylist = useUi((s) => s.openAddToPlaylist);

  const tracks = page.status === "ok" ? page.data.tracks : [];
  const label = page.status === "ok" ? page.data.describe(t) : null;
  // The card's own title (a sound group told apart by its artist) until the page has loaded.
  const title = (location.state as { name?: string } | null)?.name ?? label?.title ?? "";
  const isThisPlaying = tracks.length > 0 && queue.length === tracks.length && queue.every((q, i) => q.id === tracks[i]?.id);
  const playing = isThisPlaying && (status === "playing" || status === "loading");
  const fallback = kind === "group" ? paths.tasteGenres : kind === "mix" ? paths.mixes : paths.library;

  return (
    <div className="pb-8">
      <PageHeader title={title} actions={<BackButton fallback={fallback} />} />

      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-20 h-72 bg-linear-to-b from-accent-soft to-transparent" />
        <div className="relative flex flex-col items-center gap-5 px-4 pt-2 pb-6 md:flex-row md:items-end md:gap-6 md:px-6 md:pt-6">
          {tracks.length ? (
            <Cover kind="playlist" tracks={tracks} iconSize={64} className="size-44 shrink-0 overflow-hidden rounded-[18px] shadow-[0_24px_60px_rgb(0_0_0/0.4)] md:size-52" />
          ) : (
            <span className="skeleton size-44 shrink-0 rounded-[18px] md:size-52" />
          )}
          <div className="flex min-w-0 flex-col items-center gap-2 text-center md:items-start md:text-left">
            {label && <span className="text-xs font-medium text-fg-2">{label.kicker}</span>}
            <h1 className="max-w-full text-[28px] leading-[1.1] font-bold tracking-tight break-words md:text-5xl">{title}</h1>
            {label && <p className="text-sm text-fg-2">{label.sub}</p>}
            {tracks.length > 0 && (
              <p className="font-mono text-[13px] text-fg-2">
                {t.common.tracks(tracks.length)} · {t.time.total(tracks.reduce((n, x) => n + x.duration, 0))}
              </p>
            )}
          </div>
        </div>
      </div>

      {tracks.length > 0 && (
        <div className="flex items-center gap-2 px-4 pb-4 md:px-6">
          <PlayDisc label={playing ? t.common.pause : t.album.play(title)} px={56} onClick={() => (isThisPlaying ? toggle() : playList(tracks, 0))}>
            {playing ? <PauseIcon size={24} weight="fill" /> : <PlayIcon size={24} weight="fill" />}
          </PlayDisc>
          <IconButton label={t.album.shuffle} size="lg" onClick={() => playList(shuffled(tracks), 0)}>
            <ShuffleIcon size={24} />
          </IconButton>
          {!isTvMode() && (
            <IconButton label={t.trackMenu.addToPlaylist} size="lg" onClick={() => openAddToPlaylist(tracks)}>
              <PlaylistIcon size={24} />
            </IconButton>
          )}
          {page.status === "ok" && page.data.youtubeQuery && (
            <Link
              to={`${paths.search}?${new URLSearchParams({ q: page.data.youtubeQuery, type: "albums", in: "youtube" })}`}
              className="ml-1 flex h-11 min-w-0 items-center gap-2 rounded-full bg-surface-3 px-4 text-sm font-medium hover:bg-surface-4"
            >
              <YoutubeLogoIcon size={18} className="shrink-0" />
              <span className="truncate">{t.works.findOnYoutube}</span>
            </Link>
          )}
        </div>
      )}

      {page.status === "loading" && <TrackListSkeleton />}
      {page.status === "error" && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.taste.openFailed}
          body={page.message}
          action={
            <button type="button" onClick={page.retry} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4">
              {t.common.retry}
            </button>
          }
        />
      )}
      {page.status === "ok" && (
        <div className="px-2 md:px-3">
          <TrackList tracks={tracks} />
        </div>
      )}
    </div>
  );
}
