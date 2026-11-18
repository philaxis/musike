import { UserIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Link, useParams } from "react-router";
import { tasteGroupMenu } from "../components/menus";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { CardGrid, CardGridSkeleton, TrackCard } from "../components/TasteCards";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { paths } from "../lib/routes";
import { server } from "../lib/server";
import { groupTitle } from "../lib/taste";

/** One genre's sound groups: tracks that sound alike, each card opening its tracks. */
export default function TasteGenre() {
  const { genre = "" } = useParams();
  const t = useT();
  const page = useRemote(`taste-genre:${genre}`, (signal) => server.tasteGenre(genre, signal));
  // A genre with works (classical) can also be looked at by composer.
  const composers = useRemote(`composers:${genre}`, (signal) => server.composers(genre, signal));
  const byComposer = composers.status === "ok" && composers.data.composers.some((c) => c.works > 0);

  return (
    <div className="pb-8">
      <PageHeader title={genre} actions={<BackButton fallback={paths.tasteGenres} />} />
      {page.status === "ok" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-2 pb-5 md:px-6">
          <p className="text-sm text-fg-2">{t.taste.genreSub(page.data.count, page.data.groups.length)}</p>
          {byComposer && (
            <Link
              to={paths.composers(genre)}
              className="flex h-9 items-center gap-2 rounded-full bg-surface-3 px-4 text-sm font-medium hover:bg-surface-4"
            >
              <UserIcon size={16} />
              {t.works.byComposer}
            </Link>
          )}
        </div>
      )}

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
          {page.data.groups.map((g) => (
            <TrackCard
              key={g.id}
              to={paths.tasteGroup(g.id)}
              title={groupTitle(g, t)}
              sub={t.taste.groupSub(g.size, g.artists)}
              tracks={g.tracks}
              menu={() => tasteGroupMenu(g)}
            />
          ))}
        </CardGrid>
      )}
    </div>
  );
}
