import { DotsThreeIcon, MusicNotesIcon, PauseIcon, PlayIcon, PlaylistIcon, ShuffleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { Artwork } from "../components/Artwork";
import { IconButton, PlayDisc } from "../components/IconButton";
import { openMenuFromButton } from "../components/menuTrigger";
import { localAlbumMenu } from "../components/menus";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { TrackList, TrackListSkeleton } from "../components/TrackList";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { shuffled } from "../lib/format";
import { paths } from "../lib/routes";
import { server } from "../lib/server";
import type { LocalAlbum as Album, Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLocal } from "../stores/local";
import { useUi } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";

/** An album (a folder, or a single file) in one of the server's music folders, its tracks in file order. */
export default function LocalAlbum() {
  const { root = "" } = useParams();
  const [params] = useSearchParams();
  const key = params.get("key") ?? "";
  const location = useLocation();
  const t = useT();
  const generation = useLocal((s) => s.generation);
  const showHidden = useLocal((s) => s.showHidden);
  const page = useRemote<{ album: Album; tracks: Track[] }>(`local-album:${generation}:${showHidden}:${root}:${key}`, (signal) =>
    server.album(root, key, showHidden, signal),
  );
  const playList = usePlayer((s) => s.playList);
  const toggle = usePlayer((s) => s.toggle);
  const queue = usePlayer((s) => s.queue);
  const status = usePlayer((s) => s.status);
  const openAddToPlaylist = useUi((s) => s.openAddToPlaylist);

  const album = page.status === "ok" ? page.data.album : null;
  const tracks = page.status === "ok" ? page.data.tracks : [];
  const title = album?.name || (location.state as { name?: string } | null)?.name || t.local.album;
  const isThisPlaying = tracks.length > 0 && queue.length === tracks.length && queue.every((q, i) => q.id === tracks[i]?.id);
  const playing = isThisPlaying && (status === "playing" || status === "loading");

  return (
    <div className="pb-8">
      <PageHeader title={title} actions={<BackButton fallback={paths.localRoot(root)} />} />

      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-20 h-72 bg-linear-to-b from-accent-soft to-transparent" />
        <div className="relative flex flex-col items-center gap-5 px-4 pt-2 pb-6 md:flex-row md:items-end md:gap-6 md:px-6 md:pt-6">
          {album ? (
            <Artwork src={album.cover} iconSize={64} className="size-44 shrink-0 rounded-[18px] shadow-[0_24px_60px_rgb(0_0_0/0.4)] md:size-52" />
          ) : (
            <span className="skeleton size-44 shrink-0 rounded-[18px] md:size-52" />
          )}
          <div className="flex min-w-0 flex-col items-center gap-2 text-center md:items-start md:text-left">
            <span className="text-xs font-medium text-fg-2">{[t.local.album, album?.year].filter(Boolean).join(" · ")}</span>
            <h1 className="max-w-full text-[28px] leading-[1.1] font-bold tracking-tight break-words md:text-5xl">{title}</h1>
            <span className="font-medium">{root}</span>
            {album && (
              <p className="font-mono text-[13px] text-fg-2">
                {t.common.tracks(album.trackCount)}
                {album.duration > 0 && <> · {t.time.total(album.duration)}</>}
              </p>
            )}
          </div>
        </div>
      </div>

      {tracks.length > 0 && (
        <div className="flex items-center gap-2 px-4 pb-4 md:px-6">
          <PlayDisc
            label={playing ? t.common.pause : t.album.play(title)}
            px={56}
            onClick={() => (isThisPlaying ? toggle() : playList(tracks, 0))}
          >
            {playing ? <PauseIcon size={24} weight="fill" /> : <PlayIcon size={24} weight="fill" />}
          </PlayDisc>
          {tracks.length > 1 && (
            <IconButton label={t.album.shuffle} size="lg" onClick={() => playList(shuffled(tracks), 0)}>
              <ShuffleIcon size={24} />
            </IconButton>
          )}
          {!isTvMode() && (
            <IconButton label={t.local.addToPlaylist} size="lg" onClick={() => openAddToPlaylist(tracks)}>
              <PlaylistIcon size={24} />
            </IconButton>
          )}
          {album && (
            <IconButton label={t.basics.menuFor(title)} size="lg" onClick={(e) => openMenuFromButton(e, localAlbumMenu(album))}>
              <DotsThreeIcon size={26} weight="bold" />
            </IconButton>
          )}
        </div>
      )}

      {page.status === "loading" && <TrackListSkeleton />}

      {page.status === "error" && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.local.albumFailed}
          body={page.message}
          action={
            <button type="button" onClick={page.retry} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4">
              {t.common.retry}
            </button>
          }
        />
      )}

      {page.status === "ok" &&
        (tracks.length ? (
          <div className="px-2 md:px-3">
            <TrackList tracks={tracks} showAlbum={false} />
          </div>
        ) : (
          // An album always has a track: none listed means all of them are hidden.
          <EmptyState icon={<MusicNotesIcon size={28} />} title={t.hide.allHidden} body={t.hide.allHiddenBody} />
        ))}
    </div>
  );
}
