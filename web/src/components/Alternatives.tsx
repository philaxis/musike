import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useT } from "../i18n";
import { formatTime } from "../lib/format";
import { paths } from "../lib/routes";
import { server, type Alternative } from "../lib/server";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { toast, useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { Modal } from "./Modal";

/**
 * 「다른 판 찾기」 for a track that won't play here: up to five YouTube results with an alike title, closest in length
 * first, each saying why (same title, same artist, length). Picking one puts it in place of the track in the song box,
 * playlists, favorites and the queue. None: search YouTube by hand.
 */
export function AlternativesDialog() {
  const track = useUi((s) => s.alternativesFor);
  const close = () => useUi.getState().openAlternatives(null);
  const [found, setFound] = useState<Alternative[] | "error" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => {
    if (!track) return;
    setFound(null);
    const ctrl = new AbortController();
    server.alternatives(track.id, ctrl.signal).then(setFound, (e: Error) => e.name !== "AbortError" && setFound("error"));
    return () => ctrl.abort();
  }, [track]);

  const pick = async (other: Track) => {
    if (!track) return;
    setBusy(other.id);
    try {
      const r = await server.replaceTrack(track.id, other);
      usePlayer.getState().replaceTrack(track.id, r.track);
      useUi.getState().noteReplaced(track.id, r.track);
      void useLibrary.getState().load();
      toast(t.aside.replaced(r.track.title));
      close();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const searchYoutube = () => {
    if (!track) return;
    close();
    navigate(`${paths.search}?q=${encodeURIComponent(track.title)}`);
  };

  /** Why a candidate is offered, in a few words: same title, same artist, how its length compares. */
  const why = (a: Alternative) => {
    const off = track?.duration && a.track.duration ? a.track.duration - track.duration : null;
    return [
      a.sameTitle && t.aside.sameTitle,
      a.sameArtist && t.aside.sameArtist,
      off !== null && (off === 0 ? t.aside.sameLength : t.aside.lengthOff(off)),
    ].filter(Boolean) as string[];
  };

  return (
    <Modal open={!!track} onClose={close} title={track ? t.aside.findOf(track.title) : ""}>
      <div className="-mx-1 flex max-h-[60dvh] flex-col gap-1 overflow-y-auto scroll-area">
        {found === null ? (
          <>
            <div className="skeleton mx-1 h-14 rounded-xl" />
            <div className="skeleton mx-1 h-14 rounded-xl" />
          </>
        ) : found === "error" || !found.length ? (
          <div className="flex flex-col items-start gap-3 px-1">
            <p className="text-sm text-fg-2">{found === "error" ? t.aside.failed : t.aside.none}</p>
            <button
              type="button"
              onClick={searchYoutube}
              className="flex h-10 items-center gap-2 rounded-full bg-surface-3 px-4 text-sm font-medium hover:bg-surface-4"
            >
              <MagnifyingGlassIcon size={16} />
              {t.aside.searchYoutube}
            </button>
          </div>
        ) : (
          <ul className="flex flex-col">
            {found.map((a) => (
              <li key={a.track.id}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void pick(a.track)}
                  aria-label={`${t.aside.replace}: ${a.track.title}`}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-surface-3 disabled:opacity-60"
                >
                  <Artwork src={a.track.thumb} className="size-11 shrink-0 rounded-[10px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{a.track.title}</span>
                    <span className="block truncate text-[13px] text-fg-2">
                      {a.track.artist}
                      {a.track.duration > 0 && ` · ${formatTime(a.track.duration)}`}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {why(a).map((w) => (
                        <span key={w} className="rounded-full bg-accent-soft px-1.5 text-[11px] leading-[18px] text-accent-text">
                          {w}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-3 px-3 py-1.5 text-xs font-medium">
                    {busy === a.track.id ? "…" : t.aside.replace}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
