import { useEffect, useLayoutEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from "react-router";
import { AddToPlaylistDialog, DuplicatesDialog, PlaylistEditDialogs, ShortcutsDialog } from "./components/Dialogs";
import { MiniPlayer, TabBar } from "./components/MobileChrome";
import { NowPlayingSheet, PanelDrawer, SidePanel } from "./components/NowPlaying";
import { PlayerBar } from "./components/PlayerBar";
import { Rail } from "./components/Rail";
import { TitleBar } from "./components/TitleBar";
import { desktop } from "./lib/desktop";
import { SettingsDialog } from "./components/SettingsDialog";
import { Toasts } from "./components/Toasts";
import { TagsDialog, VersionsDialog } from "./components/Tags";
import { DragGhost } from "./components/TrackDrag";
import { TrackMenu } from "./components/TrackMenu";
import { TrackRecordDialog } from "./components/TrackRecord";
import { FloatingVideo, Theater } from "./components/Video";
import { MD, useMediaQuery } from "./hooks/useMediaQuery";
import { useShortcuts } from "./hooks/useShortcuts";
import { getT } from "./i18n";
import { capabilities } from "./lib/api";
import { cn } from "./lib/format";
import { legacyRedirect, NOW_PLAYING_HASH, paths } from "./lib/routes";
import { usePlayer } from "./player/player";
import { useLibrary } from "./stores/library";
import { useKeep } from "./stores/keep";
import { openSettings, useSystem } from "./stores/system";
import { toast, useUi } from "./stores/ui";
import Album from "./views/Album";
import Artist from "./views/Artist";
import BatchSearch from "./views/BatchSearch";
import Collection from "./views/Collection";
import Genre from "./views/Genre";
import Home from "./views/Home";
import Library from "./views/Library";
import LocalAlbum from "./views/LocalAlbum";
import LocalRoot from "./views/LocalRoot";
import OpenLink from "./views/OpenLink";
import Search from "./views/Search";
import SongBox from "./views/SongBox";
import Stats from "./views/Stats";
import Mixes from "./views/Mixes";
import TasteGenre from "./views/TasteGenre";
import TasteGenres from "./views/TasteGenres";
import TasteTracks from "./views/TasteTracks";

const SHEET_HASH = `#${NOW_PLAYING_HASH}`;

export default function App() {
  const location = useLocation();
  const legacy = legacyRedirect(location.pathname, location.search, location.hash);
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const isMd = useMediaQuery(MD);
  const panelOpen = useUi((s) => s.panelOpen);
  const hasTrack = usePlayer((s) => s.queue.length > 0);
  const loadLibrary = useLibrary((s) => s.load);
  const loadSystem = useSystem((s) => s.load);
  const main = useRef<HTMLElement>(null);

  useShortcuts();

  useEffect(() => {
    void loadLibrary();
    // Which YouTube tracks are kept on the server (and which are still downloading).
    if (capabilities.serverLibrary) void useKeep.getState().load();
  }, [loadLibrary]);

  // Google sign-in returns to /settings?google=connected|error (or elsewhere with ?google=): say how it went.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const google = params.get("google");
    const settings = location.pathname === paths.settings;
    if (!settings && !google) return;
    const t = getT();
    if (google === "connected") toast(t.songBox.connectedToast);
    else if (google === "error") toast(t.songBox.connectFailed(params.get("reason") ?? "?"), "error");
    if (settings) openSettings();
    params.delete("google");
    params.delete("reason");
    const rest = params.toString();
    navigate(settings ? paths.home : `${location.pathname}${rest ? `?${rest}` : ""}`, { replace: true });
  }, [location.pathname, location.search]);

  // Check yt-dlp shortly after start and say so once if something needs doing (not on Android: no yt-dlp there).
  useEffect(() => {
    if (!capabilities.engineSettings) return;
    const t = setTimeout(async () => {
      await loadSystem();
      const info = useSystem.getState().info;
      if (!info) return;
      const t = getT();
      if (!info.ytdlp.path) {
        toast(t.toasts.ytdlpMissing, "error", { label: t.common.install, run: openSettings });
        return;
      }
      const latest = info.ytdlp.latest[info.ytdlp.channel];
      if (info.ytdlp.updateAvailable && latest) {
        try {
          if (sessionStorage.getItem("musike:update-notice") === latest) return;
          sessionStorage.setItem("musike:update-notice", latest);
        } catch {
          /* private mode */
        }
        toast(t.toasts.ytdlpUpdate(latest), "info", { label: t.common.update, run: openSettings });
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [loadSystem]);

  // Where each history entry was scrolled to, so Back returns to the same spot (say, deep in a genre's artists).
  const scrollMemo = useRef(new Map<string, number>());
  const entryKey = useRef(location.key);
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const onScroll = () => scrollMemo.current.set(entryKey.current, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // New page, back to the top; Back and Forward return to where it was (the sheet hash is not a page change).
  // A layout effect, so the scroll the old page's removal causes is already filed under the new entry.
  useLayoutEffect(() => {
    entryKey.current = location.key;
    const saved = navigationType === "POP" ? scrollMemo.current.get(location.key) : undefined;
    main.current?.scrollTo({ top: 0 });
    // Pages that keep their data (genre, artist) render in full right away, so one frame is enough.
    if (saved) requestAnimationFrame(() => main.current?.scrollTo({ top: saved }));
  }, [location.pathname]);

  const sheetOpen = !isMd && location.hash === SHEET_HASH;
  const closeSheet = () => {
    // Pop the history entry the sheet pushed, so Back and the close button behave the same.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate({ hash: "" }, { replace: true });
  };

  return (
    <div className={cn("grain flex h-dvh flex-col bg-bg md:gap-2 md:p-2", desktop && "md:pt-0")}>
      {desktop && <TitleBar />}
      <div className="flex min-h-0 flex-1 md:gap-2">
        <Rail />
        <main
          ref={main}
          className={cn(
            "scroll-area relative min-w-0 flex-1 overflow-y-auto md:rounded-[20px] md:bg-surface-1 md:ring-1 md:ring-line",
            hasTrack ? "pb-[calc(152px+env(safe-area-inset-bottom))]" : "pb-[calc(88px+env(safe-area-inset-bottom))]",
            "md:pb-0",
          )}
        >
          {legacy ? (
            <Navigate to={legacy} replace />
          ) : (
            <Routes>
              <Route path={paths.home} element={<Home />} />
              <Route path={paths.search} element={<Search />} />
              <Route path={paths.searchList} element={<BatchSearch />} />
              <Route path="/search/genre/:id" element={<Genre />} />
              <Route path="/search/artist/:id" element={<Artist />} />
              <Route path="/search/album/:id" element={<Album />} />
              <Route path={paths.library} element={<Library />} />
              <Route path={paths.favorites} element={<Collection kind="favorites" />} />
              <Route path={paths.history} element={<Collection kind="history" />} />
              <Route path="/playlist/:id" element={<Collection kind="playlist" />} />
              <Route path="/library/local/:root" element={<LocalRoot />} />
              <Route path="/library/local/:root/album" element={<LocalAlbum />} />
              <Route path={paths.playLink(":id")} element={<OpenLink key="track" kind="track" />} />
              <Route path={paths.listLink(":id")} element={<OpenLink key="playlist" kind="playlist" />} />
              <Route path={paths.openFile} element={<OpenLink key="file" kind="file" />} />
              <Route path="/library/box" element={<SongBox />} />
              <Route path={paths.stats} element={<Stats />} />
              <Route path={paths.tasteGenres} element={<TasteGenres />} />
              <Route path="/library/genres/:genre" element={<TasteGenre />} />
              <Route path="/library/groups/:id" element={<TasteTracks key="group" kind="group" />} />
              <Route path={paths.mixes} element={<Mixes />} />
              <Route path="/library/mixes/:id" element={<TasteTracks key="mix" kind="mix" />} />
              <Route path="/library/radio/:id" element={<TasteTracks key="radio" kind="radio" />} />
              <Route path="*" element={<Home />} />
            </Routes>
          )}
        </main>
        {panelOpen && hasTrack && <SidePanel />}
      </div>

      {isMd ? (
        <PlayerBar />
      ) : (
        <>
          <MiniPlayer />
          <TabBar />
        </>
      )}

      <PanelDrawer />
      <NowPlayingSheet open={sheetOpen} onClose={closeSheet} />
      <FloatingVideo />
      <Theater />
      <TrackMenu />
      <AddToPlaylistDialog />
      <DuplicatesDialog />
      <PlaylistEditDialogs />
      <DragGhost />
      <ShortcutsDialog />
      <SettingsDialog />
      <TagsDialog />
      <VersionsDialog />
      <TrackRecordDialog />
      <Toasts />
    </div>
  );
}
