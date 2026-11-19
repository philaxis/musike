import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { ensureComponent } from "./bootstrap.js";
import { config } from "./config.js";
import type { Innertube } from "youtubei.js";
import { DEFAULT_CLIENTS, directAudio, fetchRemoteClients, PREMIUM_ONLY, type DirectAudio } from "./directAudio.js";
import { tools } from "./tools.js";
import { msg, type Lang, type MsgKey } from "./i18n.js";
import { HttpError, unplayableError, type Unplayable } from "./types.js";

export interface StreamFormat {
  formatId: string;
  url: string;
  headers: Record<string, string>;
  mime: string;
}

export interface Resolved {
  id: string;
  title: string;
  duration: number;
  /** Channel name; empty when only the direct fallback answered. */
  uploader?: string;
  audio: StreamFormat;
  video?: StreamFormat;
  expiresAt: number;
}

interface RawFormat {
  format_id: string;
  url?: string;
  ext: string;
  acodec?: string;
  vcodec?: string;
  height?: number;
  abr?: number;
  protocol?: string;
  http_headers?: Record<string, string>;
}

const RESOLVE_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

let maintenance: Promise<unknown> | null = null;

/** While yt-dlp is being updated or installed, new runs wait instead of racing the executable swap. */
export function holdDuring<T>(job: Promise<T>): Promise<T> {
  const p = job.finally(() => {
    if (maintenance === p) maintenance = null;
  });
  maintenance = p;
  return p;
}

export async function run(args: string[], timeoutMs: number): Promise<string> {
  if (maintenance) await maintenance.catch(() => {});
  const { ytdlp, env } = tools();
  if (!ytdlp) {
    throw new HttpError(503, msg("ytdlpMissing"), "tool_missing");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlp, [...config.ytdlpExtraArgs, ...args], { windowsHide: true, env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new HttpError(504, msg("ytdlpTimeout")));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new HttpError(503, msg("ytdlpCantRun", { error: err.message }), "tool_missing"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      reject(toHttpError(stderr));
    });
  });
}

// Failures that usually mean YouTube changed and yt-dlp needs an update.
const OUTDATED = /nsig|signature|n challenge|JavaScript runtime|Unable to extract|Failed to extract|player response|Requested format is not available|HTTP Error 403/i;

/** Audio is asked directly in English: YouTube's reasons are matched by their words (`PREMIUM_ONLY`). */
const DIRECT_LANG = "en" satisfies Lang;

/** What a person is told about a video that won't play here, by why. */
const UNPLAYABLE_TEXT = {
  region: "videoRegion",
  gone: "videoUnavailable",
  private: "videoPrivate",
  age: "ageRestricted",
  premium: "videoPremium",
} as const satisfies Record<Unplayable, MsgKey>;

export const unplayableBecause = (reason: Unplayable) => unplayableError(reason, msg(UNPLAYABLE_TEXT[reason]));

export function toHttpError(stderr: string): HttpError {
  const line = stderr.split("\n").find((l) => l.includes("ERROR")) ?? stderr.trim().split("\n").pop() ?? "";
  // Videos that won't play here whatever is tried; the app skips them (age first: its message also says "Sign in to confirm").
  if (/age-restricted|inappropriate|confirm your age/i.test(line)) return unplayableBecause("age");
  if (/confirm you.re not a bot|Sign in to confirm/i.test(line)) {
    return new HttpError(503, msg("botCheck"), "bot_check");
  }
  if (/in your country|claimed content|copyright grounds/i.test(line)) return unplayableBecause("region");
  if (/Private video/i.test(line)) return unplayableBecause("private");
  if (PREMIUM_ONLY.test(line)) return unplayableBecause("premium");
  if (/Video unavailable|video is unavailable|removed/i.test(line)) return unplayableBecause("gone");
  // yt-dlp's own words stay as they are (English); only the advice around them is translated.
  const detail = line.replace(/^ERROR:\s*/, "").slice(0, 240);
  if (!detail) return new HttpError(502, msg("ytdlpFailed"), "maybe_outdated");
  if (OUTDATED.test(stderr)) return new HttpError(502, msg("ytdlpOutdated", { detail }), "maybe_outdated");
  return new HttpError(502, detail, "maybe_outdated");
}

/** Forget resolved stream URLs, e.g. after updating yt-dlp so the next play uses the new version. */
export function clearResolved() {
  resolvedAt.clear();
  audioAt.clear();
}

const isAudioOnly = (f: RawFormat) => !!f.url && f.vcodec === "none" && !!f.acodec && f.acodec !== "none";
const isMuxed = (f: RawFormat) => !!f.url && !!f.vcodec && f.vcodec !== "none" && !!f.acodec && f.acodec !== "none";
const isHttps = (f: RawFormat) => !f.protocol || f.protocol === "https";

function toStream(f: RawFormat, kind: "audio" | "video"): StreamFormat {
  const mime = kind === "audio" ? (f.ext === "webm" ? "audio/webm" : "audio/mp4") : "video/mp4";
  return { formatId: f.format_id, url: f.url!, headers: f.http_headers ?? {}, mime };
}

function pickAudio(formats: RawFormat[]): RawFormat | undefined {
  const audio = formats.filter((f) => isAudioOnly(f) && isHttps(f));
  // AAC in MP4 plays everywhere, including iOS Safari. Opus/WebM is the fallback.
  return (
    audio.find((f) => f.format_id === "140") ??
    audio.filter((f) => f.ext === "m4a").sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0] ??
    audio.sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0]
  );
}

function pickVideo(formats: RawFormat[]): RawFormat | undefined {
  const muxed = formats.filter((f) => isMuxed(f) && isHttps(f) && f.ext === "mp4");
  return muxed.find((f) => f.format_id === "18") ?? muxed.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
}

function expiryOf(url: string): number {
  const expire = Number(new URL(url).searchParams.get("expire"));
  const fallback = Date.now() + 4 * 3600_000;
  // Refresh 10 minutes before googlevideo URLs expire.
  return Number.isFinite(expire) && expire > 0 ? expire * 1000 - 10 * 60_000 : fallback;
}

const cache = new Map<string, Promise<Resolved>>();
const resolvedAt = new Map<string, Resolved>();
/** Audio-only answers from YouTube's API asked directly (`resolveAudio`): no video, no channel. */
const audioJobs = new Map<string, Promise<Resolved>>();
const audioAt = new Map<string, Resolved>();

// When yt-dlp fails, the clients to ask YouTube directly (see directAudio.ts), refreshed from the repository.
// Read lazily: directAudio.ts and this module import each other through search.ts.
let directClients: string[] | null = null;
let directClientsAt = 0;

async function clientsForDirect(): Promise<string[]> {
  if (Date.now() - directClientsAt > 6 * 3600_000) {
    directClientsAt = Date.now();
    directClients = (await fetchRemoteClients()) ?? directClients;
  }
  return directClients ?? DEFAULT_CLIENTS;
}

const fromDirect = (id: string, direct: DirectAudio): Resolved => ({
  id,
  title: direct.title,
  duration: direct.duration,
  audio: { formatId: "direct", url: direct.url, headers: {}, mime: direct.mime },
  expiresAt: direct.expiresAt - 10 * 60_000,
});

/**
 * Plan B for audio: YouTube's bot check stops yt-dlp on some connections (VPNs, shared networks), and a YouTube
 * change can break it until it's updated. Asking YouTube for the audio directly often still works. Video stays
 * yt-dlp's job.
 */
async function resolveDirect(id: string, ytdlpError: unknown): Promise<Resolved> {
  // Removed, private or age-restricted videos won't play any other way either.
  if (ytdlpError instanceof HttpError && (ytdlpError.status === 403 || ytdlpError.status === 404)) throw ytdlpError;
  try {
    return fromDirect(id, await directAudio(id, await clientsForDirect(), DIRECT_LANG));
  } catch {
    throw ytdlpError; // yt-dlp's error says more, and may offer the update
  }
}

/**
 * A track's audio, fast: YouTube's API asked directly (one request, about a tenth of a second) before yt-dlp (a
 * process, a web page and a signature puzzle: seconds). Same AAC format as yt-dlp picks. A Premium-only answer is
 * final; any other refusal or failure goes to yt-dlp, which tells why a track won't play. Video and the channel name
 * stay `resolveStreams`'s.
 */
export function resolveAudio(id: string): Promise<Resolved> {
  const now = Date.now();
  const done = resolvedAt.get(id);
  if (done && done.expiresAt > now) return Promise.resolve(done);
  const direct = audioAt.get(id);
  if (direct && direct.expiresAt > now) return Promise.resolve(direct);
  const inflight = audioJobs.get(id) ?? cache.get(id);
  if (inflight) return inflight;

  const job = clientsForDirect()
    .then((clients) => directAudio(id, clients, DIRECT_LANG))
    .then(
      (found) => {
        const r = fromDirect(id, found);
        audioAt.set(id, r);
        return r;
      },
      (e: unknown) => {
        if (PREMIUM_ONLY.test((e as Error)?.message ?? "")) throw unplayableBecause("premium");
        return resolveStreams(id);
      },
    )
    .finally(() => audioJobs.delete(id));
  audioJobs.set(id, job);
  return job;
}

/**
 * Whether YouTube's API, asked directly on `session`, says `id` plays for Music Premium members only. False when it
 * plays (its audio address is kept for `resolveAudio`), when it won't for another reason, and when YouTube couldn't
 * be asked.
 */
export async function premiumOnly(id: string, session: Innertube): Promise<boolean> {
  try {
    audioAt.set(id, fromDirect(id, await directAudio(id, await clientsForDirect(), DIRECT_LANG, session)));
    return false;
  } catch (e) {
    return PREMIUM_ONLY.test((e as Error)?.message ?? "");
  }
}

export function resolveStreams(id: string): Promise<Resolved> {
  const done = resolvedAt.get(id);
  if (done && done.expiresAt > Date.now()) return Promise.resolve(done);
  const inflight = cache.get(id);
  if (inflight) return inflight;

  const job = run(["-J", "--no-playlist", "--no-warnings", `https://www.youtube.com/watch?v=${id}`], RESOLVE_TIMEOUT_MS)
    .then((stdout): Resolved => {
      const info = JSON.parse(stdout) as { title: string; duration?: number; uploader?: string; channel?: string; formats: RawFormat[] };
      const audio = pickAudio(info.formats);
      if (!audio) throw new HttpError(404, msg("noAudio"));
      const video = pickVideo(info.formats);
      return {
        id,
        title: info.title,
        duration: info.duration ?? 0,
        uploader: info.uploader ?? info.channel ?? "",
        audio: toStream(audio, "audio"),
        video: video ? toStream(video, "video") : undefined,
        expiresAt: expiryOf(audio.url!),
      };
    })
    .catch((err) => resolveDirect(id, err))
    .then((resolved) => {
      resolvedAt.set(id, resolved);
      return resolved;
    })
    .finally(() => cache.delete(id));

  cache.set(id, job);
  return job;
}

export function invalidate(id: string) {
  resolvedAt.delete(id);
  audioAt.delete(id);
}

const downloads = new Map<string, Promise<string>>();

/** Keeps the video cache under `config.cacheMaxBytes`, evicting least recently played files first. */
export async function pruneCache(): Promise<void> {
  if (!existsSync(config.cacheDir)) return;
  const names = (await readdir(config.cacheDir)).filter((n) => n.endsWith(".720.mp4"));
  const files = await Promise.all(
    names.map(async (n) => {
      const p = path.join(config.cacheDir, n);
      const s = await stat(p);
      return { p, size: s.size, used: s.mtimeMs };
    }),
  );
  let total = files.reduce((sum, f) => sum + f.size, 0);
  for (const f of files.sort((a, b) => a.used - b.used)) {
    if (total <= config.cacheMaxBytes) break;
    await rm(f.p, { force: true });
    total -= f.size;
  }
}

/** Downloads and merges a 720p H.264 + AAC MP4 into the cache, for HD video playback with seeking. */
export function downloadHd(id: string): Promise<string> {
  const file = path.join(config.cacheDir, `${id}.720.mp4`);
  if (existsSync(file)) {
    // Mark as recently used for cache eviction.
    const now = new Date();
    utimes(file, now, now).catch(() => {});
    return Promise.resolve(file);
  }
  const inflight = downloads.get(id);
  if (inflight) return inflight;

  const tmp = path.join(config.cacheDir, `${id}.720.part.mp4`);
  // Merging video + audio needs FFmpeg; the desktop app fetches it on first use if it isn't there yet.
  const job = (tools().ffmpeg || !config.binDir ? Promise.resolve() : ensureComponent("ffmpeg"))
    .then(() => mkdir(config.cacheDir, { recursive: true }))
    .then(() =>
      run(
        [
          "--no-playlist",
          "--no-warnings",
          "--no-part",
          "-N", "4",
          "-f", "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4][height<=720]/bv*[height<=720]+ba",
          "--merge-output-format", "mp4",
          "-o", tmp,
          `https://www.youtube.com/watch?v=${id}`,
        ],
        DOWNLOAD_TIMEOUT_MS,
      ),
    )
    .then(async () => {
      await rename(tmp, file);
      pruneCache().catch(() => {});
      return file;
    })
    .catch(async (err) => {
      await rm(tmp, { force: true });
      throw err;
    })
    .finally(() => downloads.delete(id));

  downloads.set(id, job);
  return job;
}

export async function ytdlpSearch(query: string, limit = 20) {
  const stdout = await run(["-J", "--flat-playlist", "--no-warnings", `ytsearch${limit}:${query}`], RESOLVE_TIMEOUT_MS);
  const data = JSON.parse(stdout) as {
    entries: { id: string; title: string; duration?: number; channel?: string; uploader?: string }[];
  };
  return data.entries ?? [];
}
