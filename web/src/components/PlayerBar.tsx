import { CaretDownIcon, CaretUpIcon, KeyboardIcon, QueueIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import { trackTitle } from "../lib/bundles";
import { cn } from "../lib/format";
import { XL, useMediaQuery } from "../hooks/useMediaQuery";
import { useT } from "../i18n";
import { selectCurrent, usePlayer, useStatusText } from "../player/player";
import { useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { DayLikeButton, FavoriteButton, ModeSwitch, Scrubber, Transport, Volume } from "./Controls";
import { IconButton } from "./IconButton";
import { menuTrigger } from "./menuTrigger";

/** Desktop and tablet player: a floating island under the content. */
export function PlayerBar() {
  const track = usePlayer(selectCurrent);
  const statusText = useStatusText();
  const t = useT();
  const status = usePlayer((s) => s.status);
  // ≥1280px the panel docks as a column; narrower it is a sheet over the page (components/NowPlaying.tsx).
  const docked = useMediaQuery(XL);
  const panelOpen = useUi((s) => (docked ? s.panelOpen : s.sheetOpen));
  const panelTab = useUi((s) => s.panelTab);
  const togglePanel = useUi((s) => s.togglePanel);
  const closePanel = useUi((s) => s.closePanel);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);

  return (
    <div className="island shrink-0">
      <div className="island-core grid h-[84px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-3 lg:px-4">
        <div {...menuTrigger(() => (track ? { kind: "track", track } : null))} className="flex min-w-0 items-center gap-3">
          {track ? (
            <>
              {/* Cover and title together open Now Playing. */}
              <button
                type="button"
                onClick={() => togglePanel("playing")}
                aria-label={t.player.openNowPlaying(track.title)}
                aria-expanded={panelOpen && panelTab === "playing"}
                className="group flex min-w-0 items-center gap-3 rounded-[12px] text-left"
              >
                <Artwork
                  src={track.thumb}
                  className="size-14 shrink-0 rounded-[10px] transition-transform duration-200 ease-out-expo group-active:scale-[0.96]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium group-hover:underline">{trackTitle(track)}</span>
                  <span className={cn("block truncate text-[13px]", status === "error" ? "text-danger" : "text-fg-2")}>
                    {statusText ?? track.artist}
                  </span>
                </span>
              </button>
              <FavoriteButton track={track} size="sm" />
              <DayLikeButton track={track} size="sm" />
            </>
          ) : (
            <p className="truncate pl-1 text-sm text-fg-3">{t.player.nothingPlaying}</p>
          )}
        </div>

        <div className="flex w-[min(44vw,560px)] flex-col items-center gap-1">
          <Transport />
          <Scrubber className="w-full" />
        </div>

        <div className="flex items-center justify-end gap-1">
          <ModeSwitch className="max-2xl:hidden" />
          <IconButton
            label={t.player.queue}
            size="sm"
            active={panelOpen && panelTab === "queue"}
            onClick={() => togglePanel("queue")}
          >
            <QueueIcon size={18} />
          </IconButton>
          {docked ? (
            <IconButton
              label={t.player.nowPlayingPanel}
              size="sm"
              active={panelOpen && panelTab === "playing"}
              onClick={() => togglePanel("playing")}
            >
              <SidebarSimpleIcon size={18} mirrored />
            </IconButton>
          ) : (
            // The sheet comes up from here and goes back down, whichever tab it shows.
            <IconButton
              label={t.player.nowPlayingPanel}
              size="sm"
              active={panelOpen}
              aria-expanded={panelOpen}
              onClick={() => (panelOpen ? closePanel() : togglePanel("playing"))}
            >
              {panelOpen ? <CaretDownIcon size={18} /> : <CaretUpIcon size={18} />}
            </IconButton>
          )}
          <Volume className="max-lg:hidden" />
          <IconButton label={t.player.shortcuts} size="sm" onClick={() => setShortcutsOpen(true)} className="max-xl:hidden">
            <KeyboardIcon size={18} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
