import { DownloadSimpleIcon, YoutubeLogoIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useT } from "../i18n";
import { paths } from "../lib/routes";
import { server, type PlaylistPreview } from "../lib/server";
import { useLibrary } from "../stores/library";
import { toast } from "../stores/ui";
import { Artwork } from "./Artwork";

type State = { status: "loading" } | { status: "ok"; preview: PlaylistPreview } | { status: "error"; message: string };

/** Search's top card for a pasted YouTube playlist link: import it as a playlist of the same name, then open it. */
export function ImportPlaylistCard({ url }: { url: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [importing, setImporting] = useState(false);
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: "loading" });
    server.previewPlaylist(url, ctrl.signal).then(
      (preview) => setState({ status: "ok", preview }),
      (e: Error) => e.name !== "AbortError" && setState({ status: "error", message: e.message || t.importList.failed }),
    );
    return () => ctrl.abort();
  }, [url]);

  const importIt = async () => {
    setImporting(true);
    try {
      const r = await server.importPlaylist(url);
      toast(t.importList.done(r.playlist.name, r.added, r.skipped));
      // The library's copy carries the server's annotations; fetch it rather than splice the answer in.
      await useLibrary.getState().load();
      navigate(paths.playlist(r.playlist.id));
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setImporting(false);
    }
  };

  if (state.status === "loading") return <div className="skeleton mb-4 h-[88px] rounded-[16px]" />;
  if (state.status === "error") {
    return <p className="mb-4 rounded-[16px] bg-surface-2 px-4 py-3 text-sm text-fg-2 ring-1 ring-line">{state.message}</p>;
  }

  const { preview } = state;
  return (
    <div className="mb-4 flex items-center gap-4 rounded-[16px] bg-accent-soft p-3 ring-1 ring-line">
      <Artwork src={preview.tracks[0]?.thumb} className="hidden aspect-video w-28 shrink-0 rounded-[10px] sm:block" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-accent-text">
          <YoutubeLogoIcon size={14} /> {t.importList.label}
        </span>
        <span className="mt-1 line-clamp-2 font-medium">{preview.title}</span>
      </span>
      <button
        type="button"
        disabled={importing}
        onClick={() => void importIt()}
        className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-60"
      >
        <DownloadSimpleIcon size={18} weight="bold" />
        {importing ? t.importList.importing : t.importList.action(preview.count)}
      </button>
    </div>
  );
}
