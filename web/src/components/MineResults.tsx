import { MagnifyingGlassIcon, YoutubeLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { server } from "../lib/server";
import type { Track } from "../lib/types";
import { useLocal } from "../stores/local";
import { EmptyState } from "./Page";
import { TrackList, TrackListSkeleton } from "./TrackList";

/**
 * Search's default: only what is already in the app (the song box, which also holds the music folders).
 * YouTube is searched only when asked (`onYoutube`).
 */
export function MineResults({ q, onYoutube }: { q: string; onYoutube: () => void }) {
  const t = useT();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Hiding a track from these results takes it out of them.
  const generation = useLocal((s) => s.generation);

  useEffect(() => {
    setTracks(null);
    setFailed(false);
    if (!q) return;
    const ctrl = new AbortController();
    server.box({ q }, ctrl.signal).then(
      (page) => {
        setTracks(page.items.map((it) => it.track));
        setNext(page.next);
        setTotal(page.total);
      },
      (e: Error) => e.name !== "AbortError" && setFailed(true),
    );
    return () => ctrl.abort();
  }, [q, generation]);

  const loadMore = async () => {
    if (!next || !tracks) return;
    setLoadingMore(true);
    try {
      const page = await server.box({ q, cursor: next });
      setTracks([...tracks, ...page.items.map((it) => it.track)]);
      setNext(page.next);
    } finally {
      setLoadingMore(false);
    }
  };

  const youtubeButton = (
    <button
      type="button"
      onClick={onYoutube}
      className="mt-2 inline-flex h-11 items-center gap-2 rounded-full bg-surface-3 px-5 text-sm font-medium hover:bg-surface-4"
    >
      <YoutubeLogoIcon size={18} weight="fill" className="text-[#ff4e45]" /> {t.search.searchYoutube}
    </button>
  );

  if (!q) return null;
  if (failed) return <EmptyState icon={<MagnifyingGlassIcon size={28} />} title={t.search.failed} body="" />;
  if (!tracks) return <TrackListSkeleton />;
  if (!tracks.length)
    return (
      <EmptyState
        icon={<MagnifyingGlassIcon size={28} />}
        title={t.search.nothingFound}
        body={t.search.notInMine(q)}
        action={youtubeButton}
      />
    );

  return (
    <section>
      <p className="px-2 pb-2 text-sm text-fg-2 md:px-3">{t.search.mineCount(total)}</p>
      <TrackList tracks={tracks} context={tracks} />
      <div className="flex flex-wrap justify-center gap-2 pt-4">
        {next && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4 disabled:opacity-60"
          >
            {t.songBox.loadMore} <span className="font-mono text-fg-2">{tracks.length}/{total}</span>
          </button>
        )}
      </div>
      <div className="flex justify-center">{youtubeButton}</div>
    </section>
  );
}
