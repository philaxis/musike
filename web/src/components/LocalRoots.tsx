import { ArrowsClockwiseIcon, DotsThreeIcon, HardDrivesIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import { useLocal } from "../stores/local";
import { isTvMode } from "../tv/tvMode";
import { ShowHiddenToggle } from "./HideControls";
import { IconButton } from "./IconButton";
import { menuTrigger, NO_CALLOUT, openMenuFromButton } from "./menuTrigger";
import { localRootMenu } from "./menus";

/** Library's "My music": the server's music folders, each opening its albums. */
export function LocalRoots() {
  const { roots, status, load, rescan, showHidden, anyHidden } = useLocal();
  const [rescanning, setRescanning] = useState(false);
  const t = useT();
  // TV mode only plays: hidden items stay hidden there, with no switch and no menus.
  const tv = isTvMode();

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "error" || (roots && roots.length === 0 && !anyHidden)) return null;

  return (
    <section className="flex flex-col gap-2 pt-6">
      <div className="flex items-center justify-between gap-4 px-4 md:px-6">
        <h2 className="text-xl font-semibold tracking-tight">{t.local.title}</h2>
        {!tv && (
          <div className="flex items-center gap-1">
            {(anyHidden || showHidden) && <ShowHiddenToggle />}
            <IconButton
              label={t.local.rescan}
              disabled={rescanning}
              onClick={async () => {
                setRescanning(true);
                await rescan();
                setRescanning(false);
              }}
            >
              <ArrowsClockwiseIcon size={20} className={cn(rescanning && "animate-spin")} />
            </IconButton>
          </div>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-1 px-2 md:grid-cols-3 md:gap-2 md:px-4 lg:grid-cols-4 2xl:grid-cols-6">
        {(roots ?? []).map((r) => (
          <li key={r.name} className="relative">
            <Link
              to={paths.localRoot(r.name)}
              {...menuTrigger(() => localRootMenu(r))}
              draggable={false}
              className={cn(
                "group flex items-center gap-3 rounded-[16px] p-2 pr-12 transition-colors hover:bg-surface-2 md:p-3 md:pr-12",
                NO_CALLOUT,
                (!r.online || r.hidden) && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "grid size-14 shrink-0 place-items-center rounded-[12px]",
                  r.online ? "bg-accent-soft text-accent-text" : "bg-surface-3 text-fg-3",
                )}
              >
                {r.online ? <HardDrivesIcon size={26} /> : <WarningCircleIcon size={26} />}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block truncate text-sm text-fg-2">
                  {r.hidden && `${t.hide.badge} · `}
                  {r.online ? t.local.rootSub(r.albums, r.tracks) : t.local.offline}
                </span>
              </span>
            </Link>
            <IconButton
              label={t.basics.menuFor(r.name)}
              onClick={(e) => openMenuFromButton(e, localRootMenu(r))}
              className="absolute! top-1/2 right-2 -translate-y-1/2"
            >
              <DotsThreeIcon size={22} weight="bold" />
            </IconButton>
          </li>
        ))}
        {!roots &&
          Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 p-2 md:p-3">
              <span className="skeleton size-14 shrink-0 rounded-[12px]" />
              <span className="skeleton h-4 w-32 rounded-full" />
            </li>
          ))}
      </ul>
    </section>
  );
}
