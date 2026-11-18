import { createReadStream } from "node:fs";
import { appendFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import type { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";

// The listening log: one line per time a track was on, in data/plays.jsonl, append-only. Every device sends its own
// lines when a track stops being the current one (or the page goes away). Stats, "on repeat", daily mixes and the
// like are read out of this file later; nothing here judges what counts as a play: each line keeps the seconds
// actually heard, so any rule (Last.fm's "half or 4 minutes") can be applied when reading.

export type PlayEnd = "finished" | "skipped" | "left";
const ENDS: Record<string, true> = { finished: true, skipped: true, left: true };
const DEVICES: Record<string, true> = { phone: true, pc: true, tv: true };

export interface Play {
  /** When the track started and stopped being the current one (ms since epoch). */
  startedAt: number;
  endedAt: number;
  id: string;
  title: string;
  artist: string;
  album?: string;
  source: "local" | "youtube";
  /** Track length and seconds actually heard (seeks don't count, pauses don't count). */
  duration: number;
  heard: number;
  /** finished: played to the end; skipped: the listener moved on; left: the page closed with it current. */
  end: PlayEnd;
  device: "phone" | "pc" | "tv";
  /** The bundle part, when a bundle row was playing. */
  part?: number;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** One event from a device, or null when it is not one. */
export function parsePlay(raw: unknown, now = Date.now()): Play | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const startedAt = num(r.startedAt);
  const endedAt = num(r.endedAt);
  const duration = num(r.duration);
  const heard = num(r.heard);
  const id = str(r.id, 200);
  if (!id || startedAt === null || endedAt === null || duration === null || heard === null) return null;
  // Clocks on phones drift; a line from the future or older than a week is a broken one.
  if (endedAt < startedAt || endedAt > now + 10 * 60_000 || startedAt < now - 7 * 86_400_000) return null;
  const end = r.end as PlayEnd;
  const part = num(r.part);
  return {
    startedAt: Math.round(startedAt),
    endedAt: Math.round(endedAt),
    id,
    title: str(r.title, 300),
    artist: str(r.artist, 200),
    ...(str(r.album, 300) ? { album: str(r.album, 300) } : {}),
    source: r.source === "local" ? "local" : "youtube",
    duration: Math.round(duration),
    heard: Math.round(Math.min(heard, (endedAt - startedAt) / 1000 + 5)),
    end: ENDS[end] ? end : "skipped",
    device: (DEVICES[r.device as string] ? r.device : "pc") as Play["device"],
    ...(part ? { part: Math.round(part) } : {}),
  };
}

export const playsFile = () => path.join(config.dataDir, "plays.jsonl");
let writing: Promise<void> = Promise.resolve();

/** Appends the events (in order; one write at a time, so lines never interleave). */
export function appendPlays(plays: Play[]): Promise<void> {
  if (!plays.length) return writing;
  const text = plays.map((p) => JSON.stringify(p)).join("\n") + "\n";
  writing = writing.then(async () => {
    await mkdir(config.dataDir, { recursive: true });
    await appendFile(playsFile(), text, "utf8");
  });
  return writing;
}

/** 「한 번 들음」(the #26 contract, Last.fm's rule): at least 30 s, and half the track or 4 minutes. */
export const isListen = (p: Pick<Play, "heard" | "duration">) => p.heard >= 30 && (p.heard >= p.duration / 2 || p.heard >= 240);

// Reading the log (stats, automatic playlists): streamed line by line, kept while the file's mtime and size stay the same.

let log: { key: string; plays: Play[] } | null = null;
let reading: { key: string; done: Promise<{ key: string; plays: Play[] }> } | null = null;

const isPlayLine = (p: Partial<Play> | null): p is Play =>
  !!p && typeof p.id === "string" && !!p.id && typeof p.startedAt === "number" && typeof p.heard === "number" && typeof p.duration === "number";

async function readLines(file: string): Promise<Play[]> {
  const plays: Play[] = [];
  const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    try {
      const p = JSON.parse(line) as Partial<Play> | null;
      if (isPlayLine(p)) plays.push(p);
    } catch {
      // a half-written last line: skip it
    }
  }
  // Devices send late when offline, so file order is not quite time order.
  return plays.sort((a, b) => a.startedAt - b.startedAt);
}

/** Every line of the log, oldest first, and a key that changes when the file does. */
export async function loadPlays(file = playsFile()): Promise<{ key: string; plays: Play[] }> {
  const st = await stat(file).catch(() => null);
  if (!st) return { key: "none", plays: [] };
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  if (log?.key === key) return log;
  if (reading?.key !== key) {
    const done = readLines(file).then((plays) => (log = { key, plays }));
    reading = { key, done };
    done.catch(() => {}).finally(() => reading?.done === done && (reading = null));
  }
  return reading.done;
}

export function registerPlayRoutes(app: FastifyInstance) {
  app.post("/api/plays", async (req) => {
    const { plays } = (req.body ?? {}) as { plays?: unknown };
    if (!Array.isArray(plays)) throw new HttpError(400, msg("playsRequired"));
    const now = Date.now();
    const ok = plays.slice(0, 200).map((p) => parsePlay(p, now)).filter((p): p is Play => !!p);
    await appendPlays(ok);
    return { saved: ok.length };
  });
}
