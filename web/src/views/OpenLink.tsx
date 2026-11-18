import { PlayIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Artwork } from "../components/Artwork";
import { EmptyState, PageHeader } from "../components/Page";
import { useT } from "../i18n";
import { ApiError } from "../lib/api";
import { paths } from "../lib/routes";
import { server } from "../lib/server";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";

type Kind = "track" | "playlist" | "file";
type State = { status: "opening" } | { status: "started"; track: Track } | { status: "failed"; title: string; body: string };

/**
 * A direct link opened on this device: /play/<id> (a track), /open?path=<file> (a file on the server) and
 * /list/<id> (a playlist from the start). The track goes first in the queue and plays; when the browser blocks
 * playing without a tap, a big play button waits for one. Once it plays, the app moves on to its usual page.
 */
export default function OpenLink({ kind }: { kind: Kind }) {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const path = params.get("path") ?? "";
  const navigate = useNavigate();
  const t = useT();
  const libraryStatus = useLibrary((s) => s.status);
  const playlist = useLibrary((s) => (kind === "playlist" ? s.playlists.find((p) => p.id === id) : undefined));
  const status = usePlayer((s) => s.status);
  const current = usePlayer(selectCurrent);
  const [state, setState] = useState<State>({ status: "opening" });
  // Effects run twice in development, and the library loads after the first render: start only once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (kind === "playlist") {
      if (libraryStatus !== "ready" && libraryStatus !== "error") return;
      started.current = true;
      if (!playlist?.tracks.length) {
        setState({ status: "failed", title: t.openLink.notFound, body: t.openLink.playlistGone });
        return;
      }
      usePlayer.getState().playList(playlist.tracks, 0);
      setState({ status: "started", track: playlist.tracks[0]! });
      return;
    }
    started.current = true;
    const ctrl = new AbortController();
    const find = kind === "file" ? server.lookup(path, ctrl.signal) : server.track(id, ctrl.signal);
    find.then(
      (track) => {
        const { queue } = usePlayer.getState();
        usePlayer.getState().playList([track, ...queue.filter((q) => q.id !== track.id)], 0);
        setState({ status: "started", track });
      },
      (e: Error) => {
        if (e.name === "AbortError") return;
        const missing = e instanceof ApiError && e.status === 404;
        setState(
          kind === "file" && missing
            ? { status: "failed", title: t.openLink.fileNotFound, body: t.openLink.fileNotFoundBody }
            : { status: "failed", title: t.openLink.notFound, body: e.message },
        );
      },
    );
  }, [kind, id, path, libraryStatus, playlist]);

  // Playing: on to the playlist, or Home with the player showing the track.
  useEffect(() => {
    if (state.status !== "started" || status !== "playing") return;
    navigate(kind === "playlist" ? paths.playlist(id) : paths.home, { replace: true });
  }, [state.status, status]);

  if (state.status === "failed") {
    return (
      <>
        <PageHeader />
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={state.title}
          body={state.body}
          action={
            <Link to={paths.home} replace className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm leading-[44px] font-medium">
              {t.openLink.goHome}
            </Link>
          }
        />
      </>
    );
  }

  const track = state.status === "started" ? (current ?? state.track) : null;
  const blocked = state.status === "started" && (status === "paused" || status === "error");

  return (
    <div className="pb-8">
      <PageHeader />
      <div className="flex flex-col items-center gap-6 px-6 pt-10 text-center md:pt-20">
        {track ? (
          <Artwork src={track.art} fallback={track.thumb} iconSize={64} className="size-56 rounded-[20px] shadow-[0_24px_60px_rgb(0_0_0/0.4)]" />
        ) : (
          <span className="skeleton size-56 rounded-[20px]" />
        )}
        <div className="flex max-w-full flex-col gap-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{playlist?.name ?? track?.title ?? t.openLink.opening}</h1>
          {track && <p className="truncate text-fg-2">{playlist ? track.title : track.artist}</p>}
        </div>
        <button
          type="button"
          autoFocus
          disabled={!track}
          onClick={() => usePlayer.getState().toggle()}
          aria-label={t.openLink.tapToPlay}
          className="grid size-24 place-items-center rounded-full bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.45)] transition-transform active:scale-[0.95] disabled:opacity-40"
        >
          <PlayIcon size={44} weight="fill" className={status === "loading" && !blocked ? "animate-pulse" : undefined} />
        </button>
        <p className="max-w-[36ch] text-sm text-fg-2">{blocked ? t.openLink.blocked : t.openLink.tapToPlay}</p>
      </div>
    </div>
  );
}
