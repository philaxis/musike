import { DotsThreeIcon } from "@phosphor-icons/react";
import { Link } from "react-router";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import type { AlbumCard } from "../lib/types";
import { Artwork } from "./Artwork";
import { menuTrigger, NO_CALLOUT, openMenuFromButton } from "./menuTrigger";
import { youtubeAlbumMenu } from "./menus";

/** An album cover with its title; opens the album. Right-click, long press or ⋯: play, queue or save it whole. */
export function AlbumTile({ album, className }: { album: AlbumCard; className?: string }) {
  const t = useT();
  const sub = [album.artist, album.year].filter(Boolean).join(" · ");
  return (
    <div className={cn("group relative", className)}>
      <Link
        to={paths.album(album.id)}
        state={{ name: album.title }}
        {...menuTrigger(() => youtubeAlbumMenu(album))}
        draggable={false}
        className={cn("flex flex-col gap-2", NO_CALLOUT)}
      >
        <span className="block overflow-hidden rounded-[14px]">
          <Artwork
            src={album.art}
            fallback={album.thumb}
            className="aspect-square w-full transition-transform duration-300 ease-out-expo group-hover:scale-[1.04]"
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{album.title}</span>
          {sub && <span className="block truncate text-xs text-fg-2">{sub}</span>}
        </span>
      </Link>
      <button
        type="button"
        onClick={(e) => openMenuFromButton(e, youtubeAlbumMenu(album))}
        aria-label={t.basics.menuFor(album.title)}
        title={t.trackList.more}
        className="absolute top-1.5 right-1.5 grid size-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-opacity hover:bg-black/65 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 pointer-coarse:opacity-100"
      >
        <DotsThreeIcon size={20} weight="bold" />
      </button>
    </div>
  );
}

/** A titled, horizontally scrolling row of albums (an artist's albums or singles). */
export function AlbumRow({ title, albums }: { title: string; albums: AlbumCard[] }) {
  return (
    <section className="flex flex-col gap-3 pt-6">
      <h2 className="px-4 text-xl font-semibold tracking-tight md:px-6">{title}</h2>
      <ul className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 md:scroll-px-6 md:px-6">
        {albums.map((a) => (
          <li key={a.id} className="w-36 shrink-0 snap-start md:w-44">
            <AlbumTile album={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Albums as a responsive grid (search results). */
export function AlbumGrid({ albums }: { albums: AlbumCard[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-5 px-2 sm:grid-cols-3 md:px-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {albums.map((a) => (
        <li key={a.id}>
          <AlbumTile album={a} />
        </li>
      ))}
    </ul>
  );
}
