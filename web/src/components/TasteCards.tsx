import { DotsThreeIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import type { Track } from "../lib/types";
import type { MenuTarget } from "../stores/ui";
import { Cover } from "./Cover";
import { IconButton } from "./IconButton";
import { menuTrigger, NO_CALLOUT, openMenuFromButton } from "./menuTrigger";

// Cards of the taste pages (genres, sound groups, automatic playlists): a cover made of the tracks, a title and a
// line under it; right-click, long press or ⋯ play or queue the whole thing.

export function CardGrid({ children }: { children: ReactNode }) {
  return <ul className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 md:px-6 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{children}</ul>;
}

export function CardGridSkeleton() {
  return (
    <CardGrid>
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="flex flex-col gap-2">
          <span className="skeleton aspect-square w-full rounded-[14px]" />
          <span className="skeleton h-3.5 w-3/4 rounded-full" />
        </li>
      ))}
    </CardGrid>
  );
}

export function TrackCard({ to, title, sub, tracks, menu }: { to: string; title: string; sub: string; tracks: Track[]; menu?: () => MenuTarget }) {
  const t = useT();
  return (
    <li className="relative">
      <Link to={to} state={{ name: title }} {...(menu && menuTrigger(menu))} draggable={false} className={cn("group flex flex-col gap-2", NO_CALLOUT)}>
        <span className="block overflow-hidden rounded-[14px]">
          <Cover kind="playlist" tracks={tracks} className="aspect-square w-full transition-transform duration-300 ease-out-expo group-hover:scale-[1.04]" />
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-sm font-semibold">{title}</span>
          <span className="line-clamp-2 text-xs text-fg-2">{sub}</span>
        </span>
      </Link>
      {menu && (
        <IconButton
          label={t.basics.menuFor(title)}
          onClick={(e) => openMenuFromButton(e, menu())}
          className="absolute! top-1.5 right-1.5 bg-black/45 text-white! backdrop-blur-sm hover:bg-black/65!"
        >
          <DotsThreeIcon size={22} weight="bold" />
        </IconButton>
      )}
    </li>
  );
}
