import { UserIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useSearchParams } from "react-router";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { CardGrid, CardGridSkeleton, TrackCard } from "../components/TasteCards";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { paths } from "../lib/routes";
import { server } from "../lib/server";

/** Composers of my tracks (of one genre with `?genre=`), most tracks first; each opens its works. */
export default function Composers() {
  const [params] = useSearchParams();
  const genre = params.get("genre") ?? undefined;
  const t = useT();
  const page = useRemote(`composers:${genre ?? ""}`, (signal) => server.composers(genre, signal));

  return (
    <div className="pb-8">
      <PageHeader
        title={genre ? t.works.composersIn(genre) : t.works.composers}
        actions={<BackButton fallback={genre ? paths.tasteGenre(genre) : paths.tasteGenres} />}
      />
      <div className="pt-2" />
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
      {page.status === "ok" &&
        (page.data.composers.length ? (
          <CardGrid>
            {page.data.composers.map((c) => (
              <TrackCard key={c.name} to={paths.composer(c.name)} title={c.name} sub={t.works.composerSub(c.count, c.works)} tracks={c.tracks} />
            ))}
          </CardGrid>
        ) : (
          <EmptyState icon={<UserIcon size={28} />} title={t.works.empty} body={t.works.emptyBody} />
        ))}
    </div>
  );
}
