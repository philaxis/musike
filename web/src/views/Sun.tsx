import { CaretLeftIcon, CaretRightIcon, ShuffleIcon, PlayIcon, SunIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Artwork } from "../components/Artwork";
import { IconButton, PlayDisc } from "../components/IconButton";
import { BackButton, Chip, EmptyState, PageHeader } from "../components/Page";
import { TrackList, TrackListSkeleton } from "../components/TrackList";
import { useRemote, type Remote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { cn, seoulDay, shuffled } from "../lib/format";
import { paths } from "../lib/routes";
import { server, type SunPeriod } from "../lib/server";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";

type View = "recent" | "all" | "calendar" | "ago";
const VIEWS: View[] = ["recent", "all", "calendar", "ago"];
const isView = (v: string | null): v is View => VIEWS.includes(v as View);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
/** Dates are the server's (Seoul) "YYYY-MM-DD", handled as UTC midnights so the browser's zone can't shift them. */
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

function useDateText() {
  const t = useT();
  return (date: string, opts: Intl.DateTimeFormatOptions) => new Date(utc(date)).toLocaleDateString(t.locale, { timeZone: "UTC", ...opts });
}

/** The month before or after "YYYY-MM". */
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** ▶ 모두 재생 and shuffle, for a list. */
function PlayBar({ tracks }: { tracks: Track[] }) {
  const t = useT();
  const playList = usePlayer((s) => s.playList);
  if (!tracks.length) return null;
  return (
    <div className="flex items-center gap-2 px-4 pb-3 md:px-6">
      <PlayDisc label={t.common.playAll} onClick={() => playList(tracks, 0)}>
        <PlayIcon size={22} weight="fill" />
      </PlayDisc>
      <IconButton label={t.album.shuffle} size="lg" onClick={() => playList(shuffled(tracks), 0)}>
        <ShuffleIcon size={22} />
      </IconButton>
      <span className="pl-1 text-sm text-fg-2">{t.common.tracks(tracks.length)}</span>
    </div>
  );
}

/**
 * Rows under headers ("☀ 3일", "1년 전"), one list as far as playing goes: a row plays on to the end of the whole list.
 */
function Grouped({ items }: { items: { track: Track; label: string }[] }) {
  const all = items.map((x) => x.track);
  const groups: { label: string; at: number; tracks: Track[] }[] = [];
  items.forEach((x, i) => {
    const last = groups[groups.length - 1];
    if (last?.label === x.label) last.tracks.push(x.track);
    else groups.push({ label: x.label, at: i, tracks: [x.track] });
  });
  return (
    <div className="flex flex-col gap-4 px-2 md:px-3">
      {groups.map((g) => (
        <section key={g.at}>
          <h3 className="px-2 pb-1 text-sm font-semibold text-accent-text md:px-3">{g.label}</h3>
          <TrackList tracks={g.tracks} context={all.slice(g.at)} header={false} showAlbum={false} selectable={false} />
        </section>
      ))}
    </div>
  );
}

function Failed({ page }: { page: Remote<unknown> & { retry: () => void } }) {
  const t = useT();
  if (page.status !== "error") return null;
  return (
    <EmptyState
      icon={<WarningCircleIcon size={28} />}
      title={t.sun.failed}
      body={page.message}
      action={
        <button type="button" onClick={page.retry} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4">
          {t.common.retry}
        </button>
      }
    />
  );
}

/** 요즘 · 전체: tracks by on how many days they got ☀. */
function Ranked({ period, visit }: { period: SunPeriod; visit: number }) {
  const t = useT();
  const page = useRemote(`sun-top:${period}:${visit}`, (signal) => server.sunTop(period, signal));
  const items = page.status === "ok" ? page.data.items : [];
  return (
    <>
      <p className="px-4 pb-4 text-sm text-fg-2 md:px-6">{period === "4w" ? t.sun.recentIntro : t.sun.allIntro}</p>
      {page.status === "loading" && <TrackListSkeleton />}
      <Failed page={page} />
      {page.status === "ok" && !items.length && (
        <EmptyState icon={<SunIcon size={28} />} title={period === "4w" ? t.sun.recentEmpty : t.sun.empty} body={t.sun.emptyBody} />
      )}
      <PlayBar tracks={items.map((x) => x.track)} />
      <Grouped items={items.map((x) => ({ track: x.track, label: t.sun.days(x.days) }))} />
    </>
  );
}

/** One day's ☀, picked on the calendar. */
function DayList({ date }: { date: string }) {
  const t = useT();
  const dateText = useDateText();
  const page = useRemote(`sun-day:${date}`, (signal) => server.dayLikesOn(date, signal));
  const tracks = page.status === "ok" ? page.data.tracks : [];
  return (
    <section className="flex flex-col gap-2 pt-6">
      <h2 className="px-4 text-lg font-semibold tracking-tight md:px-6">{dateText(date, { month: "long", day: "numeric", weekday: "short" })}</h2>
      {page.status === "loading" && <TrackListSkeleton rows={3} />}
      <Failed page={page} />
      {page.status === "ok" && !tracks.length && <p className="px-4 text-sm text-fg-3 md:px-6">{t.stats.dayNoLikes}</p>}
      <PlayBar tracks={tracks} />
      <div className="px-2 md:px-3">
        <TrackList tracks={tracks} header={false} showAlbum={false} selectable={false} />
      </div>
    </section>
  );
}

/** 달력: a month, each day with ☀ showing that day's first ☀ cover; a day opens its list. */
function Calendar({ month, day, visit, go }: { month: string; day: string | null; visit: number; go: (month: string, day?: string) => void }) {
  const t = useT();
  const dateText = useDateText();
  const page = useRemote(`sun-cal:${month}:${visit}`, (signal) => server.sunCalendar(month, signal));
  const today = seoulDay();
  const thisMonth = today.slice(0, 7);
  const first = page.status === "ok" ? page.data.first : null;
  const byDate = new Map(page.status === "ok" ? page.data.days.map((d) => [d.date, d]) : []);
  const start = utc(`${month}-01`);
  const lead = new Date(start).getUTCDay();
  const days = Math.round((utc(`${shiftMonth(month, 1)}-01`) - start) / DAY);

  return (
    <>
      <p className="px-4 pb-4 text-sm text-fg-2 md:px-6">{t.sun.calendarIntro}</p>
      <div className="px-4 md:px-6">
        <div className="max-w-[460px]">
          <div className="flex items-center gap-2 pb-3">
            <IconButton label={t.sun.prevMonth} disabled={!first || month <= first} onClick={() => go(shiftMonth(month, -1))}>
              <CaretLeftIcon size={20} />
            </IconButton>
            <h2 className="flex-1 text-center text-lg font-semibold tracking-tight">{dateText(`${month}-01`, { year: "numeric", month: "long" })}</h2>
            <IconButton label={t.sun.nextMonth} disabled={month >= thisMonth} onClick={() => go(shiftMonth(month, 1))}>
              <CaretRightIcon size={20} />
            </IconButton>
          </div>
          <div className="grid grid-cols-7 gap-1.5 pb-1.5 text-center text-[11px] text-fg-3">
            {/* 2023-01-01 was a Sunday. */}
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i}>{dateText(new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10), { weekday: "narrow" })}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: lead }, (_, i) => (
              <span key={`lead${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const date = new Date(start + i * DAY).toISOString().slice(0, 10);
              const d = byDate.get(date);
              const label = `${dateText(date, { month: "long", day: "numeric" })}${d ? ` · ☀ ${t.common.tracks(d.count)}` : ""}`;
              return (
                <button
                  key={date}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={day === date}
                  disabled={date > today}
                  onClick={() => go(month, date)}
                  className={cn(
                    "relative aspect-square overflow-hidden rounded-[8px] bg-surface-3 text-xs tabular-nums transition-transform active:scale-90 disabled:opacity-40",
                    day === date && "ring-2 ring-fg",
                    date === today && day !== date && "ring-1 ring-accent",
                  )}
                >
                  {d && <Artwork src={d.track.thumb} className="absolute inset-0 size-full" iconSize={14} />}
                  <span className={cn("absolute top-0.5 left-1", d ? "font-semibold text-white [text-shadow:0_0_3px_#000]" : "text-fg-3")}>{i + 1}</span>
                  {d && d.count > 1 && (
                    <span className="absolute right-0.5 bottom-0.5 rounded-full bg-black/60 px-1 text-[10px] leading-4 font-medium text-white">{d.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <Failed page={page} />
      {page.status === "ok" && !first && <EmptyState icon={<SunIcon size={28} />} title={t.sun.empty} body={t.sun.emptyBody} />}
      {day && <DayList key={day} date={day} />}
    </>
  );
}

/** 이맘때: ☀ of the same ±7 days in earlier years. */
function Ago({ visit }: { visit: number }) {
  const t = useT();
  const page = useRemote(`sun-ago:${visit}`, (signal) => server.sunAgo(signal));
  const items = page.status === "ok" ? page.data.items : [];
  return (
    <>
      {page.status === "ok" && items.length > 0 && <p className="px-4 pb-4 text-sm text-fg-2 md:px-6">{t.sun.agoIntro(page.data.span)}</p>}
      {page.status === "loading" && <TrackListSkeleton />}
      <Failed page={page} />
      {page.status === "ok" && !items.length && <EmptyState icon={<SunIcon size={28} />} title={t.sun.agoEmpty} body={t.sun.agoEmptyBody} />}
      <PlayBar tracks={items.map((x) => x.track)} />
      <Grouped items={items.map((x) => ({ track: x.track, label: t.sun.yearsAgo(x.years) }))} />
    </>
  );
}

/** 「☀ 오늘 좋음」 collected: 요즘 · 전체 · 달력 · 이맘때. */
export default function Sun() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const view: View = isView(raw) ? raw : "recent";
  // Made again each visit: a ☀ added a moment ago shows.
  const [visit] = useState(Date.now);
  const monthParam = params.get("month") ?? "";
  const month = MONTH.test(monthParam) ? monthParam : seoulDay().slice(0, 7);
  const dayParam = params.get("day") ?? "";
  const day = DATE.test(dayParam) && dayParam.startsWith(month) ? dayParam : null;
  const label: Record<View, string> = { recent: t.sun.recent, all: t.sun.all, calendar: t.sun.calendar, ago: t.sun.ago };

  return (
    <div className="pb-8">
      <PageHeader title={t.sun.title} actions={<BackButton fallback={paths.library} />} />
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-1 pb-4 md:px-6">
        {VIEWS.map((v) => (
          <Chip key={v} on={view === v} onClick={() => setParams(v === "recent" ? {} : { view: v }, { replace: true })}>
            {label[v]}
          </Chip>
        ))}
      </div>
      {view === "recent" && <Ranked key="4w" period="4w" visit={visit} />}
      {view === "all" && <Ranked key="all" period="all" visit={visit} />}
      {view === "calendar" && (
        <Calendar
          month={month}
          day={day}
          visit={visit}
          go={(m, d) => setParams({ view: "calendar", month: m, ...(d && { day: d }) }, { replace: true })}
        />
      )}
      {view === "ago" && <Ago visit={visit} />}
    </div>
  );
}
