import { VinylRecordIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useParams } from "react-router";
import { MyAlbumTile } from "../components/AlbumTiles";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { CardGrid, CardGridSkeleton } from "../components/TasteCards";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { paths } from "../lib/routes";
import { server } from "../lib/server";

/** One genre's shelf of the Library, whole: its albums of my tracks, heard lately first and then by name. */
export default function AlbumShelf() {
  const { genre = "" } = useParams();
  const t = useT();
  const page = useRemote(`album-shelf:${genre}`, (signal) => server.albumShelves({ genre }, signal));
  const shelf = page.status === "ok" ? page.data.shelves[0] : undefined;

  return (
    <div className="pb-8">
      <PageHeader title={`${t.library.albums} · ${genre}`} actions={<BackButton fallback={paths.library} />} />
      {shelf && <p className="px-4 pt-2 pb-5 text-sm text-fg-2 md:px-6">{t.library.shelfIntro(shelf.count)}</p>}

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
      {page.status === "ok" && !shelf && <EmptyState icon={<VinylRecordIcon size={28} />} title={t.library.albumsEmpty} body={t.library.albumsEmptyBody} />}
      {shelf && (
        <CardGrid>
          {shelf.albums.map((a) => (
            <MyAlbumTile key={a.key} album={a} />
          ))}
        </CardGrid>
      )}
    </div>
  );
}
