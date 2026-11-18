import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { trackTitle } from "../lib/bundles";
import { cn } from "../lib/format";
import { isLocal, server, type TrackRecord, type VideoHistory } from "../lib/server";
import type { Track } from "../lib/types";
import { useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { Modal } from "./Modal";
import { eventText, eventTone, shortDate } from "./VideoChanges";

/**
 * Track menu 「이 곡 기록」: how many times it was listened to, first and last time heard, and skips; for a YouTube
 * track also what changed about it on YouTube (the server's video ledger).
 */
export function TrackRecordDialog() {
  const track = useUi((s) => s.recordFor);
  const close = () => useUi.getState().openRecord(null);
  const [record, setRecord] = useState<TrackRecord | "error" | null>(null);
  const t = useT();

  useEffect(() => {
    if (!track) return;
    setRecord(null);
    const ctrl = new AbortController();
    server.trackRecord(track.id, ctrl.signal).then(setRecord, (e: Error) => e.name !== "AbortError" && setRecord("error"));
    return () => ctrl.abort();
  }, [track]);

  // The year only when it isn't this one.
  const date = (ms: number | null) =>
    ms === null
      ? "—"
      : new Date(ms).toLocaleDateString(t.locale, {
          ...(new Date(ms).getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
          month: "long",
          day: "numeric",
        });

  return (
    <Modal open={!!track} onClose={close} title={t.stats.trackRecord}>
      {track && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Artwork src={track.thumb} className="size-12 shrink-0 rounded-[10px]" />
            <div className="min-w-0">
              <p className="truncate font-medium">{trackTitle(track)}</p>
              <p className="truncate text-sm text-fg-2">{track.artist}</p>
            </div>
          </div>
          {record === null ? (
            <div className="skeleton h-28 rounded-[14px]" />
          ) : record === "error" ? (
            <p className="text-sm text-danger">{t.stats.failed}</p>
          ) : !record.lines ? (
            <p className="rounded-[14px] bg-surface-2 px-4 py-6 text-center text-sm text-fg-2">{t.stats.neverHeard}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-2">
              {(
                [
                  [t.stats.listens, t.stats.times(record.listens)],
                  [t.stats.skips, t.stats.times(record.skips)],
                  [t.stats.firstHeard, date(record.first)],
                  [t.stats.lastHeard, date(record.last)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-[14px] bg-surface-2 px-3.5 py-3">
                  <dt className="text-xs text-fg-2">{label}</dt>
                  <dd className="pt-0.5 text-base font-semibold tracking-tight tabular-nums md:text-lg">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {track.kind !== "bundle" && !isLocal(track) && <VideoHistorySection track={track} />}
        </div>
      )}
    </Modal>
  );
}

/** What the video ledger knows of a YouTube track: YouTube's own title when it differs, and every change, newest first. */
function VideoHistorySection({ track }: { track: Track }) {
  const t = useT();
  const [history, setHistory] = useState<VideoHistory | null>(null);

  useEffect(() => {
    setHistory(null);
    const ctrl = new AbortController();
    // Not recorded or unreachable: the section stays away.
    server.videoHistory(track.id, ctrl.signal).then(setHistory, () => {});
    return () => ctrl.abort();
  }, [track.id]);

  if (!history || (!history.video && !history.events.length)) return null;
  const youtubeTitle = history.video?.title && history.video.title !== track.title ? history.video.title : null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-fg-2">{t.ledger.history}</h3>
      {youtubeTitle && <p className="text-sm break-words text-fg-2">{t.ledger.youtubeTitle(youtubeTitle)}</p>}
      {history.events.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-[14px] bg-surface-2">
          {history.events.map((e, i) => (
            <li key={`${e.at}:${e.id}:${e.kind}:${i}`} className="flex items-start gap-3 px-3.5 py-2.5">
              <span className={cn("min-w-0 flex-1 text-sm leading-snug break-words", eventTone(e))}>{eventText(e, t)}</span>
              <time dateTime={new Date(e.at).toISOString()} className="shrink-0 text-xs text-fg-3 tabular-nums">
                {shortDate(e.at, t.locale)}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">{t.ledger.noChanges}</p>
      )}
    </section>
  );
}
