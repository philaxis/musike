import { WarningCircleIcon } from "@phosphor-icons/react";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { CardGrid, CardGridSkeleton, TrackCard } from "../components/TasteCards";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { paths } from "../lib/routes";
import { server } from "../lib/server";

/** The taste analysis' genres, biggest first; each opens its sound groups. */
export default function TasteGenres() {
  const t = useT();
  const page = useRemote("taste-genres", (signal) => server.tasteGenres(signal));

  return (
    <div className="pb-8">
      <PageHeader title={t.taste.genres} actions={<BackButton fallback={paths.library} />} />
      <p className="px-4 pt-2 pb-5 text-sm text-fg-2 md:px-6">{t.taste.genresIntro}</p>

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
      {page.status === "ok" && (
        <CardGrid>
          {page.data.genres.map((g) => (
            <TrackCard key={g.genre} to={paths.tasteGenre(g.genre)} title={g.genre} sub={t.taste.genreSub(g.count, g.groups)} tracks={g.tracks} />
          ))}
        </CardGrid>
      )}
    </div>
  );
}
