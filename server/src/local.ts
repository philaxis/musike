import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { msg } from "./i18n.js";
import { HiddenStore, visibleTracks, type HideTarget } from "./hidden.js";
import { albumFolderName, localId, mediaFiles, nameTrack, naturalCompare, parseRoots, relInRoot, stripExt, YT_ID_SUFFIX, type Tags } from "./localNames.js";
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
      rootAlbums.push({
        root: root.name,
        key,
        name: folder ? folder.title : albumEntries[0].track.title,
        ...(year ? { year } : {}),
        cover: albumEntries[0].track.thumb,
        trackCount: albumEntries.length,
        duration: albumEntries.reduce((n, e) => n + e.track.duration, 0),
        ids: albumEntries.map((e) => e.track.id),
      });
      for (const e of albumEntries) {
        nextEntries.set(e.track.id, e);
        const kept = root === keep ? YT_ID_SUFFIX.exec(stripExt(path.posix.basename(e.rel))) : null;
        if (kept) nextKept.set(kept[1], e);
      }
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

/** Scans every root (or one), one scan at a time. */
export function rescan(rootName?: string): Promise<void> {
  const run = async () => {
    let changed = false;
    for (const r of roots) if (!rootName || r.name === rootName) changed = (await scanRoot(r)) || changed;
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

/** Listings leave hidden tracks out; with `show` they keep them, marked `hidden: true`. */
function albumView(a: Album, show: boolean) {
  const tracks = a.ids.map((id) => present(entries.get(id)!));
  return visibleTracks(tracks, (id) => hidden.isHidden(id, a.root), show);
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

/** Case-insensitive match on title, artist, album or file name; no query lists everything (of one root). */
export function searchLocal(q: string, root: string | undefined, limit: number, show = false): Track[] {
  if (root) rootAlbums(root);
  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const out: Track[] = [];
  for (const e of ordered) {
    if (root && e.root.name !== root) continue;
    const isHidden = hidden.isHidden(e.track.id, e.root.name);
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
  return { track: present(e), hasVideo: !!e.probe.hasVideo };
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

/** "offset": audio is cut out of a video file on the fly and only restarts at `?t=`; "range": a plain file. */
export function audioMode(id: string): "range" | "offset" {
  return entries.get(id)?.probe.hasVideo ? "offset" : "range";
}

/** Video mode: the file as it is, with byte ranges. */
export function streamLocalVideo(req: FastifyRequest, reply: FastifyReply, id: string) {
  const e = readable(id);
  return serveFile(req, reply, e.file, VIDEO_MIME[extOf(e.file)] ?? audioMime(e.file));
}

/**
 * Audio mode. Audio files go out as they are (byte ranges). A file with video gets only its audio stream, remuxed
 * by FFmpeg without re-encoding and without touching the disk, starting at `?t=` seconds.
 */
export function streamLocalAudio(req: FastifyRequest, reply: FastifyReply, id: string) {
  const e = readable(id);
  if (!e.probe.hasVideo) return serveFile(req, reply, e.file, audioMime(e.file));
  const ffmpeg = tools().ffmpeg;
  if (!ffmpeg) throw new HttpError(503, msg("toolMissing", { tool: "FFmpeg" }), "tool_missing");

  const asked = Number((req.query as { t?: string }).t);
  const duration = e.probe.duration ?? Infinity;
  // At or past the end, send the last second so the track ends and the queue moves on (never restart from 0).
  const t = Number.isFinite(asked) && asked > 0 ? Math.max(0, Math.min(asked, duration - 1)) : 0;
  const codec = e.probe.acodec ?? "";
  const webm = codec === "opus" || codec === "vorbis";
  const copy = webm || ["aac", "mp3", "alac"].includes(codec);
  // `-ss` before the input snaps back to the video's previous keyframe (8 s apart with a still cover), so the sound
  // would start early: jump there a little before `t`, then drop the audio up to `t` exactly (cheap with stream copy).
  const lead = Math.min(t, 30);
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    ...(t > lead ? ["-ss", (t - lead).toFixed(3)] : []),
    "-i", e.file,
    ...(lead ? ["-ss", lead.toFixed(3)] : []),
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    ...(copy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "256k"]),
    // 1 s fragments: on a pipe, keyframe-only fragmenting of an audio stream makes huge fragments that decode badly.
    ...(webm ? ["-f", "webm"] : ["-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000"]),
    "pipe:1",
  ];

  reply.header("content-type", webm ? "audio/webm" : "audio/mp4");
  reply.header("cache-control", "no-store");
  if (req.method === "HEAD") return reply.send();

  const child = spawn(ffmpeg, args, { env: tools().env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  reply.raw.on("close", stop);
  child.on("error", () => child.stdout.destroy());
  return reply.send(child.stdout);
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
export async function serveCover(req: FastifyRequest, reply: FastifyReply, id: string) {
  const e = entries.get(id);
  if (!e) throw new HttpError(404, msg("localNotFound"));
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
