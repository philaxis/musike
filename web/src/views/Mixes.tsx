import { SparkleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { mixMenu } from "../components/menus";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { CardGrid, CardGridSkeleton, TrackCard } from "../components/TasteCards";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { paths } from "../lib/routes";
import { server } from "../lib/server";
import { mixAbout, mixTitle } from "../lib/taste";

/** Today's automatic playlists, made by the server. */
export default function Mixes() {
  const t = useT();
  // Made again each visit: listening changes them during the day.
  const [visit] = useState(Date.now);
  const page = useRemote(`mixes:${visit}`, (signal) => server.mixes(signal));

  return (
    <div className="pb-8">
      <PageHeader title={t.taste.mixes} actions={<BackButton fallback={paths.library} />} />
      <p className="px-4 pt-2 pb-5 text-sm text-fg-2 md:px-6">{t.taste.mixesIntro}</p>

      {page.status === "loading" && <CardGridSkeleton />}
      {page.status === "error" && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.taste.openFailed}
          body={page.message}
          action={
            <button type="button" onClick={page.retry} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4">
              {t.common.retry}
            </button>
          }
        />
      )}
      {page.status === "ok" && !page.data.mixes.length && (
        <EmptyState icon={<SparkleIcon size={28} />} title={t.taste.mixesEmpty} body={t.taste.mixesEmptyBody} />
      )}
      {page.status === "ok" && page.data.mixes.length > 0 && (
        <CardGrid>
          {page.data.mixes.map((m) => (
            <TrackCard key={m.id} to={paths.mix(m.id)} title={mixTitle(m, t)} sub={mixAbout(m, t)} tracks={m.tracks} menu={() => mixMenu(m)} />
          ))}
        </CardGrid>
      )}
    </div>
  );
}
