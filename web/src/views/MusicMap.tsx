import { CircleNotchIcon, MapTrifoldIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { workRowMenu } from "../components/menus";
import { openMenu } from "../components/menuTrigger";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { useRemote } from "../hooks/useRemote";
import { getT, useT } from "../i18n";
import { NOW_PLAYING_HASH, paths } from "../lib/routes";
import { server } from "../lib/server";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { toast, useUi } from "../stores/ui";

// The taste analysis's 3D music map (#26). Its page (served at /api/map/) runs in a same-origin frame; playing,
// queueing and playlists stay Musike's own. The map sends track IDs, Musike answers with what is playing, the theme
// and the ♥ tracks. Messages are `{ musikeMap: 1, type, … }` (see analysis/musike_analysis/web/player.js).
// Once opened, the screen stays alive while the app runs (App mounts it beside the routes): leaving hides it and the
// map stops drawing, coming back shows it as it was, with nothing to load again.

type FromMap =
  | { type: "ready" | "failed" | "toggle" | "next" | "prev" }
  | { type: "radio"; id: string }
  | { type: "play"; ids: string[]; start: number }
  | { type: "menu"; ids: string[]; x: number; y: number; title?: string };

/** A search result list can be long; a menu or a play takes this many at most. */
const MAX_IDS = 300;

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS) : []);

/** The map screen from its first visit on; hidden, not unmounted, while another screen shows. */
export default function KeptMusicMap() {
  const active = useLocation().pathname === paths.musicMap;
  const [opened, setOpened] = useState(active);
  if (active && !opened) setOpened(true);
  return opened ? <MusicMap active={active} /> : null;
}

function MusicMap({ active }: { active: boolean }) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const status = useRemote("music-map", (signal) => server.musicMap(signal));
  const frame = useRef<HTMLIFrameElement>(null);
  // Until the map has drawn its first frame: a light loading cover. `failed`: its data did not load.
  const [drawn, setDrawn] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The map's own address state (`#v=<id>&g=…`) can come along in the link; read once, the frame keeps it after.
  const [src] = useState(() => {
    const hash = location.hash.slice(1);
    return `/api/map/?theme=${useUi.getState().theme}${hash && hash !== NOW_PLAYING_HASH ? `#${hash}` : ""}`;
  });
  // Track details by ID, asked once per visit (null: not playable now, say gone from YouTube or a hidden file).
  const known = useRef(new Map<string, Promise<Track | null>>());

  // Shown or hidden: the map draws only while shown. Coming back by a link with a map address (`#v=<id>`) goes there.
  // Only on showing and hiding: the hash also changes for the now-playing sheet.
  const shown = useRef(active);
  useEffect(() => {
    const before = shown.current;
    shown.current = active;
    const win = frame.current?.contentWindow;
    if (!win || before === active) return;
    win.postMessage({ musikeMap: 1, type: "visible", on: active }, window.location.origin);
    const hash = location.hash.slice(1);
    if (active && hash && hash !== NOW_PLAYING_HASH && win.location.hash.slice(1) !== hash) {
      // A full address: a relative one would resolve against this page, not the frame's.
      const url = new URL(win.location.href);
      url.hash = hash;
      win.location.replace(url.href);
    }
  }, [active, location.hash]);

  useEffect(() => {
    const post = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ musikeMap: 1, ...msg }, window.location.origin);
    const sendPlayer = () => {
      const s = usePlayer.getState();
      post({ type: "player", id: s.queue[s.index]?.id ?? null, state: s.status });
    };
    const sendTheme = () => post({ type: "theme", theme: useUi.getState().theme });
    const sendFavorites = () => post({ type: "favorites", ids: useLibrary.getState().favorites.map((x) => x.id) });

    // One request for every ID not asked yet; the answer keeps the order of `list`. A movement of a performance that
    // is one unit comes back as its performance's row (once, where its first point is).
    const tracks = async (list: string[]) => {
      const missing = list.filter((id) => !known.current.has(id));
      if (missing.length) {
        const asked = server
          .mapTracks(missing)
          .then((found) => new Map(found.flatMap((x) => [x, ...(x.work?.parts ?? [])].map((p): [string, Track] => [p.id, x]))));
        // A failed request is asked again next time.
        asked.catch(() => missing.forEach((id) => known.current.delete(id)));
        for (const id of missing) known.current.set(id, asked.then((m) => m.get(id) ?? null, () => null));
      }
      const found = (await Promise.all(list.map((id) => known.current.get(id)!))).filter((x): x is Track => !!x);
      return found.filter((x, n) => found.indexOf(x) === n);
    };

    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || e.origin !== window.location.origin) return;
      const d = e.data as (FromMap & { musikeMap?: number }) | null;
      if (!d || d.musikeMap !== 1) return;
      const player = usePlayer.getState();
      switch (d.type) {
        case "ready":
          setDrawn(true);
          sendTheme();
          sendFavorites();
          sendPlayer();
          // Left before it was drawn: it waits hidden.
          if (!shown.current) post({ type: "visible", on: false });
          return;
        case "failed":
          return setFailed(true);
        case "toggle":
          return player.toggle();
        case "next":
          return player.next();
        case "prev":
          return player.prev();
        case "radio": {
          const [one] = typeof d.id === "string" ? await tracks([d.id]) : [];
          if (one) return void player.startRadio(one);
          return toast(getT().taste.openFailed, "error");
        }
        case "play": {
          const list = ids(d.ids);
          const start = list[Math.max(0, Math.min(list.length - 1, Number(d.start) || 0))];
          const found = await tracks(list);
          if (!found.length) return toast(getT().taste.openFailed, "error");
          return player.playList(found, Math.max(0, found.findIndex((x) => x.id === start || !!x.work?.parts?.some((p) => p.id === start))));
        }
        case "menu": {
          const list = ids(d.ids);
          if (!list.length) return;
          // The frame's own coordinates, moved to the page's.
          const box = frame.current!.getBoundingClientRect();
          const x = box.left + (Number(d.x) || 0);
          const y = box.top + (Number(d.y) || 0);
          if (list.length === 1) {
            const [one] = await tracks(list);
            if (one) openMenu(one.work?.parts ? workRowMenu(one, (to) => navigate(to)) : { kind: "track", track: one }, x, y);
            else toast(getT().taste.openFailed, "error");
            return;
          }
          const tt = getT();
          openMenu(
            { kind: "group", title: (typeof d.title === "string" && d.title) || tt.taste.map, sub: tt.common.tracks(list.length), load: () => tracks(list) },
            x,
            y,
          );
        }
      }
    };

    addEventListener("message", onMessage);
    const stops = [
      usePlayer.subscribe((s, prev) => {
        if (s.status !== prev.status || s.queue[s.index]?.id !== prev.queue[prev.index]?.id) sendPlayer();
      }),
      useUi.subscribe((s, prev) => {
        if (s.theme !== prev.theme) sendTheme();
      }),
      useLibrary.subscribe((s, prev) => {
        if (s.favorites !== prev.favorites) sendFavorites();
      }),
    ];
    return () => {
      removeEventListener("message", onMessage);
      for (const stop of stops) stop();
    };
  }, []);

  const retry = () => {
    setFailed(false);
    setDrawn(false);
    setAttempt((n) => n + 1);
  };

  return (
    <div
      className={active ? "flex h-full flex-col" : "invisible absolute inset-0 flex flex-col"}
      inert={!active}
      aria-hidden={!active || undefined}
    >
      <PageHeader title={t.taste.map} actions={<BackButton fallback={paths.library} />} />
      {(status.status === "error" || failed) && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.taste.openFailed}
          body={status.status === "error" ? status.message : t.taste.mapLoadFailed}
          action={
            <button type="button" onClick={failed ? retry : status.retry} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4">
              {t.common.retry}
            </button>
          }
        />
      )}
      {status.status === "ok" && !status.data.ready && (
        <EmptyState icon={<MapTrifoldIcon size={28} />} title={t.taste.mapMissing} body={t.taste.mapMissingBody} />
      )}
      {(status.status === "loading" || (status.status === "ok" && status.data.ready)) && !failed && (
        <div className="relative min-h-0 flex-1 overflow-hidden md:rounded-b-[20px]">
          {status.status === "ok" && (
            <iframe key={attempt} ref={frame} src={src} title={t.taste.map} className="absolute inset-0 size-full border-0" allow="fullscreen" />
          )}
          {!drawn && (
            <div className="skeleton absolute inset-0 grid place-items-center">
              <span role="status" className="flex items-center gap-2 rounded-full bg-surface-1/90 px-4 py-2 text-sm text-fg-2 ring-1 ring-line">
                <CircleNotchIcon size={16} className="animate-spin" />
                {t.taste.mapLoading}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
