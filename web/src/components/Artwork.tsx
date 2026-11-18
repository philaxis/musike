import { MusicNotesIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { cn } from "../lib/format";

interface Props {
  src?: string;
  /** Used when `src` fails, e.g. hq720 thumbnails that do not exist for older videos. */
  fallback?: string;
  alt?: string;
  className?: string;
  iconSize?: number;
}

/** Big YouTube thumbnail sizes that older videos lack. */
const YT_BIG = /^(https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\/)(hq720|maxresdefault|sddefault)\.jpg/;

/** For a missing size YouTube sends a 120×90 grey "no thumbnail" picture with HTTP 404, which browsers still show. */
function isYoutubePlaceholder(img: HTMLImageElement): boolean {
  return img.naturalWidth === 120 && img.naturalHeight === 90 && img.src.includes("i.ytimg.com/");
}

/** What to try after `current` failed: the given fallback, else the always-present mqdefault of a big YouTube size. */
function nextSource(current: string | undefined, fallback: string | undefined): string | undefined {
  if (fallback && current !== fallback) return fallback;
  const big = current ? YT_BIG.exec(current) : null;
  return big ? `${big[1]}mqdefault.jpg` : undefined;
}

export function Artwork(props: Props) {
  // Keyed by source so a new image starts from a clean loading state, without a reset effect
  // (an effect could run after a cached image already fired onLoad and leave it stuck invisible).
  return <ArtworkImage key={`${props.src ?? ""}|${props.fallback ?? ""}`} {...props} />;
}

function ArtworkImage({ src, fallback, alt = "", className, iconSize = 20 }: Props) {
  const [current, setCurrent] = useState(src || fallback);
  const [state, setState] = useState<"loading" | "ok" | "error">(src || fallback ? "loading" : "error");

  const fail = () => {
    const next = nextSource(current, fallback);
    if (next) setCurrent(next);
    else setState("error");
  };

  // Images served from cache can be complete before React attaches onLoad.
  const imgRef = (img: HTMLImageElement | null) => {
    if (!img?.complete || img.naturalWidth === 0) return;
    if (isYoutubePlaceholder(img)) fail();
    else setState("ok");
  };

  return (
    <div className={cn("relative shrink-0 overflow-hidden bg-surface-3", className)}>
      {state !== "error" && current && (
        <img
          ref={imgRef}
          src={current}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={(e) => (isYoutubePlaceholder(e.currentTarget) ? fail() : setState("ok"))}
          onError={fail}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300 ease-out-expo",
            state === "ok" ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      {state === "loading" && <div className="skeleton absolute inset-0" />}
      {state === "error" && (
        <div className="absolute inset-0 grid place-items-center text-fg-3">
          <MusicNotesIcon size={iconSize} />
        </div>
      )}
    </div>
  );
}
