import { createHash } from "node:crypto";
import path from "node:path";

// Pure rules for the server's music folders (local.ts): which files are tracks, their IDs and their names.

/** Files with these extensions become tracks. */
export const MEDIA_EXT: Record<string, true> = { mp4: true, m4a: true, mkv: true, webm: true, mp3: true, flac: true, opus: true, ogg: true, wav: true };
export const stripExt = (name: string) => name.slice(0, name.length - path.extname(name).length);

/** "L" + 20 base64url characters of sha256("<root name>/<path inside the root>"): stable while the file stays put. */
export function localId(root: string, rel: string): string {
  return "L" + createHash("sha256").update(`${root}/${rel}`).digest("base64url").slice(0, 20);
}

export interface RootSpec {
  name: string;
  path: string;
}

/** `MUSIKE_LOCAL_DIRS`: `name=path;name=path`. Entries without a name or path are ignored; the first of a name wins. */
export function parseRoots(spec: string): RootSpec[] {
  const out: RootSpec[] = [];
  for (const part of spec.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const dir = part.slice(eq + 1).trim();
    if (!name || !dir || out.some((r) => r.name === name)) continue;
    out.push({ name, path: dir });
  }
  return out;
}

/** The POSIX path of `file` inside `root`, or null when it is outside it (".." escapes, other drives, the root itself). */
export function relInRoot(root: string, file: string): string | null {
  if (!path.isAbsolute(file)) return null;
  const rel = path.relative(path.resolve(root), path.resolve(file));
  if (!rel || path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`)) return null;
  return rel.split(path.sep).join("/");
}

/** yt-dlp's per-format pieces: "<name>.f251.webm" next to the merged "<name>.webm". */
const PARTIAL = /^(.*)\.f\d+\.[A-Za-z0-9]+$/;

/**
 * The names in one folder that are tracks: media extensions only, no hidden or temporary files, and no yt-dlp
 * partial streams when their merged file is there too.
 */
export function mediaFiles(names: string[]): string[] {
  const media = names.filter(
    (n) => !n.startsWith(".") && Object.hasOwn(MEDIA_EXT, path.extname(n).slice(1).toLowerCase()) && !/\.(temp|part)\.[^.]+$/i.test(n),
  );
  const merged = new Set(media.filter((n) => !PARTIAL.test(n)).map(stripExt));
  return media.filter((n) => {
    const m = PARTIAL.exec(n);
    return !m || !merged.has(m[1]);
  });
}

const DATE_PREFIX = /^\s*\[(\d{4})(?:[.\-/](?:\d{1,2}|xx))?(?:[.\-/](?:\d{1,2}|xx))?\]\s*/i;
/** yt-bulk folders and files: "2026-11-13 Title [VIDEO_ID]". */
const ISO_PREFIX = /^(\d{4})-\d{2}-\d{2}\s+/;
export const YT_ID_SUFFIX = /\s*\[([A-Za-z0-9_-]{11})\]$/;
const QUALITY =
  /\s*[(\[]\s*(?:lossless|\d{2,4}\s*kbps|vbr|cbr|v0|v2|mp3(?:\s+(?:v\d|\d{2,4}))?|flac(?:\s+[^)\]]*)?|aac|alac|hi-?res|\d{2}[- ]?bit[^)\]]*)\s*[)\]]/gi;

export interface ParsedName {
  title: string;
  year?: number;
}

/** A folder or file name (no extension) without its leading date, quality markers and trailing YouTube ID. */
export function cleanName(name: string): ParsedName {
  let s = name.trim();
  let year: number | undefined;
  const date = DATE_PREFIX.exec(s) ?? ISO_PREFIX.exec(s);
  if (date) {
    year = Number(date[1]);
    s = s.slice(date[0].length);
  }
  s = s
    .replace(YT_ID_SUFFIX, "")
    .replace(QUALITY, "")
    .replace(/_audiosr$/i, " (AudioSR)")
    .replace(/\s+/g, " ")
    .replace(/[\s\-–]+$/, "")
    .trim();
  return { title: s || name.trim(), ...(year ? { year } : {}) };
}

/** A media file name: "[1980.09.21] RIDE ON TIME (Lossless).mp4" → "RIDE ON TIME", 1980. */
export const parseFileName = (file: string) => cleanName(stripExt(file));

/** Year from a tag such as "1980", "1980-09-21" or "19800921". */
export function tagYear(date: string | undefined): number | undefined {
  const m = /^\s*(\d{4})/.exec(date ?? "");
  const y = m ? Number(m[1]) : NaN;
  return y > 1000 && y < 3000 ? y : undefined;
}

export interface Tags {
  title?: string;
  artist?: string;
  album_artist?: string;
  album?: string;
  date?: string;
}

export interface Naming {
  title: string;
  artist: string;
  album?: string;
  year?: number;
}

/**
 * Title: tag, else the cleaned file name. Artist: tag, else the channel folder of a yt-bulk archive
 * (<channel>/<date title [ID]>/<file>), else the root's name. Album: tag only (folders are grouped by local.ts).
 * Year: the file name's leading date, else the date tag.
 */
export function nameTrack(rootName: string, rel: string, tags: Tags): Naming {
  const parts = rel.split("/");
  const file = parts[parts.length - 1];
  const parsed = parseFileName(file);
  const dirs = parts.slice(0, -1);
  const channel = dirs.length >= 2 && YT_ID_SUFFIX.test(dirs[dirs.length - 1]) ? dirs[0] : undefined;
  const year = parsed.year ?? tagYear(tags.date) ?? (dirs.length ? cleanName(dirs[dirs.length - 1]).year : undefined);
  return {
    title: tags.title?.trim() || parsed.title,
    artist: tags.artist?.trim() || tags.album_artist?.trim() || channel || rootName,
    ...(tags.album?.trim() ? { album: tags.album.trim() } : {}),
    ...(year ? { year } : {}),
  };
}

/** Natural order for names with numbers ("Disc 2" before "Disc 10"). */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, "ko", { numeric: true, sensitivity: "base" });
