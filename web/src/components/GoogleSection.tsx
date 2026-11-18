import { ArrowsClockwiseIcon, DownloadSimpleIcon, LinkBreakIcon, YoutubeLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useT } from "../i18n";
import { ApiError } from "../lib/apiTypes";
import { paths } from "../lib/routes";
import { server, type BoxSource, type GooglePlaylist, type GoogleStatus } from "../lib/server";
import { toast, useUi } from "../stores/ui";
import { Check } from "./Selection";

/**
 * Settings 「유튜브 계정」: connect the YouTube account (read-only), choose which of its playlists the daily sync brings
 * into the song box, bring them in now, or disconnect. Sign-in leaves the app and returns to /settings?google=….
 */
export function GoogleSection() {
  const t = useT();
  const navigate = useNavigate();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [lists, setLists] = useState<GooglePlaylist[] | "error" | null>(null);
  const [syncing, setSyncing] = useState(false);

  /** Google ended the connection (409 google_login): show the reconnect state; anything else as a toast. */
  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.code === "google_login") {
      setStatus((s) => ({ connected: false, reason: "revoked", email: s?.email }));
      setLists(null);
      return true;
    }
    return false;
  };

  useEffect(() => {
    let live = true;
    server.googleStatus().then(
      (s) => {
        if (!live) return;
        setStatus(s);
        if (!s.connected) return;
        server.googlePlaylists().then(
          (p) => live && setLists(p),
          (e) => live && !failed(e) && setLists("error"),
        );
      },
      () => live && setStatus({ connected: false, reason: "not_connected" }),
    );
    return () => {
      live = false;
    };
  }, []);

  const toggle = (id: string) => {
    if (!Array.isArray(lists)) return;
    const before = lists;
    const next = lists.map((p) => (p.id === id ? { ...p, excluded: !p.excluded } : p));
    setLists(next);
    server.setGoogleExcluded(next.filter((p) => p.excluded).map((p) => p.id)).catch((e: Error) => {
      setLists(before);
      toast(e.message, "error");
    });
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await server.googleSync();
      toast(
        t.songBox.synced(r.added.length),
        "info",
        r.added.length
          ? {
              label: t.songBox.openBox,
              run: () => {
                useUi.getState().setSettingsOpen(false);
                navigate(paths.box({ filter: "untagged" }));
              },
            }
          : undefined,
      );
    } catch (e) {
      if (!failed(e)) toast((e as Error).message, "error");
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    try {
      await server.googleDisconnect();
      setStatus({ connected: false, reason: "not_connected" });
      setLists(null);
      toast(t.songBox.disconnected);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const connectLink = (label: string) => (
    <a
      href="/api/google/login"
      className="flex h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.98]"
    >
      <YoutubeLogoIcon size={18} weight="fill" /> {label}
    </a>
  );

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-fg-3">{t.songBox.google}</h3>
      <div className="flex flex-col gap-3 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
        {!status ? (
          <div className="skeleton h-5 w-48 rounded-full" />
        ) : status.connected ? (
          <>
            <p className="flex items-center gap-2 font-medium">
              <YoutubeLogoIcon size={20} weight="fill" className="shrink-0 text-accent-text" />
              <span className="truncate">{status.email ? t.songBox.connectedAs(status.email) : t.songBox.connected}</span>
            </p>
            <p className="text-sm text-fg-2">{t.songBox.googleBody}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={syncing}
                onClick={() => void syncNow()}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {syncing ? <ArrowsClockwiseIcon size={18} className="animate-spin" /> : <DownloadSimpleIcon size={18} weight="bold" />}
                {syncing ? t.songBox.syncing : t.songBox.syncNow}
              </button>
              <button
                type="button"
                onClick={() => void disconnect()}
                className="flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium text-fg-2 ring-1 ring-line hover:text-fg"
              >
                <LinkBreakIcon size={18} /> {t.songBox.disconnect}
              </button>
            </div>
          </>
        ) : status.reason === "no_client" ? (
          <p className="text-sm text-fg-2">{t.songBox.noClient}</p>
        ) : status.reason === "revoked" ? (
          <>
            <p className="text-sm font-medium text-danger">{t.songBox.revoked}</p>
            {connectLink(t.songBox.reconnect)}
          </>
        ) : (
          <>
            <p className="text-sm text-fg-2">{t.songBox.googleBody}</p>
            {connectLink(t.songBox.connect)}
          </>
        )}
      </div>

      {status?.connected && (
        <div className="flex flex-col gap-1 pt-1">
          <h3 className="text-xs font-medium text-fg-3">{t.songBox.myPlaylists}</h3>
          <p className="text-xs text-fg-3">{t.songBox.playlistsHint}</p>
          {lists === "error" ? (
            <p className="text-sm text-danger">{t.songBox.playlistsFailed}</p>
          ) : !lists ? (
            <div className="skeleton h-12 rounded-xl" />
          ) : (
            <ul className="flex flex-col">
              {lists.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={!p.excluded}
                    onClick={() => toggle(p.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-3"
                  >
                    <Check on={!p.excluded} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.title}</span>
                      <span className="block text-xs text-fg-2">{t.songBox.playlistSub(p.count, p.privacy === "private")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <YoutubeSources />
    </section>
  );
}

type SourceCount = Omit<BoxSource, "at"> & { count: number };

/**
 * 「유튜브에서 들여온 곡」: the YouTube playlists, likes and pasted links that brought tracks into 「모든 곡」, biggest
 * first; each opens 「모든 곡」 filtered to it.
 */
function YoutubeSources() {
  const t = useT();
  const navigate = useNavigate();
  const [sources, setSources] = useState<SourceCount[]>([]);
  useEffect(() => {
    server.boxSources().then(
      (r) => setSources(r.sources.filter((s) => s.kind !== "local").sort((a, b) => b.count - a.count)),
      () => setSources([]),
    );
  }, []);
  if (!sources.length) return null;
  return (
    <div className="flex flex-col gap-1 pt-3">
      <h3 className="text-xs font-medium text-fg-3">{t.songBox.fromYoutube}</h3>
      <p className="text-xs text-fg-3">{t.songBox.fromYoutubeHint}</p>
      <ul className="flex flex-col">
        {sources.map((s) => (
          <li key={`${s.kind}:${s.ref}`}>
            <button
              type="button"
              onClick={() => {
                useUi.getState().setSettingsOpen(false);
                navigate(paths.box({ source: `${s.kind}:${s.ref}` }));
              }}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-3"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#ff4e4522] text-[#ff4e45]">
                <YoutubeLogoIcon size={18} weight="fill" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.kind === "youtube-liked" ? t.songBox.fromLiked : s.name || t.songBox.fromLink}</span>
                <span className="block text-xs text-fg-2">{t.songBox.count(s.count)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
