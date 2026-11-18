import { ChartBarIcon, DatabaseIcon, PlusIcon, TrayIcon, YoutubeLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Cover, type CoverKind } from "../components/Cover";
import { menuTrigger, NO_CALLOUT } from "../components/menuTrigger";
import { favoritesMenu, historyMenu, playlistMenu } from "../components/menus";
import { NamePlaylistDialog } from "../components/Dialogs";
import { LocalRoots } from "../components/LocalRoots";
import { PageHeader } from "../components/Page";
import { useT } from "../i18n";
import { capabilities } from "../lib/api";
import { paths } from "../lib/routes";
import { server, type BoxSource } from "../lib/server";
import type { Track } from "../lib/types";
import { IconButton } from "../components/IconButton";
import { useLibrary } from "../stores/library";
import { useUi, type MenuTarget } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";

const COVER = "size-16 shrink-0 rounded-[12px] md:aspect-square md:size-auto md:w-full md:rounded-[14px] md:shadow-[0_12px_32px_rgb(0_0_0/0.3)]";

function Entry({
  to,
  name,
  kind,
  tracks,
  sub,
  menu,
}: {
  to: string;
  name: string;
  kind: CoverKind | "box" | "stats";
  tracks: Track[];
  sub: string;
  /** Right-click and long press: play, queue or edit it whole. */
  menu?: () => MenuTarget;
}) {
  return (
    <li>
      <Link
        to={to}
        {...(menu && menuTrigger(menu))}
        draggable={false}
        className={`group flex items-center gap-3 rounded-[16px] p-2 transition-colors hover:bg-surface-2 md:flex-col md:items-stretch md:gap-3 md:p-3 ${NO_CALLOUT}`}
      >
        {kind === "box" || kind === "stats" ? (
          <span
            className={`${COVER} grid place-items-center ${kind === "box" ? "bg-accent-soft text-accent-text" : "bg-surface-4 text-fg"}`}
          >
            {kind === "box" ? <TrayIcon size={26} /> : <ChartBarIcon size={26} />}
          </span>
        ) : (
          <Cover kind={kind} tracks={tracks} iconSize={26} className={COVER} />
        )}
        <span className="min-w-0">
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-sm text-fg-2">{sub}</span>
        </span>
      </Link>
    </li>
  );
}

type SourceCount = Omit<BoxSource, "at"> & { count: number };

/** Where the song box's YouTube tracks came from, each a way into the box filtered to it. Biggest first. */
function YoutubeSources({ sources }: { sources: SourceCount[] }) {
  const t = useT();
  const yt = sources.filter((s) => s.kind !== "local").sort((a, b) => b.count - a.count);
  if (!yt.length) return null;
  return (
    <section className="px-2 pt-8 md:px-4">
      <h2 className="px-2 pb-2 text-lg font-bold md:px-2">{t.songBox.fromYoutube}</h2>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 md:gap-2 lg:grid-cols-3 2xl:grid-cols-5">
        {yt.map((s) => (
          <li key={`${s.kind}:${s.ref}`}>
            <Link
              to={paths.box({ source: `${s.kind}:${s.ref}` })}
              className="flex items-center gap-3 rounded-[14px] p-2 transition-colors hover:bg-surface-2"
            >
              <span className="grid size-12 shrink-0 place-items-center rounded-[10px] bg-[#ff4e4522] text-[#ff4e45]">
                <YoutubeLogoIcon size={22} weight="fill" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{s.kind === "youtube-liked" ? t.songBox.fromLiked : s.name || t.songBox.fromLink}</span>
                <span className="block truncate text-sm text-fg-2">{t.songBox.count(s.count)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Library() {
  const { favorites, playlists, history, createPlaylist } = useLibrary();
  const [creating, setCreating] = useState(false);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const navigate = useNavigate();
  const t = useT();
  const showBox = capabilities.serverLibrary && !isTvMode();
  const [sources, setSources] = useState<SourceCount[] | null>(null);
  const [boxTotal, setBoxTotal] = useState(0);
  useEffect(() => {
    if (!showBox) return;
    server.boxSources().then(
      (r) => {
        setSources(r.sources);
        setBoxTotal(r.total);
      },
      () => setSources([]),
    );
  }, [showBox]);

  return (
    <div className="pb-8">
      <PageHeader
        title={t.nav.library}
        // TV mode only plays: no making playlists or importing backups there.
        actions={
          !isTvMode() && (
            <>
            <IconButton label={t.library.backup} onClick={() => setSettingsOpen(true)}>
              <DatabaseIcon size={20} />
            </IconButton>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex h-10 items-center gap-1.5 rounded-full bg-accent pr-4 pl-3 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97]"
            >
              <PlusIcon size={18} weight="bold" /> <span className="hidden sm:inline">{t.nav.newPlaylist}</span>
              <span className="sm:hidden">{t.library.newShort}</span>
            </button>
            </>
          )
        }
      />

      <ul className="grid grid-cols-1 gap-1 px-2 pt-2 md:grid-cols-3 md:gap-2 md:px-4 lg:grid-cols-4 2xl:grid-cols-6">
        <Entry
          to={paths.favorites}
          name={t.nav.favorites}
          kind="favorites"
          tracks={favorites}
          sub={t.common.tracks(favorites.length)}
          menu={favoritesMenu}
        />
        <Entry
          to={paths.history}
          name={t.nav.recentlyPlayed}
          kind="history"
          tracks={history}
          sub={t.common.tracks(history.length)}
          menu={historyMenu}
        />
        {/* The song box is for sorting, which TV mode leaves to the phone and Hermes. */}
        {showBox && (
          <Entry
            to={paths.box()}
            name={t.songBox.title}
            kind="box"
            tracks={[]}
            sub={boxTotal ? `${t.songBox.count(boxTotal)} · ${t.songBox.tileSub}` : t.songBox.tileSub}
          />
        )}
        {/* Stats too: TV mode only plays. */}
        {showBox && <Entry to={paths.stats} name={t.stats.title} kind="stats" tracks={[]} sub={t.stats.tileSub} />}
        {playlists.map((p) => (
          <Entry
            key={p.id}
            to={paths.playlist(p.id)}
            name={p.name}
            kind="playlist"
            tracks={p.tracks}
            sub={t.library.playlistSub(p.tracks.length)}
            menu={() => playlistMenu(p)}
          />
        ))}
      </ul>

      {playlists.length === 0 && (
        <p className="px-4 pt-6 text-sm text-fg-2 md:px-6">
          {t.library.noPlaylists}
        </p>
      )}

      {showBox && sources && <YoutubeSources sources={sources} />}

      {capabilities.serverLibrary && <LocalRoots />}

      <NamePlaylistDialog
        open={creating}
        title={t.nav.newPlaylist}
        action={t.library.create}
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          const p = await createPlaylist(name);
          setCreating(false);
          if (p) navigate(paths.playlist(p.id));
        }}
      />
    </div>
  );
}
