import {
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  DatabaseIcon,
  HeartIcon,
  MapTrifoldIcon,
  MusicNotesIcon,
  PlusIcon,
  SparkleIcon,
  SunIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { MyAlbumTile, TILE, TileRow } from "../components/AlbumTiles";
import { Cover } from "../components/Cover";
import { NamePlaylistDialog } from "../components/Dialogs";
import { IconButton } from "../components/IconButton";
import { LocalRoots } from "../components/LocalRoots";
import { menuTrigger, NO_CALLOUT } from "../components/menuTrigger";
import { favoritesMenu, historyMenu, playlistMenu } from "../components/menus";
import { MoreLink, PageHeader, Section } from "../components/Page";
import { TrackCard } from "../components/TasteCards";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { capabilities } from "../lib/api";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import { server } from "../lib/server";
import { useLibrary } from "../stores/library";
import { useUi, type MenuTarget } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";

/** Albums per shelf; the genre's page has all of them. */
const SHELF = 12;

/** A big way in at the top: an icon, a name and a count. */
function QuickTile({ to, icon, name, sub, tint, menu }: { to: string; icon: ReactNode; name: string; sub: string; tint: string; menu?: () => MenuTarget }) {
  return (
    <Link
      to={to}
      {...(menu && menuTrigger(menu))}
      draggable={false}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-[16px] bg-surface-2 p-3 ring-1 ring-line transition-colors hover:bg-surface-3 sm:flex-row sm:items-center sm:gap-3",
        NO_CALLOUT,
      )}
    >
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-[12px]", tint)}>{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="block truncate text-xs text-fg-2">{sub}</span>
      </span>
    </Link>
  );
}

/** A small way to a place at the bottom (map, record, ☀). */
function SmallLink({ to, icon: Icon, children }: { to: string; icon: Icon; children: ReactNode }) {
  return (
    <Link to={to} className="flex h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-medium text-fg-2 ring-1 ring-line hover:text-fg">
      <Icon size={18} />
      {children}
    </Link>
  );
}

/**
 * The Library: where my music stays put (Home is what changes every day). Favorites, recently played and all songs;
 * genres; albums with 3 or more of my tracks, one shelf per genre; my own playlists; small links to the map, the
 * record and the ☀ collection.
 */
export default function Library() {
  const { favorites, playlists, createPlaylist } = useLibrary();
  const [creating, setCreating] = useState(false);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const navigate = useNavigate();
  const t = useT();
  const tv = isTvMode();
  const own = capabilities.serverLibrary;
  // Sorting, records and the map are for the phone and the computer: TV mode only plays.
  const showBox = own && !tv;
  const genres = useRemote(`taste-genres${own ? "" : ":none"}`, (signal) => (own ? server.tasteGenres(signal) : Promise.resolve({ ready: false, genres: [] })));
  const shelves = useRemote(`album-shelves${own ? "" : ":none"}`, (signal) =>
    own ? server.albumShelves({ limit: SHELF }, signal) : Promise.resolve({ ready: false, total: 0, shelves: [] }),
  );
  const [boxTotal, setBoxTotal] = useState<number | null>(null);
  useEffect(() => {
    if (!showBox) return;
    server.boxSources().then(
      (r) => setBoxTotal(r.total),
      () => setBoxTotal(null),
    );
  }, [showBox]);
  // The 3D music map, once the analysis has drawn it.
  const [map, setMap] = useState(false);
  useEffect(() => {
    if (!showBox) return;
    server.musicMap().then(
      (r) => setMap(r.ready),
      () => setMap(false),
    );
  }, [showBox]);

  return (
    <div className="pb-8">
      <PageHeader
        title={t.nav.library}
        // TV mode only plays: no making playlists or importing backups there.
        actions={
          !tv && (
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

      <div className="flex flex-col gap-9 pt-2">
        <div className={cn("grid gap-2 px-4 md:px-6", showBox ? "grid-cols-3" : "grid-cols-2", "lg:max-w-4xl")}>
          <QuickTile
            to={paths.favorites}
            icon={<HeartIcon size={22} weight="fill" />}
            tint="bg-accent text-accent-ink"
            name={t.nav.favorites}
            sub={t.common.tracks(favorites.length)}
            menu={favoritesMenu}
          />
          <QuickTile
            to={paths.history}
            icon={<ClockCounterClockwiseIcon size={22} />}
            tint="bg-surface-4 text-fg"
            name={t.nav.recentlyPlayed}
            sub={t.library.recentSub}
            menu={historyMenu}
          />
          {showBox && (
            <QuickTile
              to={paths.box()}
              icon={<MusicNotesIcon size={22} />}
              tint="bg-accent-soft text-accent-text"
              name={t.songBox.title}
              sub={boxTotal === null ? "\u00a0" : t.songBox.count(boxTotal)}
            />
          )}
        </div>

        {genres.status === "ok" && genres.data.genres.length > 0 && (
          <Section title={t.taste.genres} sub={t.library.count(genres.data.genres.length)} action={<MoreLink to={paths.tasteGenres}>{t.home.seeAll}</MoreLink>}>
            <TileRow>
              {genres.data.genres.map((g) => (
                <TrackCard key={g.genre} className={TILE} to={paths.tasteGenre(g.genre)} title={g.genre} sub={t.taste.genreSub(g.count, g.groups)} tracks={g.tracks} />
              ))}
            </TileRow>
          </Section>
        )}

        {shelves.status === "ok" && shelves.data.total > 0 && (
          <Section title={t.library.albums} sub={t.library.count(shelves.data.total)}>
            <div className="flex flex-col gap-6">
              {shelves.data.shelves.map((s) => (
                <div key={s.genre} className="flex flex-col gap-2.5">
                  <div className="flex items-end justify-between gap-4 px-4 md:px-6">
                    <h3 className="min-w-0 truncate font-semibold text-fg-2">{s.genre}</h3>
                    <MoreLink to={paths.albumShelf(s.genre)}>{t.library.count(s.count)}</MoreLink>
                  </div>
                  <TileRow>
                    {s.albums.map((a) => (
                      <MyAlbumTile key={a.key} album={a} className={TILE} />
                    ))}
                  </TileRow>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title={t.library.playlists}>
          {tv && !playlists.length ? (
            <p className="px-4 text-sm text-fg-2 md:px-6">{t.library.noPlaylists}</p>
          ) : (
            <TileRow>
              {!tv && (
                <li className={TILE}>
                  <button type="button" onClick={() => setCreating(true)} className="flex w-full flex-col gap-2 text-left">
                    <span className="grid aspect-square w-full place-items-center rounded-[14px] border border-dashed border-line-strong text-fg-2 transition-colors hover:text-fg">
                      <PlusIcon size={36} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{t.nav.newPlaylist}</span>
                      <span className="block truncate text-xs text-fg-2">{t.library.newPlaylistSub}</span>
                    </span>
                  </button>
                </li>
              )}
              {playlists.map((p) => (
                <li key={p.id} className={TILE}>
                  <Link to={paths.playlist(p.id)} {...menuTrigger(() => playlistMenu(p))} draggable={false} className={cn("group flex flex-col gap-2", NO_CALLOUT)}>
                    <span className="block overflow-hidden rounded-[14px]">
                      <Cover kind="playlist" tracks={p.tracks} className="aspect-square w-full transition-transform duration-300 ease-out-expo group-hover:scale-[1.04]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-fg-2">{t.common.tracks(p.tracks.length)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </TileRow>
          )}
        </Section>

        {own && <LocalRoots />}

        {own && (
          <div className="flex flex-wrap gap-2 px-4 md:px-6">
            {map && (
              <SmallLink to={paths.musicMap} icon={MapTrifoldIcon}>
                {t.taste.map}
              </SmallLink>
            )}
            {showBox && (
              <SmallLink to={paths.stats} icon={ChartBarIcon}>
                {t.stats.title}
              </SmallLink>
            )}
            <SmallLink to={paths.sun()} icon={SunIcon}>
              {t.sun.collection}
            </SmallLink>
            {/* TV mode keeps the classic Home, so the automatic playlists stay reachable from here. */}
            {tv && (
              <SmallLink to={paths.mixes} icon={SparkleIcon}>
                {t.taste.mixes}
              </SmallLink>
            )}
          </div>
        )}
      </div>

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
