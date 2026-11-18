import { DotsThreeIcon, MagnifyingGlassIcon, PauseIcon, PlayIcon, ShuffleIcon } from "@phosphor-icons/react";
import { Link, useParams } from "react-router";
import { Cover, type CoverKind } from "../components/Cover";
import { IconButton, PlayDisc } from "../components/IconButton";
import { openMenuFromButton } from "../components/menuTrigger";
import { favoritesMenu, historyMenu, playlistMenu } from "../components/menus";
import { EmptyState, PageHeader } from "../components/Page";
import { TrackList } from "../components/TrackList";
import { useT } from "../i18n";
import { capabilities } from "../lib/api";
import { queueRows } from "../lib/bundles";
import { shuffled } from "../lib/format";
import { paths } from "../lib/routes";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { isTvMode } from "../tv/tvMode";

interface Props {
  kind: CoverKind;
}

/** Playlist, Favorites and History share one layout. */
export default function Collection({ kind }: Props) {
  const { id } = useParams();
  const lib = useLibrary();
  const playList = usePlayer((s) => s.playList);
  const toggle = usePlayer((s) => s.toggle);
  const queue = usePlayer((s) => s.queue);
  const status = usePlayer((s) => s.status);
  const t = useT();

  const playlist = kind === "playlist" ? lib.playlists.find((p) => p.id === id) : undefined;
  const tracks: Track[] = kind === "favorites" ? lib.favorites : kind === "history" ? lib.history : playlist?.tracks ?? [];
  const name = kind === "favorites" ? t.nav.favorites : kind === "history" ? t.nav.recentlyPlayed : playlist?.name ?? "";
  const label =
    kind === "playlist" ? t.collection.labelPlaylist : kind === "favorites" ? t.collection.labelFavorites : t.collection.labelHistory;

  if (kind === "playlist" && !playlist) {
    if (lib.status !== "ready") return <PageHeader />;
    return (
      <>
        <PageHeader />
        <EmptyState
          icon={<MagnifyingGlassIcon size={28} />}
          title={t.collection.notFoundTitle}
          body={t.collection.notFoundBody}
          action={
            <Link to={paths.library} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm leading-[44px] font-medium">
              {t.collection.goToLibrary}
            </Link>
          }
        />
      </>
    );
  }

  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  // The queue holds exactly these tracks (a bundle's run of parts counting as its row): this collection is playing.
  const rows = queueRows(queue).map((r) => queue[r.start].part?.bundle ?? queue[r.start].id);
  const isThisPlaying = tracks.length > 0 && rows.length === tracks.length && rows.every((id) => tracks.some((x) => x.id === id));
  const playing = isThisPlaying && (status === "playing" || status === "loading");

  return (
    <div className="pb-8">
      <PageHeader title={name} mobileOnly />

      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-20 h-72 bg-linear-to-b from-accent-soft to-transparent" />
        <div className="relative flex flex-col items-center gap-5 px-4 pt-2 pb-6 md:flex-row md:items-end md:gap-6 md:px-6 md:pt-10">
          <Cover
            kind={kind}
            tracks={tracks}
            iconSize={64}
            className="size-44 shrink-0 rounded-[18px] shadow-[0_24px_60px_rgb(0_0_0/0.4)] md:size-52"
          />
          <div className="flex min-w-0 flex-col items-center gap-2 text-center md:items-start md:text-left">
            <span className="hidden text-xs font-medium text-fg-2 md:block">{label}</span>
            <h1 className="max-w-full text-[28px] leading-[1.1] font-bold tracking-tight break-words md:text-5xl lg:text-6xl">{name}</h1>
            <p className="font-mono text-[13px] text-fg-2">
              {t.common.tracks(tracks.length)}
              {total > 0 && <> · {t.time.total(total)}</>}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pb-4 md:px-6">
        <PlayDisc
          label={playing ? t.common.pause : t.common.playX(name)}
          px={56}
          disabled={!tracks.length}
          onClick={() => (isThisPlaying ? toggle() : playList(tracks, 0))}
        >
          {playing ? <PauseIcon size={24} weight="fill" /> : <PlayIcon size={24} weight="fill" />}
        </PlayDisc>
        <IconButton
          label={t.collection.shuffle}
          size="lg"
          disabled={!tracks.length}
          onClick={() => {
            const order = shuffled(tracks);
            playList(order, 0);
          }}
        >
          <ShuffleIcon size={24} />
        </IconButton>
        <IconButton
          label={t.basics.menuFor(name)}
          size="lg"
          onClick={(e) => openMenuFromButton(e, playlist ? playlistMenu(playlist) : kind === "favorites" ? favoritesMenu() : historyMenu())}
        >
          <DotsThreeIcon size={26} weight="bold" />
        </IconButton>
      </div>

      <div className="px-2 md:px-3">
        {tracks.length > 0 ? (
          <TrackList
            tracks={tracks}
            playlistId={playlist?.id}
            showAlbum
            // No desktop header on this page: the selection bar sticks to the very top there.
            barClassName="md:top-0"
            // TV mode only plays; elsewhere a playlist's rows drag into a new order.
            onReorder={
              playlist && capabilities.serverLibrary && !isTvMode()
                ? (from, to) => void lib.reorderPlaylist(playlist.id, from, to)
                : undefined
            }
          />
        ) : (
          <EmptyState
            icon={<MagnifyingGlassIcon size={28} />}
            title={kind === "history" ? t.collection.emptyHistory : t.collection.empty}
            body={
              kind === "favorites"
                ? t.collection.emptyFavoritesBody
                : kind === "history"
                  ? t.collection.emptyHistoryBody
                  : t.collection.emptyPlaylistBody
            }
            action={
              <Link to={paths.search} className="mt-2 h-11 rounded-full bg-accent px-6 text-sm leading-[44px] font-semibold text-accent-ink">
                {t.common.searchMusic}
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}
