import { ArrowsLeftRightIcon, ClockCounterClockwiseIcon, DotsThreeIcon, FunnelSimpleIcon, ProhibitIcon, TrayIcon, type Icon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { IconButton } from "../components/IconButton";
import { openMenuFromButton } from "../components/menuTrigger";
import { Chip, EmptyState, PageHeader } from "../components/Page";
import { SelectableRow, SelectedCount, SelectionBar, Short, useListSelection } from "../components/Selection";
import { TagChips, useSourceText } from "../components/Tags";
import { TrackListSkeleton } from "../components/TrackList";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import { paths } from "../lib/routes";
import { server, type BoxItem, type BoxSource, type ReplacedBy } from "../lib/server";
import type { Track, Unplayable } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { useTagEdits } from "../stores/tags";
import { VideoChanges } from "../components/VideoChanges";
import { useUi } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";

type SourceCount = Omit<BoxSource, "at"> & { count: number };

/** A view of 「모든 곡」 kept in ⋯ (the address it opens, and how many tracks when that is known). */
interface BoxView {
  mode: string;
  label: string;
  icon: Icon;
  count?: number;
  params: Record<string, string>;
}

/** ⋯ in the header: the views for tidying up. */
function ViewsMenu({ views, current, onPick }: { views: BoxView[]; current: string; onPick: (params: Record<string, string>) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <IconButton
        label={t.songBox.moreViews}
        aria-haspopup="menu"
        aria-expanded={open}
        active={views.some((v) => v.mode === current)}
        onClick={() => setOpen((o) => !o)}
      >
        <DotsThreeIcon size={24} weight="bold" />
      </IconButton>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-20 mt-1 w-64 rounded-[14px] bg-surface-2 p-1.5 shadow-[0_16px_40px_rgb(0_0_0/0.45)] ring-1 ring-line">
          {views.map(({ mode, label, icon: ViewIcon, count, params }) => (
            <button
              key={mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === current}
              onClick={() => {
                setOpen(false);
                onPick(params);
              }}
              className={cn(
                "flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-sm hover:bg-surface-3",
                mode === current ? "font-medium text-accent-text" : "text-fg",
              )}
            >
              <ViewIcon size={18} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {count !== undefined && <span className="font-mono text-xs text-fg-3">{count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Library's 「모든 곡」 (once 「곡 상자」): every track brought in (and the music folders), newest first, 200 at a
 * time. Filter by unsorted (no tags) or tag; pick several to play or put in a playlist. In ⋯: by source, the tracks
 * that won't play here (put aside, each with 「다른 판 찾기」), the stand-ins put in their place (each with 「되돌리기」
 * and 「다른 판 고르기」), and 「변경 기록」, what changed about the tracks on YouTube. Not in TV mode, which only plays.
 */
export default function SongBox() {
  const [params, setParams] = useSearchParams();
  const t = useT();
  const sourceText = useSourceText();
  const playList = usePlayer((s) => s.playList);
  const edits = useTagEdits((s) => s.edits);

  const source = params.get("source") ?? "";
  const tag = params.get("tag") ?? "";
  const untagged = params.get("filter") === "untagged";
  const aside = params.get("filter") === "blocked";
  const changes = params.get("filter") === "changes";
  const standIns = params.get("filter") === "replaced";
  const mode =
    source || params.get("by") === "source"
      ? "source"
      : tag || params.get("by") === "tag"
        ? "tag"
        : untagged
          ? "untagged"
          : aside
            ? "aside"
            : standIns
              ? "standIns"
              : changes
                ? "changes"
              : "all";

  const [page, setPage] = useState<{ items: BoxItem[]; total: number; next: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sources, setSources] = useState<SourceCount[] | null>(null);
  const [asideCounts, setAsideCounts] = useState<Partial<Record<Unplayable, number>>>({});
  const [standInCounts, setStandInCounts] = useState<Partial<Record<ReplacedBy, number>>>({});
  const [tags, setTags] = useState<{ tag: string; count: number }[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const replaced = useUi((s) => s.lastReplaced);

  const filter = untagged ? ("untagged" as const) : aside ? ("blocked" as const) : standIns ? ("replaced" as const) : undefined;
  const query = { filter, source: source || undefined, tag: tag || undefined };

  // A new filter starts a new list: the selection empties with it (rows that left the list leave it).
  useEffect(() => {
    if (changes) return;
    const ctrl = new AbortController();
    setPage(null);
    setFailed(false);
    server.box(query, ctrl.signal).then(setPage, (e: Error) => e.name !== "AbortError" && setFailed(true));
    return () => ctrl.abort();
  }, [untagged, aside, standIns, source, tag, changes]);

  const items = page?.items ?? [];
  const tracks: Track[] = useMemo(() => (page?.items ?? []).map((it) => it.track), [page]);
  // Tracks put aside won't play: no picking there, only 「다른 판 찾기」 per row.
  const sel = useListSelection(tracks, !isTvMode() && !aside);

  // Sources, how many tracks are put aside and how many stand in for them (for the chips), again after a replacement.
  useEffect(() => {
    server.boxSources().then(
      (r) => {
        setSources(r.sources);
        setAsideCounts(r.aside);
        setStandInCounts(r.replaced ?? {});
      },
      () => setSources([]),
    );
  }, [replaced]);

  useEffect(() => {
    if (mode === "tag" && !tags) server.tags().then(setTags, () => setTags([]));
  }, [mode]);

  // A track replaced by another version (「다른 판 찾기」): it leaves the put-aside list, elsewhere the row follows.
  useEffect(() => {
    if (!replaced) return;
    setPage((p) => {
      if (!p?.items.some((it) => it.track.id === replaced.from)) return p;
      if (aside) return { ...p, items: p.items.filter((it) => it.track.id !== replaced.from), total: p.total - 1 };
      return {
        ...p,
        items: p.items.map((it) =>
          it.track.id === replaced.from
            ? { ...it, track: replaced.track, blocked: undefined, replaced: it.replaced && { ...it.replaced, by: "manual" as const } }
            : it,
        ),
      };
    });
  }, [replaced]);
  const asideTotal = Object.values(asideCounts).reduce((n, c) => n + (c ?? 0), 0);
  const standInTotal = Object.values(standInCounts).reduce((n, c) => n + (c ?? 0), 0);

  /** 「되돌리기」: the original back in place of stand-in `it` (put aside again), everywhere it was. */
  const restore = async (it: BoxItem) => {
    setRestoring(it.track.id);
    try {
      const r = await server.restoreTrack(it.track.id);
      usePlayer.getState().replaceTrack(it.track.id, r.track);
      void useLibrary.getState().load();
      setPage((p) => p && { ...p, items: p.items.filter((x) => x !== it), total: p.total - 1 });
      const by = it.replaced?.by;
      if (by) setStandInCounts((c) => ({ ...c, [by]: Math.max(0, (c[by] ?? 1) - 1) }));
      if (r.track.blocked) setAsideCounts((c) => ({ ...c, [r.track.blocked!]: (c[r.track.blocked!] ?? 0) + 1 }));
      useUi.getState().toast(t.standIns.restored(r.track.title));
    } catch (e) {
      useUi.getState().toast((e as Error).message, "error");
    } finally {
      setRestoring(null);
    }
  };

  if (isTvMode()) return <Navigate to={paths.library} replace />;

  const loadMore = async () => {
    if (!page?.next) return;
    setLoadingMore(true);
    try {
      const more = await server.box({ ...query, cursor: page.next });
      setPage({ items: [...page.items, ...more.items], total: more.total, next: more.next });
    } catch (e) {
      useUi.getState().toast((e as Error).message, "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const chosen = sel.chosen;
  const allSelected = tracks.length > 0 && chosen.length === tracks.length;
  const menuFor = (i: number) => sel.menuFor(i, { kind: "track", track: tracks[i] });

  // Views for tidying up, kept out of the way in ⋯: where tracks came from, those put aside, the stand-ins, what changed.
  const views: BoxView[] = [
    { mode: "source", label: t.songBox.bySource, icon: FunnelSimpleIcon, params: { by: "source" } },
    ...(asideTotal > 0 || aside ? [{ mode: "aside", label: t.aside.chip, icon: ProhibitIcon, count: asideTotal, params: { filter: "blocked" } }] : []),
    ...(standInTotal > 0 || standIns
      ? [{ mode: "standIns", label: t.standIns.chip, icon: ArrowsLeftRightIcon, count: standInTotal, params: { filter: "replaced" } }]
      : []),
    { mode: "changes", label: t.ledger.chip, icon: ClockCounterClockwiseIcon, params: { filter: "changes" } },
  ];
  const shownView = views.find((v) => v.mode === mode);

  return (
    <div className="pb-8">
      <PageHeader title={t.songBox.title} actions={<ViewsMenu views={views} current={mode} onPick={(p) => setParams(p)} />} />

      <div className="flex flex-col gap-2 px-4 pt-1 pb-3 md:px-6">
        <div className="scroll-area -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <Chip on={mode === "all"} onClick={() => setParams({})}>
            {t.songBox.all}
          </Chip>
          <Chip on={mode === "untagged"} onClick={() => setParams({ filter: "untagged" })}>
            {t.songBox.untagged}
          </Chip>
          <Chip on={mode === "tag"} onClick={() => setParams({ by: "tag" })}>
            {t.songBox.byTag}
          </Chip>
          {/* A view picked in ⋯ shows as a chip while it is open. */}
          {shownView && (
            <Chip on onClick={() => setParams(shownView.params)}>
              {shownView.label} {shownView.count !== undefined && <span className="font-mono opacity-70">{shownView.count}</span>}
            </Chip>
          )}
        </div>

        {mode === "source" && (
          <div className="scroll-area -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
            {(sources ?? []).map((s) => {
              const key = `${s.kind}:${s.ref}`;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={source === key}
                  onClick={() => setParams({ source: key })}
                  className={cn(
                    "h-8 shrink-0 rounded-full px-3 text-[13px] whitespace-nowrap",
                    source === key ? "bg-accent text-accent-ink" : "bg-surface-1 text-fg-2 ring-1 ring-line hover:text-fg",
                  )}
                >
                  {sourceText(s)} <span className="font-mono opacity-70">{s.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {mode === "tag" && (
          <div className="scroll-area -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
            {tags?.length === 0 && <p className="text-sm text-fg-2">{t.songBox.noTags}</p>}
            {(tags ?? []).map((x) => (
              <button
                key={x.tag}
                type="button"
                aria-pressed={tag === x.tag}
                onClick={() => setParams({ tag: x.tag })}
                className={cn(
                  "h-8 shrink-0 rounded-full px-3 text-[13px] whitespace-nowrap",
                  tag === x.tag ? "bg-accent text-accent-ink" : "bg-surface-1 text-fg-2 ring-1 ring-line hover:text-fg",
                )}
              >
                {x.tag} <span className="font-mono opacity-70">{x.count}</span>
              </button>
            ))}
          </div>
        )}
        {mode === "aside" && (
          <div className="flex flex-col gap-1 text-sm text-fg-2">
            <p className="font-medium text-danger">
              {(Object.entries(asideCounts) as [Unplayable, number][]).map(([r, n]) => t.aside.count(t.aside.reason[r], n)).join(" · ")}
            </p>
            <p className="max-w-[70ch]">{t.aside.body}</p>
          </div>
        )}
        {mode === "standIns" && (
          <div className="flex flex-col gap-1 text-sm text-fg-2">
            <p className="font-medium text-fg">
              {(Object.entries(standInCounts) as [ReplacedBy, number][])
                .filter(([, n]) => n > 0)
                .map(([by, n]) => t.standIns.count(t.standIns.by[by], n))
                .join(" · ")}
            </p>
            <p className="max-w-[70ch]">{t.standIns.body}</p>
          </div>
        )}
      </div>

      {changes ? (
        <VideoChanges />
      ) : failed ? (
        <EmptyState icon={<TrayIcon size={28} />} title={t.songBox.failed} body="" />
      ) : !page ? (
        <div className="px-2 md:px-3">
          <TrackListSkeleton />
        </div>
      ) : !items.length ? (
        <EmptyState
          icon={<TrayIcon size={28} />}
          title={mode === "all" ? t.songBox.empty : t.songBox.emptyFiltered}
          body={mode === "all" ? t.songBox.emptyBody : ""}
        />
      ) : (
        <div onPointerDownCapture={sel.activate}>
          {aside ? (
            <p className="border-b border-line px-4 py-2.5 text-sm text-fg-2 md:px-6">{t.songBox.count(page.total)}</p>
          ) : (
            <SelectionBar
              chosen={chosen}
              all={tracks}
              allSelected={allSelected}
              onToggleAll={allSelected ? sel.clear : sel.selectAll}
              onClear={sel.clear}
              selecting={sel.mode}
              label={
                chosen.length ? (
                  <SelectedCount n={chosen.length} total={page.total} />
                ) : (
                  <Short phone={t.songBox.count(page.total)} wide={`${t.selection.selectAll} · ${t.songBox.count(page.total)}`} />
                )
              }
            />
          )}
          <ul className="mt-2 flex flex-col px-2 md:px-3">
            {items.map((it, i) => (
              <li key={it.track.id}>
                <SelectableRow
                  track={it.track}
                  selected={sel.has(it.track.id)}
                  onToggle={(e) => sel.toggle(i, e.shiftKey)}
                  onPlay={() => (aside ? useUi.getState().openAlternatives(it.track) : playList(tracks, i, 0, true))}
                  menu={() => menuFor(i)}
                  drag={() => (sel.has(it.track.id) ? chosen : [it.track])}
                  row={i}
                  paint={(e) => sel.paint(i, e)}
                  dim={!!it.track.blocked}
                  below={
                    <>
                      {standIns && it.replaced ? (
                        <span className="mt-0.5 line-clamp-2 text-xs text-fg-3">
                          <span className="text-accent-text">{t.standIns.by[it.replaced.by]}</span> · {t.standIns.was(it.replaced.was.title)}
                          {it.replaced.was.artist && ` · ${it.replaced.was.artist}`}
                          {it.replaced.was.duration > 0 && ` · ${formatTime(it.replaced.was.duration)}`}
                        </span>
                      ) : (
                        <span className="mt-0.5 block truncate text-xs text-fg-3">
                          {it.track.blocked && <span className="text-danger">{t.aside.reason[it.track.blocked]} · </span>}
                          {it.sources.map(sourceText).join(", ")}
                        </span>
                      )}
                      <TagChips tags={edits[it.track.id] ?? it.tags} className="mt-1" />
                    </>
                  }
                  trailing={
                    <>
                      {it.track.blocked && (
                        <button
                          type="button"
                          onClick={() => useUi.getState().openAlternatives(it.track)}
                          className="h-8 shrink-0 rounded-full bg-surface-3 px-3 text-xs font-medium whitespace-nowrap hover:bg-surface-4"
                        >
                          {t.aside.findOther}
                        </button>
                      )}
                      {standIns && it.replaced && (
                        <>
                          <button
                            type="button"
                            disabled={!!restoring}
                            onClick={() => void restore(it)}
                            className="h-8 shrink-0 rounded-full bg-surface-3 px-3 text-xs font-medium whitespace-nowrap hover:bg-surface-4 disabled:opacity-60"
                          >
                            {restoring === it.track.id ? "…" : t.standIns.restore}
                          </button>
                          <button
                            type="button"
                            onClick={() => useUi.getState().openAlternatives(it.track)}
                            className="h-8 shrink-0 rounded-full bg-surface-3 px-3 text-xs font-medium whitespace-nowrap hover:bg-surface-4"
                          >
                            {t.standIns.pickOther}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={(e) => openMenuFromButton(e, menuFor(i))}
                        aria-label={t.trackList.moreFor(it.track.title)}
                        title={t.trackList.more}
                        className="grid size-9 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
                      >
                        <DotsThreeIcon size={22} weight="bold" />
                      </button>
                    </>
                  }
                />
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
                {t.songBox.loadMore} <span className="font-mono text-fg-2">{items.length}/{page.total}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
