import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import { server } from "../lib/server";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { toast, useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { Modal } from "./Modal";

/**
 * 「다른 판 찾기」 for a track that won't play here: up to five YouTube results for its title and artist, closest in
 * length first. Picking one puts it in place of the track in the song box, playlists, favorites and the queue.
 */
export function AlternativesDialog() {
  const track = useUi((s) => s.alternativesFor);
  const close = () => useUi.getState().openAlternatives(null);
  const [found, setFound] = useState<Track[] | "error" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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

  const off = (other: Track) => (track?.duration && other.duration ? other.duration - track.duration : null);

  return (
    <Modal open={!!track} onClose={close} title={track ? t.aside.findOf(track.title) : ""}>
      <div className="-mx-1 flex max-h-[60dvh] flex-col gap-1 overflow-y-auto scroll-area">
        {found === null ? (
          <>
            <div className="skeleton mx-1 h-14 rounded-xl" />
            <div className="skeleton mx-1 h-14 rounded-xl" />
          </>
        ) : found === "error" ? (
          <p className="px-1 text-sm text-fg-2">{t.aside.failed}</p>
        ) : !found.length ? (
          <p className="px-1 text-sm text-fg-2">{t.aside.none}</p>
        ) : (
          <ul className="flex flex-col">
            {found.map((other) => {
              const d = off(other);
              return (
                <li key={other.id}>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void pick(other)}
                    aria-label={`${t.aside.replace}: ${other.title}`}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-surface-3 disabled:opacity-60"
                  >
                    <Artwork src={other.thumb} className="size-11 shrink-0 rounded-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{other.title}</span>
                      <span className="block truncate text-[13px] text-fg-2">
                        {other.artist}
                        {other.duration > 0 && ` · ${formatTime(other.duration)}`}
                        {d !== null && (
                          <span className={cn("ml-1", Math.abs(d) <= 3 ? "text-accent-text" : "text-fg-3")}>
                            ({d === 0 ? t.aside.sameLength : t.aside.lengthOff(d)})
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-surface-3 px-3 py-1.5 text-xs font-medium">
                      {busy === other.id ? "…" : t.aside.replace}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
