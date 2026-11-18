import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useT, type Messages } from "../i18n";
import { cn } from "../lib/format";
import { server, type VideoEvent, type VideoEvents, type VideoRef, type VideoStatus } from "../lib/server";
import { useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { EmptyState } from "./Page";
import { TrackListSkeleton } from "./TrackList";

const name = (v: VideoRef) => v.title || v.id;

/** One ledger change in plain words: 「제목이 바뀜: A → B」, 「지워짐」, 「새 번호로 바꿈: A → B」… */
export function eventText(e: VideoEvent, t: Messages): string {
  switch (e.kind) {
    case "title":
      return t.ledger.title(e.from, e.to);
    case "channel":
      return t.ledger.channel(e.from, e.to);
    case "status":
      return t.ledger.status[e.to];
    case "replaced":
      return `${t.ledger.replaced[e.by]}: ${name(e.video)} → ${name(e.other)}`;
    case "restored":
      return `${t.ledger.restored}: ${name(e.other)} → ${name(e.video)}`;
  }
}

/** Red for a video that stopped playing, the accent for one back or swapped in, plain for renames. */
export const eventTone = (e: VideoEvent) =>
  e.kind === "status" ? (e.to === "ok" ? "text-accent-text" : "text-danger") : e.kind === "replaced" || e.kind === "restored" ? "text-accent-text" : "text-fg-2";

/** A day as the app writes it, with the year only when it isn't this one. */
export function shortDate(ms: number, locale: string) {
  const d = new Date(ms);
  return d.toLocaleDateString(locale, { ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }), month: "short", day: "numeric" });
}

/**
 * Song box 「변경 기록」: what the video ledger noted about the box's videos on YouTube, newest first (renamed,
 * deleted, private, blocked, Premium-only, swapped for another video). A row opens that track's 「이 곡 기록」.
 */
export function VideoChanges() {
  const t = useT();
  const [page, setPage] = useState<VideoEvents | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    server.videoEvents(undefined, ctrl.signal).then(setPage, (e: Error) => e.name !== "AbortError" && setFailed(true));
    return () => ctrl.abort();
  }, []);

  const loadMore = async () => {
    if (!page?.next) return;
    setLoadingMore(true);
    try {
      const more = await server.videoEvents(page.next);
      setPage({ ...more, events: [...page.events, ...more.events] });
    } catch (e) {
      useUi.getState().toast((e as Error).message, "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const summary = page?.summary;
  const counts = summary
    ? (Object.entries(summary.status) as [VideoStatus, number][]).filter(([s, n]) => s !== "ok" && n > 0).map(([s, n]) => `${t.ledger.state[s as Exclude<VideoStatus, "ok">]} ${n}`)
    : [];

  return (
    <div>
      <div className="flex flex-col gap-1 px-4 pb-3 text-sm text-fg-2 md:px-6">
        {summary && (
          <p className="font-medium text-fg">
            {[t.ledger.watching(summary.videos), summary.checkedAt ? t.ledger.checked(shortDate(summary.checkedAt, t.locale)) : t.ledger.notChecked].join(" · ")}
          </p>
        )}
        {counts.length > 0 && <p className="text-danger">{counts.join(" · ")}</p>}
        <p className="max-w-[70ch]">{t.ledger.body}</p>
      </div>
      {failed ? (
        <EmptyState icon={<ClockCounterClockwiseIcon size={28} />} title={t.ledger.failed} body="" />
      ) : !page ? (
        <div className="px-2 md:px-3">
          <TrackListSkeleton />
        </div>
      ) : !page.events.length ? (
        <EmptyState icon={<ClockCounterClockwiseIcon size={28} />} title={t.ledger.empty} body={t.ledger.emptyBody} />
      ) : (
        <>
          <ul className="flex flex-col border-t border-line px-2 pt-2 md:px-3">
            {page.events.map((e, i) => (
              <li key={`${e.at}:${e.id}:${e.kind}:${i}`}>
                <button
                  type="button"
                  onClick={() => useUi.getState().openRecord(e.track)}
                  className="flex w-full items-start gap-3 rounded-[12px] px-2 py-2.5 text-left hover:bg-surface-2"
                >
                  <Artwork src={e.track.thumb} className="size-11 shrink-0 rounded-[8px]" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium">{e.track.title}</span>
                    <span className={cn("line-clamp-2 text-[13px] leading-snug break-words", eventTone(e))}>{eventText(e, t)}</span>
                    <span className="truncate text-xs text-fg-3">{e.track.artist}</span>
                  </span>
                  <time dateTime={new Date(e.at).toISOString()} className="shrink-0 pt-0.5 text-xs text-fg-3 tabular-nums">
                    {shortDate(e.at, t.locale)}
                  </time>
                </button>
              </li>
            ))}
          </ul>
          {page.next && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4 disabled:opacity-60"
              >
                {t.ledger.loadMore} <span className="font-mono text-fg-2">{page.events.length}/{page.total}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
