import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { msg } from "./i18n.js";
import { HiddenStore, visibleTracks, type HideTarget } from "./hidden.js";
import { albumFolderName, localId, mediaFiles, nameTrack, naturalCompare, parseRoots, relInRoot, stripExt, YT_ID_SUFFIX, type Tags } from "./localNames.js";
import { parseSegments, segmentId, segmentTracks, SegmentStore } from "./segments.js";
import { serveFile } from "./stream.js";
import { tools } from "./tools.js";
import { HttpError, isLocalId, VIDEO_ID, type Track } from "./types.js";

// The server's music folders ("내 음악"): read-only roots indexed into data/local-index.json. Files are never copied,
// converted or written to; only the keep folder (keep.ts) receives files.

export const KEEP_ROOT = "받아 둔 곡";
const SCAN_EVERY_MS = 10 * 60_000;
const PROBE_CONCURRENCY = 4;
const PROBE_TIMEOUT_MS = 60_000;
const MAX_DEPTH = 8;

interface Probe {
  size: number;
  mtimeMs: number;
  /** ffprobe couldn't read it or it has no audio: not a track. Probed again only when the file changes. */
  bad?: true;
  duration?: number;
  /** A real video stream (an album's still cover counts), not an embedded cover picture. */
  hasVideo?: boolean;
  hasPicture?: boolean;
  acodec?: string;
  tags?: Tags;
}

interface Root {
  name: string;
  path: string;
  online: boolean;
  files: Map<string, Probe>;
}

interface Entry {
  root: Root;
  rel: string;
  file: string;
  probe: Probe;
  track: Track;
  /** A song of a split album file (segments.ts): this range of the file, whose own track is `fileId`. */
  segment?: { start: number; end: number; fileId: string };
}

export interface LocalAlbum {
  root: string;
  key: string;
  name: string;
  year?: number;
  cover: string;
  trackCount: number;
  duration: number;
  /** Only in listings asked to include hidden items: every track of it is hidden. */
  hidden?: true;
}

interface Album extends LocalAlbum {
  ids: string[];
}

let roots: Root[] = [];
let entries = new Map<string, Entry>();
let ordered: Entry[] = [];
let albums = new Map<string, Album[]>();
/** Kept YouTube copies in the keep root, by video ID ("… [<id>].m4a"). */
let keptById = new Map<string, Entry>();
/** False until an index was loaded or a first scan finished: nothing is "missing" before that. */
let ready = false;
let scanning: Promise<void> | null = null;
let timer: NodeJS.Timeout | null = null;

const indexFile = () => path.join(config.dataDir, "local-index.json");
const coverUrl = (id: string) => `/api/local/${id}/cover`;
/** Hidden tracks and roots (hidden.ts); loaded by startLocal. */
let hidden = new HiddenStore(path.join(config.dataDir, "hidden.json"));
/** Album files split into songs (segments.ts); loaded by startLocal. */
let segments = new SegmentStore(path.join(config.dataDir, "segments.json"));

/** Configured roots, plus the keep folder as "받아 둔 곡" unless it is already one of them. */
function configuredRoots(): { name: string; path: string }[] {
  const list = parseRoots(config.localDirs).map((r) => ({ name: r.name, path: path.resolve(r.path) }));
  const keep = path.resolve(config.keepDir);
  if (!list.some((r) => r.path === keep) && (list.length || existsSync(keep))) {
    list.push({ name: list.some((r) => r.name === KEEP_ROOT) ? `${KEEP_ROOT} (keep)` : KEEP_ROOT, path: keep });
  }
  return list;
}

const keepRoot = () => roots.find((r) => r.path === path.resolve(config.keepDir));

// Index file

interface IndexFile {
  version: 1;
  roots: Record<string, { path: string; files: Record<string, Probe> }>;
}

async function loadIndex() {
  let stored: IndexFile | null = null;
  try {
    stored = JSON.parse(await readFile(indexFile(), "utf8")) as IndexFile;
  } catch {
    // no index yet
  }
  roots = configuredRoots().map((r) => {
    const s = stored?.roots?.[r.name];
    const files = s && s.path === r.path ? new Map(Object.entries(s.files)) : new Map<string, Probe>();
    return { ...r, online: existsSync(r.path), files };
  });
  ready = !!stored;
  derive();
}

async function saveIndex() {
  const data: IndexFile = { version: 1, roots: {} };
  for (const r of roots) data.roots[r.name] = { path: r.path, files: Object.fromEntries(r.files) };
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${indexFile()}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, indexFile());
}

// Tracks and albums from the probed files

function derive() {
  const nextEntries = new Map<string, Entry>();
  const nextOrdered: Entry[] = [];
  const nextAlbums = new Map<string, Album[]>();
  const nextKept = new Map<string, Entry>();
  const keep = keepRoot();

  for (const root of roots) {
    const groups = new Map<string, string[]>();
    for (const [rel, probe] of root.files) {
      if (probe.bad) continue;
      const dir = path.posix.dirname(rel);
      // A file directly in the root is an album of its own.
      const key = dir === "." ? rel : dir;
      groups.set(key, [...(groups.get(key) ?? []), rel]);
    }

    const rootAlbums: Album[] = [];
    for (const [key, rels] of groups) {
      rels.sort(naturalCompare);
      const isFolder = path.posix.dirname(rels[0]) !== ".";
      const folder = isFolder ? albumFolderName(key) : null;
      const albumEntries = rels.map((rel): Entry => {
        const probe = root.files.get(rel)!;
        const id = localId(root.name, rel);
        const naming = nameTrack(root.name, rel, probe.tags ?? {});
        const album = naming.album ?? (folder && rels.length > 1 ? folder.title : undefined);
        const track: Track = {
          id,
          title: naming.title,
          artist: naming.artist,
          ...(album ? { album } : {}),
          duration: Math.round(probe.duration ?? 0),
          thumb: coverUrl(id),
          art: coverUrl(id),
          kind: probe.hasVideo ? "video" : "song",
          source: "local",
          ...(naming.year ? { year: naming.year } : {}),
        };
        return { root, rel, file: path.join(root.path, ...rel.split("/")), probe, track };
      });
      const years = albumEntries.map((e) => e.track.year).filter((y): y is number => !!y);
      const year = folder ? (folder.year ?? (years.length ? Math.min(...years) : undefined)) : albumEntries[0].track.year;
      // A split file stays a track (playlists keep it), but the album lists its songs in its place.
      const ids: string[] = [];
      for (const e of albumEntries) {
        nextEntries.set(e.track.id, e);
        const kept = root === keep ? YT_ID_SUFFIX.exec(stripExt(path.posix.basename(e.rel))) : null;
        if (kept) nextKept.set(kept[1], e);
        const songs = segments.get(root.name, e.rel);
        if (!songs) {
          ids.push(e.track.id);
          continue;
        }
        segmentTracks(e.track, root.name, e.rel, songs).forEach((track, i) => {
          nextEntries.set(track.id, { ...e, track, segment: { start: songs[i].start, end: songs[i].end, fileId: e.track.id } });
          ids.push(track.id);
        });
      }
      rootAlbums.push({
        root: root.name,
        key,
        name: folder ? folder.title : albumEntries[0].track.title,
        ...(year ? { year } : {}),
        cover: albumEntries[0].track.thumb,
        trackCount: ids.length,
        duration: ids.reduce((n, id) => n + nextEntries.get(id)!.track.duration, 0),
        ids,
      });
    }

    rootAlbums.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || naturalCompare(a.name, b.name));
    nextAlbums.set(root.name, rootAlbums);
    for (const a of rootAlbums) for (const id of a.ids) nextOrdered.push(nextEntries.get(id)!);
  }

  entries = nextEntries;
  ordered = nextOrdered;
  albums = nextAlbums;
  keptById = nextKept;
}

// Scanning

/** Media files under `base` (relative POSIX paths) with their size and modification time. */
async function walk(base: string): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const out = new Map<string, { size: number; mtimeMs: number }>();
  const visit = async (dir: string, rel: string, depth: number) => {
    const files: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      const s = e.isSymbolicLink() ? await stat(full).catch(() => null) : null;
      const isDir = s ? s.isDirectory() : e.isDirectory();
      const isFile = s ? s.isFile() : e.isFile();
      if (isDir && depth < MAX_DEPTH) {
        // An unreadable subfolder shouldn't take the whole root offline.
        await visit(full, rel ? `${rel}/${e.name}` : e.name, depth + 1).catch(() => {});
      } else if (isFile) files.push(e.name);
    }
    for (const name of mediaFiles(files)) {
      const s = await stat(path.join(dir, name)).catch(() => null);
      if (s) out.set(rel ? `${rel}/${name}` : name, { size: s.size, mtimeMs: Math.round(s.mtimeMs) });
    }
  };
  await visit(base, "", 0);
  return out;
}

function ffprobePath(): string {
  const ffmpeg = tools().ffmpeg;
  const sibling = ffmpeg && path.join(path.dirname(ffmpeg), path.basename(ffmpeg).replace(/ffmpeg/i, "ffprobe"));
  return sibling && existsSync(sibling) ? sibling : "ffprobe";
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
}

const exec = promisify(execFile);

async function probe(file: string): Promise<Omit<Probe, "size" | "mtimeMs">> {
  const args = ["-v", "error", "-show_entries", "format=duration:format_tags:stream=codec_type,codec_name:stream_disposition=attached_pic:stream_tags", "-of", "json", file];
  try {
    const { stdout } = await exec(ffprobePath(), args, { timeout: PROBE_TIMEOUT_MS, env: tools().env, maxBuffer: 4 * 1024 * 1024 });
    const j = JSON.parse(stdout) as { format?: { duration?: string; tags?: Record<string, string> }; streams?: FfprobeStream[] };
    const streams = j.streams ?? [];
    const audio = streams.find((s) => s.codec_type === "audio");
    if (!audio) return { bad: true };
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...audio.tags, ...j.format?.tags })) raw[k.toLowerCase()] = v;
    const tags: Tags = {};
    for (const k of ["title", "artist", "album_artist", "album", "date"] as const) if (raw[k]?.trim()) tags[k] = raw[k].trim().slice(0, 300);
    return {
      duration: Number(j.format?.duration) || 0,
      hasVideo: streams.some((s) => s.codec_type === "video" && !s.disposition?.attached_pic),
      hasPicture: streams.some((s) => s.codec_type === "video" && !!s.disposition?.attached_pic),
      acodec: audio.codec_name ?? "",
      tags,
    };
  } catch {
    return { bad: true };
  }
}

/** Re-reads one root: probes only new or changed files. Returns whether anything changed. */
async function scanRoot(root: Root): Promise<boolean> {
  const wasOnline = root.online;
  const st = await stat(root.path).catch(() => null);
  let found: Map<string, { size: number; mtimeMs: number }>;
  try {
    if (!st?.isDirectory()) throw new Error("offline");
    found = await walk(root.path);
  } catch {
    // Drive not mounted: show the root as offline but keep its tracks, so playlists don't lose them.
    root.online = false;
    return wasOnline;
  }
  root.online = true;
  const next = new Map<string, Probe>();
  const todo: string[] = [];
  for (const [rel, s] of found) {
    const prev = root.files.get(rel);
    if (prev && prev.size === s.size && prev.mtimeMs === s.mtimeMs) next.set(rel, prev);
    else todo.push(rel);
  }
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const rel = todo[i++];
      next.set(rel, { ...found.get(rel)!, ...(await probe(path.join(root.path, ...rel.split("/")))) });
    }
  };
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  const changed = !wasOnline || todo.length > 0 || next.size !== root.files.size;
  root.files = next;
  return changed;
}

/** Scans every root (or one), one scan at a time; segments.json is read again too (an edited or installed file). */
export function rescan(rootName?: string): Promise<void> {
  const run = async () => {
    let changed = false;
    for (const r of roots) if (!rootName || r.name === rootName) changed = (await scanRoot(r)) || changed;
    await segments.load();
    derive();
    if (changed || !ready) await saveIndex().catch(() => {});
    ready = true;
  };
  const job = (scanning ?? Promise.resolve()).then(run, run).finally(() => {
    if (scanning === job) scanning = null;
  });
  scanning = job;
  return job;
}

/** Loads the index, then scans in the background now and every 10 minutes. */
export async function startLocal() {
  hidden = new HiddenStore(path.join(config.dataDir, "hidden.json"));
  await hidden.load();
  segments = new SegmentStore(path.join(config.dataDir, "segments.json"));
  await segments.load();
  await loadIndex();
  if (!roots.length) return;
  rescan().catch(() => {});
  timer = setInterval(() => rescan().catch(() => {}), SCAN_EVERY_MS);
  timer.unref();
}

export function stopLocal() {
  clearInterval(timer ?? undefined);
  timer = null;
}

// Queries

/** A local track as the API shows it: flagged when its file is gone or its folder is offline. */
function present(e: Entry): Track {
  return e.root.online ? e.track : { ...e.track, unavailable: true };
}

export function localTrack(id: string): Track | null {
  const e = entries.get(id);
  return e ? present(e) : null;
}

/** Response-only annotations for a stored track: missing local file, or a kept YouTube copy. */
export function annotate(t: Track): Track {
  if (isLocalId(t.id)) {
    const e = entries.get(t.id);
    if (e) return e.root.online ? t : { ...t, unavailable: true };
    return ready ? { ...t, unavailable: true } : t;
  }
  return VIDEO_ID.test(t.id) && keptById.has(t.id) ? { ...t, kept: true } : t;
}

/** A song of a split file is hidden on its own or with its file (an album hidden before it was split). */
const isHiddenEntry = (e: Entry) =>
  hidden.isHidden(e.track.id, e.root.name) || (!!e.segment && hidden.isHidden(e.segment.fileId, e.root.name));

/** Listings leave hidden tracks out; with `show` they keep them, marked `hidden: true`. */
function albumView(a: Album, show: boolean) {
  const tracks = a.ids.map((id) => present(entries.get(id)!));
  return visibleTracks(tracks, (id) => isHiddenEntry(entries.get(id)!), show);
}

function albumCard(a: Album, show: boolean): LocalAlbum {
  const { ids: _ids, ...album } = a;
  const view = albumView(a, show);
  return {
    ...album,
    cover: view.tracks[0]?.thumb ?? album.cover,
    trackCount: view.tracks.length,
    duration: view.tracks.reduce((n, t) => n + t.duration, 0),
    ...(view.allHidden ? { hidden: true as const } : {}),
  };
}

export function listAlbums(root: string, show = false): LocalAlbum[] {
  return rootAlbums(root)
    .map((a) => albumCard(a, show))
    .filter((a) => a.trackCount > 0);
}

export function listRoots(show = false) {
  return roots
    .filter((r) => show || !hidden.isRootHidden(r.name))
    .map((r) => {
      const list = listAlbums(r.name, show);
      return {
        name: r.name,
        path: r.path,
        online: r.online,
        albums: list.length,
        tracks: list.reduce((n, a) => n + a.trackCount, 0),
        ...(hidden.isRootHidden(r.name) ? { hidden: true } : {}),
      };
    });
}

function rootAlbums(name: string): Album[] {
  const list = albums.get(name);
  if (!list) throw new HttpError(404, msg("localRootNotFound"));
  return list;
}

export function getAlbum(root: string, key: string, show = false) {
  const a = rootAlbums(root).find((x) => x.key === key);
  if (!a) throw new HttpError(404, msg("albumNotFound"));
  return { album: albumCard(a, show), tracks: albumView(a, show).tracks };
}

/** The album a local track is in (its shown tracks counted), or null. */
export function albumOf(id: string): LocalAlbum | null {
  const e = entries.get(id);
  const a = e && albums.get(e.root.name)?.find((x) => x.ids.includes(id));
  return a ? albumCard(a, false) : null;
}

/** Case-insensitive match on title, artist, album or file name; no query lists everything (of one root). */
export function searchLocal(q: string, root: string | undefined, limit: number, show = false): Track[] {
  if (root) rootAlbums(root);
  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const out: Track[] = [];
  for (const e of ordered) {
    if (root && e.root.name !== root) continue;
    const isHidden = isHiddenEntry(e);
    if (isHidden && !show) continue;
    if (words.length) {
      const hay = [e.track.title, e.track.artist, e.track.album ?? "", path.posix.basename(e.rel)].join("\n").toLocaleLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    out.push(isHidden ? { ...present(e), hidden: true } : present(e));
    if (out.length >= limit) break;
  }
  return out;
}

// Hiding

export const hiddenItems = () => hidden.list();

export function hide(target: HideTarget) {
  if (target.root && !roots.some((r) => r.name === target.root)) throw new HttpError(404, msg("localRootNotFound"));
  return hidden.hide(target);
}

export const unhide = (target: HideTarget) => hidden.unhide(target);

/** The kept file of a YouTube video, when its folder is readable. */
export function keptFile(id: string): string | null {
  const e = keptById.get(id);
  return e && e.root.online && existsSync(e.file) ? e.file : null;
}

export const keptTrack = (id: string): Track | null => keptById.get(id)?.track ?? null;
export const keptIds = () => [...keptById.keys()];
export const keepRootName = () => keepRoot()?.name ?? null;

/**
 * The track of a file given by its absolute path (yt-bulk's links for a just-finished download). A file inside a
 * root that the index doesn't have yet is probed and added right away instead of waiting for the next scan.
 */
export async function lookupPath(file: string): Promise<Track> {
  for (const root of roots) {
    const rel = relInRoot(root.path, file);
    if (!rel || rel.split("/").some((part) => part.startsWith("."))) continue;
    const id = localId(root.name, rel);
    const known = entries.get(id);
    if (known) {
      if (!existsSync(known.file)) break;
      return present(known);
    }
    if (!mediaFiles([path.posix.basename(rel)]).length) break;
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) break;
    const probed: Probe = { size: s.size, mtimeMs: Math.round(s.mtimeMs), ...(await probe(file)) };
    if (probed.bad) break;
    root.files.set(rel, probed);
    root.online = true;
    derive();
    await saveIndex().catch(() => {});
    const e = entries.get(id);
    if (e) return present(e);
  }
  throw new HttpError(404, msg("localNotFound"));
}

/** The file behind a local track, or why it can't be read. */
function readable(id: string): Entry {
  const e = entries.get(id);
  if (!e) throw new HttpError(404, msg("localNotFound"));
  if (!e.root.online) throw new HttpError(503, msg("localOffline"));
  if (!existsSync(e.file)) throw new HttpError(404, msg("localNotFound"));
  return e;
}

export function localInfo(id: string) {
  const e = entries.get(id);
  if (!e) throw new HttpError(404, msg("localNotFound"));
  // A song of a split file has no video mode: the file's video would run on past the song.
  return { track: present(e), hasVideo: !!e.probe.hasVideo && !e.segment };
}

// Playback

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  flac: "audio/flac",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
  mkv: "audio/x-matroska",
};
const VIDEO_MIME: Record<string, string> = { mp4: "video/mp4", mkv: "video/x-matroska", webm: "video/webm" };
const extOf = (file: string) => path.extname(file).slice(1).toLowerCase();

export const audioMime = (file: string) => AUDIO_MIME[extOf(file)] ?? "application/octet-stream";

/** "offset": audio is cut out of a file on the fly and only restarts at `?t=`; "range": a plain file. */
export function audioMode(id: string): "range" | "offset" {
  const e = entries.get(id);
  return e?.probe.hasVideo || e?.segment ? "offset" : "range";
}

/** Video mode: the file as it is, with byte ranges. */
export function streamLocalVideo(req: FastifyRequest, reply: FastifyReply, id: string) {
  const e = readable(id);
  if (e.segment) throw new HttpError(400, msg("segmentNoVideo"));
  return serveFile(req, reply, e.file, VIDEO_MIME[extOf(e.file)] ?? audioMime(e.file));
}

/**
 * Remuxed sizes by FFmpeg command. With bitexact output FFmpeg writes the same bytes every run, so a remuxed stream
 * can be measured once and then answer byte ranges like a file. Browsers need that: Firefox closes a paused download
 * and resumes it with `Range: bytes=N-`, and a stream that restarts from byte 0 makes it give up.
 */
const remuxSizes = new Map<string, Promise<number>>();
const REMUX_SIZES_MAX = 2000;

function remuxSize(ffmpeg: string, args: string[]): Promise<number> {
  const key = args.join("\u0000");
  const known = remuxSizes.get(key);
  if (known) return known;
  // Promise.withResolvers is not in this project's TypeScript lib target, so the executor form.
  const promise = new Promise<number>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { env: tools().env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 && bytes > 0 ? resolve(bytes) : reject(new HttpError(500, msg("streamFailed")))));
  });
  promise.catch(() => remuxSizes.delete(key));
  if (remuxSizes.size >= REMUX_SIZES_MAX) remuxSizes.delete(remuxSizes.keys().next().value!);
  remuxSizes.set(key, promise);
  return promise;
}

/** Bytes `start` to `start + length - 1` of a stream, then `done()` (which stops FFmpeg). */
async function* byteSlice(src: AsyncIterable<Buffer>, start: number, length: number, done: () => void) {
  let skip = start;
  let left = length;
  try {
    for await (const chunk of src) {
      let part = chunk;
      if (skip) {
        if (part.length <= skip) {
          skip -= part.length;
          continue;
        }
        part = part.subarray(skip);
        skip = 0;
      }
      if (part.length >= left) {
        yield part.subarray(0, left);
        return;
      }
      left -= part.length;
      yield part;
    }
  } finally {
    done();
  }
}

/**
 * Audio mode. Audio files go out as they are (byte ranges). A file with video, or a song of a split file, gets only
 * its audio stream, remuxed by FFmpeg without re-encoding and without touching the disk, from `?t=` seconds into
 * the track to its end. That remux also answers byte ranges (see `remuxSize`).
 */
export async function streamLocalAudio(req: FastifyRequest, reply: FastifyReply, id: string) {
  const e = readable(id);
  if (!e.probe.hasVideo && !e.segment) return serveFile(req, reply, e.file, audioMime(e.file));
  const ffmpeg = tools().ffmpeg;
  if (!ffmpeg) throw new HttpError(503, msg("toolMissing", { tool: "FFmpeg" }), "tool_missing");

  const asked = Number((req.query as { t?: string }).t);
  const from = e.segment?.start ?? 0;
  const to = Math.min(e.segment?.end ?? Infinity, e.probe.duration || Infinity);
  // At or past the end, send the last second so the track ends and the queue moves on (never restart from 0).
  const t = Number.isFinite(asked) && asked > 0 ? Math.max(0, Math.min(asked, to - from - 1)) : 0;
  const at = from + t;
  const codec = e.probe.acodec ?? "";
  const webm = codec === "opus" || codec === "vorbis";
  const copy = webm || ["aac", "mp3", "alac"].includes(codec);
  // `-ss` before the input snaps back to the video's previous keyframe (8 s apart with a still cover), so the sound
  // would start early: jump there a little before `at`, then drop the audio up to `at` exactly (cheap with stream copy).
  const lead = Math.min(at, 30);
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    ...(at > lead ? ["-ss", (at - lead).toFixed(3)] : []),
    "-i", e.file,
    ...(lead ? ["-ss", lead.toFixed(3)] : []),
    // A song of a split file stops where the next one begins.
    ...(e.segment ? ["-t", (to - at).toFixed(3)] : []),
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    ...(copy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "256k"]),
    // Same bytes on every run, so sizes and byte ranges hold.
    "-fflags", "+bitexact", "-flags:a", "+bitexact",
    // 1 s fragments: on a pipe, keyframe-only fragmenting of an audio stream makes huge fragments that decode badly.
    ...(webm ? ["-f", "webm"] : ["-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000"]),
    "pipe:1",
  ];

  const size = await remuxSize(ffmpeg, args);
  reply.header("content-type", webm ? "audio/webm" : "audio/mp4");
  reply.header("cache-control", "no-store");
  reply.header("accept-ranges", "bytes");

  const m = typeof req.headers.range === "string" ? /bytes=(\d*)-(\d*)/.exec(req.headers.range) : null;
  let start = 0;
  let end = size - 1;
  if (m) {
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), size - 1);
    } else if (m[2]) {
      start = Math.max(0, size - Number(m[2]));
    }
    if (start > end) {
      reply.code(416).header("content-range", `bytes */${size}`);
      return reply.send();
    }
    reply.code(206).header("content-range", `bytes ${start}-${end}/${size}`);
  }
  reply.header("content-length", end - start + 1);
  if (req.method === "HEAD") return reply.send();

  const child = spawn(ffmpeg, args, { env: tools().env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  reply.raw.on("close", stop);
  child.on("error", () => child.stdout.destroy());
  return reply.send(Readable.from(byteSlice(child.stdout, start, end - start + 1, stop)));
}

// Covers

const COVER_NAMES = ["folder.jpg", "cover.jpg", "poster.jpg", "front.jpg", "folder.png", "cover.png"];
const IMAGE_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const covering = new Map<string, Promise<string>>();

/** A frame of the video (5 s in) or the embedded picture, 400px wide, cached in the cache folder. */
function extractCover(e: Entry, out: string): Promise<string> {
  const inflight = covering.get(out);
  if (inflight) return inflight;
  const ffmpeg = tools().ffmpeg;
  if (!ffmpeg) return Promise.reject(new HttpError(503, msg("toolMissing", { tool: "FFmpeg" }), "tool_missing"));
  const at = Math.min(5, (e.probe.duration ?? 0) / 2);
  const tmp = `${out}.tmp.jpg`;
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    ...(e.probe.hasVideo && at > 0 ? ["-ss", at.toFixed(2)] : []),
    "-i", e.file,
    "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=400:-2", "-q:v", "4", "-y", tmp,
  ];
  const job = mkdir(path.dirname(out), { recursive: true })
    .then(() => exec(ffmpeg, args, { timeout: 30_000, env: tools().env }))
    .catch(() => {
      throw new HttpError(404, msg("noCover"));
    })
    .then(async () => {
      await rename(tmp, out);
      return out;
    })
    .catch(async (err) => {
      await rm(tmp, { force: true });
      throw err;
    })
    .finally(() => covering.delete(out));
  covering.set(out, job);
  return job;
}

/** The cover image of a local track: "<file name>.jpg" next to it, a folder image, else a frame from the video. */
export async function serveCover(req: FastifyRequest, reply: FastifyReply, id: string): Promise<unknown> {
  const e = entries.get(id);
  if (!e) throw new HttpError(404, msg("localNotFound"));
  // A song of a split file shows its album's cover.
  if (e.segment) return serveCover(req, reply, e.segment.fileId);
  const cached = path.join(config.cacheDir, "covers", `${id}.jpg`);
  let file: string | null = existsSync(cached) ? cached : null;
  if (!file && e.root.online) {
    const dir = path.dirname(e.file);
    const names = await readdir(dir).catch(() => [] as string[]);
    const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
    const base = stripExt(path.basename(e.file)).toLowerCase();
    // A folder image only describes the album when the file has a folder of its own.
    const wanted = [...["jpg", "jpeg", "png", "webp"].map((x) => `${base}.${x}`), ...(e.rel.includes("/") ? COVER_NAMES : [])];
    const hit = wanted.map((n) => byLower.get(n)).find((n): n is string => !!n);
    if (hit) file = path.join(dir, hit);
    else if (e.probe.hasVideo || e.probe.hasPicture) file = await extractCover(e, cached);
  }
  if (!file) throw new HttpError(404, msg("noCover"));
  return serveFile(req, reply, file, IMAGE_MIME[extOf(file)] ?? "image/jpeg", "public, max-age=86400");
}

// Split album files

/** The track of the file `rel` in a root. */
function fileEntry(root: string, rel: string): Entry {
  rootAlbums(root);
  const e = entries.get(localId(root, rel));
  if (!e) throw new HttpError(404, msg("localNotFound"));
  return e;
}

/** A file's songs with their track IDs (an empty list: not split), or without `rel` the split files of a root. */
export function getSegments(root: string, rel?: string) {
  if (!rel) {
    rootAlbums(root);
    return { root, files: segments.files(root) };
  }
  const e = fileEntry(root, rel);
  const songs = segments.get(root, rel) ?? [];
  return {
    root,
    path: rel,
    id: e.track.id,
    duration: e.probe.duration ?? 0,
    segments: songs.map((s) => ({ ...s, id: segmentId(root, rel, s.no) })),
  };
}

/** Replaces a file's songs (an empty list makes it whole again) and lists them at once. */
export async function setSegments(root: string, rel: string, input: unknown) {
  const e = fileEntry(root, rel);
  await segments.set(root, rel, parseSegments(input, e.probe.duration));
  derive();
  return getSegments(root, rel);
}
