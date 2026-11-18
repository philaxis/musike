import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { msg, tr, type Lang, type Text } from "./i18n.js";
import { keepRootName, keptFile, keptIds, rescan } from "./local.js";
import { tools } from "./tools.js";
import { HttpError, VIDEO_ID } from "./types.js";
import { toHttpError } from "./ytdlp.js";

// "Keep on server": a YouTube track's audio (m4a, no re-encoding) saved to the keep folder, which local.ts indexes
// as the root "받아 둔 곡". A kept track then streams from that file under its same YouTube ID.

const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;
const NAME = "%(artist,uploader,channel|Unknown)s - %(title)s [%(id)s].%(ext)s";

interface Job {
  status: "downloading" | "error";
  /** 0–1 */
  progress: number;
  error?: Text;
}

const jobs = new Map<string, Job>();

function keepId(id: string): string {
  if (!VIDEO_ID.test(id)) throw new HttpError(400, msg("keepYoutubeOnly"));
  return id;
}

function download(id: string, job: Job): Promise<void> {
  const { ytdlp, env } = tools();
  if (!ytdlp) return Promise.reject(new HttpError(503, msg("ytdlpMissing"), "tool_missing"));
  const args = [
    ...config.ytdlpExtraArgs,
    "--no-playlist", "--no-warnings", "--newline",
    "-f", "140/bestaudio[ext=m4a]",
    // Auto-generated "Artist - Topic" channels are the artist's name.
    "--replace-in-metadata", "uploader,channel", " - Topic$", "",
    "--embed-metadata",
    // The cover goes next to the file ("<name>.jpg"), where local.ts looks for it.
    "--write-thumbnail", "--convert-thumbnails", "jpg",
    "--trim-filenames", "180",
    "-P", config.keepDir,
    // Intermediate files stay on the same drive, in a hidden folder the index skips.
    "-P", `temp:${path.join(config.keepDir, ".tmp")}`,
    "-o", NAME,
    "-o", `thumbnail:${NAME}`,
    "--progress-template", "download:MKP %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s",
    `https://www.youtube.com/watch?v=${id}`,
  ];
  const child = spawn(ytdlp, args, { env, windowsHide: true });
  let stderr = "";
  let buffered = "";
  const timer = setTimeout(() => child.kill(), DOWNLOAD_TIMEOUT_MS);
  child.stdout.on("data", (d: Buffer) => {
    buffered += d.toString();
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const m = /^MKP (\d+) (\d+(?:\.\d+)?)/.exec(line.trim());
      if (m && Number(m[2]) > 0) job.progress = Math.min(1, Number(m[1]) / Number(m[2]));
    }
  });
  child.stderr.on("data", (d) => (stderr += d));
  // Promise.withResolvers isn't in this project's ES2023 lib.
  return new Promise((resolve, reject) => {
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new HttpError(503, msg("ytdlpCantRun", { error: err.message }), "tool_missing"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(toHttpError(stderr));
    });
  });
}

/** Starts keeping a YouTube track (or reports that it is kept or on its way). */
export async function keep(rawId: string): Promise<{ id: string; status: "downloading" | "done" }> {
  const id = keepId(rawId);
  if (keptFile(id)) return { id, status: "done" };
  if (jobs.get(id)?.status === "downloading") return { id, status: "downloading" };
  const job: Job = { status: "downloading", progress: 0 };
  jobs.set(id, job);
  mkdir(config.keepDir, { recursive: true })
    .then(() => download(id, job))
    .then(() => rescan(keepRootName() ?? undefined))
    .then(
      () => jobs.delete(id),
      (err) => jobs.set(id, { status: "error", progress: 0, error: err instanceof HttpError ? err.text : String(err) }),
    );
  return { id, status: "downloading" };
}

/** Kept tracks ("done"), downloads in progress and failed ones. */
export function keepItems(lang: Lang) {
  const items: { id: string; status: "downloading" | "done" | "error"; progress?: number; error?: string }[] = [];
  for (const [id, job] of jobs) {
    items.push(job.status === "error" ? { id, status: "error", error: tr(lang, job.error ?? "") } : { id, status: "downloading", progress: job.progress });
  }
  for (const id of keptIds()) if (!jobs.has(id)) items.push({ id, status: "done" });
  return { items };
}

/** Deletes a kept copy (and its cover); the track streams from YouTube again. */
export async function unkeep(rawId: string): Promise<void> {
  const id = keepId(rawId);
  jobs.delete(id);
  const names = await readdir(config.keepDir).catch(() => [] as string[]);
  const mine = names.filter((n) => n.includes(`[${id}].`));
  if (!mine.length) throw new HttpError(404, msg("keepNotFound"));
  await Promise.all(mine.map((n) => rm(path.join(config.keepDir, n), { force: true })));
  await rescan(keepRootName() ?? undefined);
}
