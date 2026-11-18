import { ChartBarIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Artwork } from "../components/Artwork";
import { IconButton } from "../components/IconButton";
import { BackButton, Chip, EmptyState, PageHeader, Section } from "../components/Page";
import { TrackList, TrackListSkeleton } from "../components/TrackList";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import { server, type Stats, type StatsDay, type StatsPeriod } from "../lib/server";
import type { Track } from "../lib/types";

const PERIODS: StatsPeriod[] = ["4w", "6m", "all"];
const isPeriod = (v: string | null): v is StatsPeriod => v === "4w" || v === "6m" || v === "all";
const DAY = 86_400_000;
/** Dates are the server's (Seoul) "YYYY-MM-DD"; handled as UTC midnights so the browser's zone can't shift them. */
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** "전체" can go back years: the calendar shows the last year of it. */
const MAX_WEEKS = 53;
/** Below this many listens ever, the page says the record is only starting. */
const FEW = 20;
/** Calendar shades: how much of the accent a day gets, by quarter of the busiest day. */
const SHADES = [0, 32, 52, 76, 100];

function useDateText() {
  const t = useT();
  return (date: string, opts: Intl.DateTimeFormatOptions) => new Date(utc(date)).toLocaleDateString(t.locale, { timeZone: "UTC", ...opts });
}

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[18px] bg-surface-2 p-4 ring-1 ring-line", className)}>
      <h2 className="pb-3 font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[16px] bg-surface-2 px-4 py-3 ring-1 ring-line">
      <p className="truncate text-[22px] leading-tight font-semibold tracking-tight tabular-nums md:text-2xl">{value}</p>
      <p className="pt-0.5 text-xs text-fg-2">{label}</p>
    </div>
  );
}

/**
 * Days as squares, darker the more was heard. Four weeks read as a month calendar (a row per week, day numbers);
 * longer periods as one column per week under month names, as wide as the card, scrolled to today when wider.
 */
function Calendar({ stats, day, onDay }: { stats: Stats; day: string | null; onDay: (date: string) => void }) {
  const t = useT();
  const dateText = useDateText();
  const byDate = useMemo(() => new Map(stats.days.map((d) => [d.date, d])), [stats]);
  const max = Math.max(1, ...stats.days.map((d) => d.seconds));
  const end = utc(stats.to);
  const lastSunday = end - new Date(end).getUTCDay() * DAY;
  const from = Math.max(stats.from ? utc(stats.from) : end, lastSunday - (MAX_WEEKS - 1) * 7 * DAY);
  const gridStart = from - new Date(from).getUTCDay() * DAY;
  const cells: number[] = [];
  for (let ms = gridStart; ms <= end; ms += DAY) cells.push(ms);
  const month = cells.length <= 6 * 7;
  const weeks = Math.ceil(cells.length / 7);
  const columns = { gridTemplateColumns: `repeat(${weeks}, minmax(11px, 1fr))` };
  const firstOfMonth = (ms: number) => ms >= from && new Date(ms).getUTCDate() === 1;
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [stats]);

  return (
    <div className={cn(month && "max-w-[400px]")}>
      {month && (
        <div className="grid grid-cols-7 gap-1.5 pb-1.5 text-center text-[11px] text-fg-3">
          {/* 2023-01-01 was a Sunday. */}
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>{dateText(iso(Date.UTC(2023, 0, 1 + i)), { weekday: "narrow" })}</span>
          ))}
        </div>
      )}
      <div ref={scroller} className={cn(!month && "scroll-area overflow-x-auto pb-1")}>
        {!month && (
          <div className="grid gap-[3px] pb-1 text-[11px] text-fg-3" style={columns}>
            {Array.from({ length: weeks }, (_, w) => {
              // A month's name over the week its 1st falls in, and over the first week unless one comes right after.
              const days = cells.slice(w * 7, w * 7 + 7);
              const first = days.find(firstOfMonth) ?? (w === 0 && !cells.slice(7, 21).some(firstOfMonth) ? from : undefined);
              return (
                <span key={w} className="overflow-visible whitespace-nowrap">
                  {first !== undefined && dateText(iso(first), { month: "short" })}
                </span>
              );
            })}
          </div>
        )}
        <div className={cn("grid", month ? "grid-cols-7 gap-1.5" : "grid-flow-col grid-rows-7 gap-[3px]")} style={month ? undefined : columns}>
          {cells.map((ms) => {
            const date = iso(ms);
            if (ms < from) return <span key={date} />;
            const d = byDate.get(date);
            const shade = d ? SHADES[Math.min(4, Math.ceil((d.seconds / max) * 4))] : 0;
            const label = `${dateText(date, { month: "long", day: "numeric" })} · ${d ? t.time.total(d.seconds) : t.stats.nothing}`;
            return (
              <button
                key={date}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={day === date}
                onClick={() => onDay(date)}
                className={cn(
                  "grid place-items-center bg-surface-3 transition-transform active:scale-90",
                  month ? "aspect-square rounded-[8px] text-xs tabular-nums" : "aspect-square w-full rounded-[3px]",
                  day === date && "ring-2 ring-fg",
                )}
                style={shade ? { backgroundColor: `color-mix(in srgb, var(--accent) ${shade}%, var(--surface-3))` } : undefined}
              >
                {month && <span className={shade > 52 ? "font-medium text-accent-ink" : shade ? "text-fg" : "text-fg-3"}>{new Date(ms).getUTCDate()}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <p className="pt-3 text-xs text-fg-3">{t.stats.calendarHint}</p>
    </div>
  );
}

/** Seconds heard by the hour a track started, 0–23, the busiest hour lit. */
function Hours({ hours }: { hours: number[] }) {
  const t = useT();
  const max = Math.max(...hours);
  const peak = hours.indexOf(max);
  const cols = "grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]";
  return (
    <div>
      <div className={cn(cols, "h-28 items-end")}>
        {hours.map((s, h) => (
          <span
            key={h}
            title={`${t.stats.hourLabel(h)} · ${t.time.total(s)}`}
            className={cn("rounded-t-[3px]", max > 0 && h === peak ? "bg-accent" : "bg-fg-3/45")}
            style={{ height: max ? `${Math.max(2, (s / max) * 100)}%` : "2%" }}
          />
        ))}
      </div>
      <div className={cn(cols, "pt-1 font-mono text-[11px] text-fg-3")}>
        {hours.map((_, h) => (
          <span key={h}>{h % 6 === 0 ? h : ""}</span>
        ))}
      </div>
      {max > 0 && <p className="pt-3 text-xs text-fg-3">{t.stats.peakHour(peak)}</p>}
    </div>
  );
}

/** The tracks heard on a day the calendar picked, and that day's 「오늘 좋음 ☀」. */
function DayDetail({ date, onClose, className }: { date: string; onClose: () => void; className?: string }) {
  const t = useT();
  const dateText = useDateText();
  const [data, setData] = useState<StatsDay | "error" | null>(null);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    setData(null);
    const ctrl = new AbortController();
    server.statsDay(date, ctrl.signal).then(setData, (e: Error) => e.name !== "AbortError" && setData("error"));
    return () => ctrl.abort();
  }, [date]);
  // Picked on a phone, the list opens under the calendar: bring its top into view.
  useEffect(() => box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), [date]);

  const list = (title: string, tracks: Track[], empty: string) => (
    <div className="pt-3">
      <h4 className="px-1 pb-1 text-sm font-medium text-fg-2">{title}</h4>
      {tracks.length ? (
        <div className="-mx-1 md:-mx-2">
          <TrackList tracks={tracks} header={false} showAlbum={false} selectable={false} />
        </div>
      ) : (
        <p className="px-1 py-2 text-sm text-fg-3">{empty}</p>
      )}
    </div>
  );

  return (
    <section ref={box} className={cn("scroll-mt-20 rounded-[18px] bg-surface-2 p-3 ring-1 ring-line md:p-4", className)}>
      <div className="flex items-center gap-3 px-1">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold tracking-tight">{dateText(date, { month: "long", day: "numeric", weekday: "short" })}</h3>
          <p className="text-sm text-fg-2">
            {data && data !== "error" ? (data.seconds ? t.stats.dayHeard(t.time.total(data.seconds)) : t.stats.nothing) : "\u00a0"}
          </p>
        </div>
        <IconButton label={t.common.close} onClick={onClose}>
          <XIcon size={18} />
        </IconButton>
      </div>
      {data === null ? (
        <TrackListSkeleton rows={3} />
      ) : data === "error" ? (
        <p className="px-1 pt-3 text-sm text-danger">{t.stats.failed}</p>
      ) : (
        <>
          {list(t.stats.dayLiked, data.liked, t.stats.dayNoLikes)}
          {list(t.stats.dayTracks, data.tracks, t.stats.dayNoTracks)}
        </>
      )}
    </section>
  );
}

function TrackSection({ title, sub, tracks }: { title: string; sub?: string; tracks: Track[] }) {
  if (!tracks.length) return null;
  return (
    <Section title={title} action={sub && <span className="hidden text-sm text-fg-3 sm:block">{sub}</span>}>
      <div className="px-2 md:px-3">
        <TrackList tracks={tracks} header={false} showAlbum={false} selectable={false} />
      </div>
    </Section>
  );
}

/** Library's 「내 기록」: what was heard over 4 weeks, 6 months or all of it (server/src/stats.ts). */
export default function StatsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const raw = params.get("period");
  const period: StatsPeriod = isPeriod(raw) ? raw : "4w";
  const day = params.get("day");
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setError(null);
    const ctrl = new AbortController();
    server.stats(period, ctrl.signal).then(setData, (e: Error) => e.name !== "AbortError" && setError(e.message));
    return () => ctrl.abort();
  }, [period, attempt]);

  const go = (next: { period?: StatsPeriod; day?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.period) {
      p.set("period", next.period);
      p.delete("day");
    }
    if (next.day !== undefined) {
      if (next.day) p.set("day", next.day);
      else p.delete("day");
    }
    setParams(p, { replace: true });
  };

  const header = <PageHeader title={t.stats.title} actions={<BackButton fallback={paths.library} />} />;

  if (error && !data) {
    return (
      <div className="pb-8">
        {header}
        <EmptyState
          icon={<ChartBarIcon size={28} />}
          title={t.stats.failed}
          body={error}
          action={
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="h-10 rounded-full bg-surface-3 px-4 text-sm font-medium">
              {t.common.retry}
            </button>
          }
        />
      </div>
    );
  }

  if (data && data.total === 0 && data.summary.lines === 0) {
    return (
      <div className="pb-8">
        {header}
        <EmptyState icon={<ChartBarIcon size={28} />} title={t.stats.emptyTitle} body={t.stats.emptyBody} />
      </div>
    );
  }

  const stale = !data || data.period !== period;
  const s = data?.summary;
  const periodLabel = { "4w": t.stats.period4w, "6m": t.stats.period6m, all: t.stats.periodAll };
  const topArtist = data?.topArtists[0]?.listens ?? 1;
  const genreTotal = data?.genres?.reduce((n, g) => n + g.listens, 0) ?? 1;

  return (
    <div className="pb-10">
      {header}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-2 md:px-6">
        {PERIODS.map((p) => (
          <Chip key={p} on={p === period} onClick={() => go({ period: p })}>
            {periodLabel[p]}
          </Chip>
        ))}
      </div>

      {data && data.total < FEW && <p className="mx-4 mt-4 rounded-[14px] bg-accent-soft px-4 py-3 text-sm text-fg md:mx-6">{t.stats.fewNote}</p>}

      {!data || !s ? (
        <div className="grid grid-cols-2 gap-2 px-4 pt-4 md:grid-cols-4 md:px-6">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="skeleton h-[74px] rounded-[16px]" />
          ))}
        </div>
      ) : (
        <div className={cn("flex flex-col gap-8 pt-4 transition-opacity", stale && "opacity-60")}>
          <div className="flex flex-col gap-3 px-4 md:px-6">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Figure value={t.time.total(s.seconds)} label={t.stats.heard} />
              <Figure value={t.stats.times(s.listens)} label={t.stats.listens} />
              <Figure value={t.basics.tracks(s.newTracks)} label={t.stats.newTracks} />
              <Figure value={`${Math.round(s.skipRate * 100)}%`} label={t.stats.skipRate} />
            </div>
            {s.lines === 0 && <p className="text-sm text-fg-2">{t.stats.periodEmpty}</p>}
            {/* Phones: the picked day right under the calendar; wide screens: under both cards. */}
            <div className="grid gap-3 lg:grid-cols-2">
              <Card title={t.stats.calendar}>
                <Calendar stats={data} day={day} onDay={(d) => go({ day: d === day ? null : d })} />
              </Card>
              {day && <DayDetail key={day} date={day} onClose={() => go({ day: null })} className="lg:order-last lg:col-span-2" />}
              <Card title={t.stats.hours}>
                <Hours hours={data.hours} />
              </Card>
            </div>
          </div>

          <TrackSection title={t.stats.topTracks} tracks={data.topTracks} />

          {data.topArtists.length > 0 && (
            <Section title={t.stats.topArtists}>
              <ul className="grid grid-cols-1 gap-1 px-2 sm:grid-cols-2 md:px-3">
                {data.topArtists.map((a) => (
                  <li key={a.name}>
                    <Link
                      to={`${paths.search}?q=${encodeURIComponent(a.name)}`}
                      className="flex items-center gap-3 rounded-[14px] p-2 transition-colors hover:bg-surface-2"
                    >
                      <Artwork src={a.thumb} className="size-11 shrink-0 rounded-full" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="mt-1.5 block h-1 rounded-full bg-surface-3">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${(a.listens / topArtist) * 100}%` }} />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.genres && (
            <Section title={t.stats.genres}>
              <ul className="flex flex-col gap-2 px-4 md:px-6">
                {data.genres.map((g) => (
                  <li key={g.genre} className="grid grid-cols-[minmax(0,6.5rem)_1fr_2.5rem] items-center gap-3 text-sm md:grid-cols-[minmax(0,9rem)_1fr_3rem]">
                    <span className="truncate">{g.genre}</span>
                    <span className="h-2 rounded-full bg-surface-3">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${(g.listens / data.genres![0].listens) * 100}%` }} />
                    </span>
                    <span className="text-right text-fg-2 tabular-nums">{Math.round((g.listens / genreTotal) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Over 4 weeks it would repeat 「많이 들은 곡」. */}
          {period !== "4w" && <TrackSection title={t.stats.onRepeat} sub={t.stats.onRepeatSub} tracks={data.onRepeat} />}
          <TrackSection title={t.stats.forgotten} sub={t.stats.forgottenSub} tracks={data.forgotten} />
        </div>
      )}
    </div>
  );
}
