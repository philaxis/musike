import { FolderOpenIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Artwork } from "../components/Artwork";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { server } from "../lib/server";
import { paths } from "../lib/routes";
import type { LocalAlbum } from "../lib/types";
import { useLocal } from "../stores/local";

/** One of the server's music folders: its albums by year, each a cover to open. */
export default function LocalRoot() {
  const { root = "" } = useParams();
  const t = useT();
  const generation = useLocal((s) => s.generation);
  const info = useLocal((s) => s.roots?.find((r) => r.name === root));
  const loadRoots = useLocal((s) => s.load);
  const page = useRemote<LocalAlbum[]>(`local-albums:${generation}:${root}`, (signal) => server.albums(root, signal));

  useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  const albums = page.status === "ok" ? page.data : [];

  return (
    <div className="pb-8">
      <PageHeader title={root} actions={<BackButton fallback={paths.library} />} />

      <div className="flex flex-col gap-1 px-4 pt-2 pb-5 md:px-6">
        <span className="text-xs font-medium text-fg-2">{t.local.folder}</span>
        {info && (
          <p className="font-mono text-[13px] text-fg-2">
            {info.online ? t.local.rootSub(info.albums, info.tracks) : t.local.offline}
          </p>
        )}
      </div>

      {info && !info.online && (
        <p className="mx-4 mb-5 flex items-start gap-2 rounded-[14px] bg-surface-2 p-3 text-sm text-fg-2 ring-1 ring-line md:mx-6">
          <WarningCircleIcon size={18} className="mt-0.5 shrink-0 text-danger" /> {t.local.offlineBody}
        </p>
      )}

      {page.status === "loading" && (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 md:px-6 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex flex-col gap-2">
              <span className="skeleton aspect-square w-full rounded-[14px]" />
              <span className="skeleton h-3.5 w-3/4 rounded-full" />
            </li>
          ))}
        </ul>
      )}

      {page.status === "error" && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.local.openFailed}
          body={page.message}
          action={
            <button type="button" onClick={page.retry} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4">
              {t.common.retry}
            </button>
          }
        />
      )}

      {page.status === "ok" && albums.length === 0 && (
        <EmptyState icon={<FolderOpenIcon size={28} />} title={t.local.noAlbums} body={t.local.noAlbumsBody} />
      )}

      {albums.length > 0 && (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 md:px-6 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {albums.map((a) => (
            <li key={a.key}>
              <Link to={paths.localAlbum(a.root, a.key)} state={{ name: a.name }} className="group flex flex-col gap-2">
                <span className="block overflow-hidden rounded-[14px]">
                  <Artwork
                    src={a.cover}
                    className="aspect-square w-full transition-transform duration-300 ease-out-expo group-hover:scale-[1.04]"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{a.name}</span>
                  <span className="block truncate text-xs text-fg-2">
                    {[a.year, t.common.tracks(a.trackCount), a.duration > 0 && t.time.total(a.duration)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
