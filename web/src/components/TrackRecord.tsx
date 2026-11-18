import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { trackTitle } from "../lib/bundles";
import { server, type TrackRecord } from "../lib/server";
import { useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { Modal } from "./Modal";

/** Track menu 「이 곡 기록」: how many times it was listened to, first and last time heard, and skips. */
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
        </div>
      )}
    </Modal>
  );
}
