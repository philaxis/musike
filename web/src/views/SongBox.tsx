import { DotsThreeIcon, TrayIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router";
import { openMenuFromButton } from "../components/menuTrigger";
import { EmptyState, PageHeader } from "../components/Page";
import { SelectableRow, SelectedCount, SelectionBar, Short, useListSelection } from "../components/Selection";
import { TagChips, useSourceText } from "../components/Tags";
import { TrackListSkeleton } from "../components/TrackList";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import { server, type BoxItem, type BoxSource } from "../lib/server";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useTagEdits } from "../stores/tags";
import { useUi } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";

type SourceCount = Omit<BoxSource, "at"> & { count: number };

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
        on ? "bg-fg text-bg" : "bg-surface-2 text-fg-2 ring-1 ring-line hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Library's 「곡 상자」: every track brought in (and the music folders), newest first, 200 at a time. Filter by
 * unsorted (no tags), source or tag; pick several to play or put in a playlist. Not in TV mode, which only plays.
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
  const mode = source || params.get("by") === "source" ? "source" : tag || params.get("by") === "tag" ? "tag" : untagged ? "untagged" : "all";

  const [page, setPage] = useState<{ items: BoxItem[]; total: number; next: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sources, setSources] = useState<SourceCount[] | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[] | null>(null);

  const query = { filter: untagged ? ("untagged" as const) : undefined, source: source || undefined, tag: tag || undefined };

  // A new filter starts a new list: the selection empties with it (rows that left the list leave it).
  useEffect(() => {
    const ctrl = new AbortController();
    setPage(null);
    setFailed(false);
    server.box(query, ctrl.signal).then(setPage, (e: Error) => e.name !== "AbortError" && setFailed(true));
    return () => ctrl.abort();
  }, [untagged, source, tag]);

  const items = page?.items ?? [];
  const tracks: Track[] = useMemo(() => (page?.items ?? []).map((it) => it.track), [page]);
  const sel = useListSelection(tracks, !isTvMode());

  useEffect(() => {
    if (mode === "source" && !sources) server.boxSources().then((r) => setSources(r.sources), () => setSources([]));
    if (mode === "tag" && !tags) server.tags().then(setTags, () => setTags([]));
  }, [mode]);

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

  return (
    <div className="pb-8">
      <PageHeader title={t.songBox.title} />

      <div className="flex flex-col gap-2 px-4 pt-1 pb-3 md:px-6">
        <div className="scroll-area -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <Chip on={mode === "all"} onClick={() => setParams({})}>
            {t.songBox.all}
          </Chip>
          <Chip on={mode === "untagged"} onClick={() => setParams({ filter: "untagged" })}>
            {t.songBox.untagged}
          </Chip>
          <Chip on={mode === "source"} onClick={() => setParams({ by: "source" })}>
            {t.songBox.bySource}
          </Chip>
          <Chip on={mode === "tag"} onClick={() => setParams({ by: "tag" })}>
            {t.songBox.byTag}
          </Chip>
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
      </div>

      {failed ? (
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
          <ul className="mt-2 flex flex-col px-2 md:px-3">
            {items.map((it, i) => (
              <li key={it.track.id}>
                <SelectableRow
                  track={it.track}
                  selected={sel.has(it.track.id)}
                  onToggle={(e) => sel.toggle(i, e.shiftKey)}
                  onPlay={() => playList(tracks, i)}
                  menu={() => menuFor(i)}
                  drag={() => (sel.has(it.track.id) ? chosen : [it.track])}
                  row={i}
                  paint={(e) => sel.paint(i, e)}
                  dim={!!it.gone}
                  below={
                    <>
                      <span className="mt-0.5 block truncate text-xs text-fg-3">
                        {it.gone && <span className="text-danger">{t.songBox.gone} · </span>}
                        {it.sources.map(sourceText).join(", ")}
                      </span>
                      <TagChips tags={edits[it.track.id] ?? it.tags} className="mt-1" />
                    </>
                  }
                  trailing={
                    <button
                      type="button"
                      onClick={(e) => openMenuFromButton(e, menuFor(i))}
                      aria-label={t.trackList.moreFor(it.track.title)}
                      title={t.trackList.more}
                      className="grid size-9 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
                    >
                      <DotsThreeIcon size={22} weight="bold" />
                    </button>
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
