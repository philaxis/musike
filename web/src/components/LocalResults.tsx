import { HardDrivesIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { server } from "../lib/server";
import type { Track } from "../lib/types";
import { TrackList } from "./TrackList";

const LIMIT = 50;
const PREVIEW = 5;

/** Search's "My music": the server's own files matching the query, above YouTube's results. Nothing when none match. */
export function LocalResults({ q }: { q: string }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [expanded, setExpanded] = useState(false);
  const t = useT();

  useEffect(() => {
    setExpanded(false);
    if (!q) return setTracks([]);
    const ctrl = new AbortController();
    server.searchLocal(q, LIMIT, ctrl.signal).then(setTracks, () => setTracks([]));
    return () => ctrl.abort();
  }, [q]);

  if (!tracks.length) return null;
  const shown = expanded ? tracks : tracks.slice(0, PREVIEW);

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between gap-4 px-2 pb-2 md:px-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <HardDrivesIcon size={20} className="text-accent-text" /> {t.search.myMusic}
        </h2>
        {tracks.length > PREVIEW && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="text-sm font-medium text-fg-2 hover:text-fg">
            {expanded ? t.search.showLess : t.search.showAll(tracks.length)}
          </button>
        )}
      </div>
      <TrackList tracks={shown} context={tracks} header={false} />
    </section>
  );
}
