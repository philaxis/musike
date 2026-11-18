import { MapTrifoldIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
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

type FromMap =
  | { type: "ready" | "toggle" | "next" | "prev" }
  | { type: "radio"; id: string }
  | { type: "play"; ids: string[]; start: number }
  | { type: "menu"; ids: string[]; x: number; y: number; title?: string };

/** A search result list can be long; a menu or a play takes this many at most. */
const MAX_IDS = 300;

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS) : []);

export default function MusicMap() {
  const t = useT();
  const location = useLocation();
  const status = useRemote("music-map", (signal) => server.musicMap(signal));
  const frame = useRef<HTMLIFrameElement>(null);
  const [drawn, setDrawn] = useState(false);
  // The map's own address state (`#v=<id>&g=…`) can come along in the link; read once, the frame keeps it after.
  const [src] = useState(() => {
    const hash = location.hash.slice(1);
    return `/api/map/?theme=${useUi.getState().theme}${hash && hash !== NOW_PLAYING_HASH ? `#${hash}` : ""}`;
  });
  // Track details by ID, asked once per visit (null: not playable now, say gone from YouTube or a hidden file).
  const known = useRef(new Map<string, Promise<Track | null>>());

  useEffect(() => {
    const post = (msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ musikeMap: 1, ...msg }, window.location.origin);
    const sendPlayer = () => {
      const s = usePlayer.getState();
      post({ type: "player", id: s.queue[s.index]?.id ?? null, state: s.status });
    };
    const sendTheme = () => post({ type: "theme", theme: useUi.getState().theme });
    const sendFavorites = () => post({ type: "favorites", ids: useLibrary.getState().favorites.map((x) => x.id) });

    // One request for every ID not asked yet; the answer keeps the order of `list`.
    const tracks = async (list: string[]) => {
      const missing = list.filter((id) => !known.current.has(id));
      if (missing.length) {
        const asked = server.mapTracks(missing).then((found) => new Map(found.map((x) => [x.id, x])));
        // A failed request is asked again next time.
        asked.catch(() => missing.forEach((id) => known.current.delete(id)));
        for (const id of missing) known.current.set(id, asked.then((m) => m.get(id) ?? null, () => null));
      }
      return (await Promise.all(list.map((id) => known.current.get(id)!))).filter((x): x is Track => !!x);
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
          return;
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
          return player.playList(found, Math.max(0, found.findIndex((x) => x.id === start)));
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
            if (one) openMenu({ kind: "track", track: one }, x, y);
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t.taste.map} actions={<BackButton fallback={paths.library} />} />
      {status.status === "error" && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.taste.openFailed}
          body={status.message}
          action={
            <button type="button" onClick={status.retry} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4">
              {t.common.retry}
            </button>
          }
        />
      )}
      {status.status === "ok" && !status.data.ready && (
        <EmptyState icon={<MapTrifoldIcon size={28} />} title={t.taste.mapMissing} body={t.taste.mapMissingBody} />
      )}
      {(status.status === "loading" || (status.status === "ok" && status.data.ready)) && (
        <div className="relative min-h-0 flex-1 overflow-hidden md:rounded-b-[20px]">
          {status.status === "ok" && (
            <iframe ref={frame} src={src} title={t.taste.map} className="absolute inset-0 size-full border-0" allow="fullscreen" />
          )}
          {!drawn && <div aria-hidden="true" className="skeleton absolute inset-0" />}
        </div>
      )}
    </div>
  );
}
