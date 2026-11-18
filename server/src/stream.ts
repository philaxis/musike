import { setTimeout as sleep } from "node:timers/promises";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";
import { invalidate, resolveStreams, type StreamFormat } from "./ytdlp.js";

const PASS_HEADERS = ["last-modified"];

/**
 * googlevideo throttles open-ended requests to about twice the bitrate (~32 KB/s for audio), which stalls playback
 * after a seek or with both decks loading; bounded ranges come at full speed. So the proxy asks in chunks this big.
 */
const CHUNK_BYTES = 2 * 1024 * 1024;

/** googlevideo answers 403 for a second or two after yt-dlp resolves a URL; keep asking for this long. */
const WARMUP_MS = 8_000;
const WARMUP_STEP_MS = 500;

/**
 * Asks googlevideo for one byte until a freshly resolved URL stops answering 403 (up to WARMUP_MS), so the track
 * starts at once when it is played. Used by `prepare`; failures are left to the stream request.
 */
export async function warmStream(fmt: StreamFormat): Promise<void> {
  const deadline = Date.now() + WARMUP_MS;
  for (;;) {
    const res = await fetch(fmt.url, { headers: { ...fmt.headers, Range: "bytes=0-0" } }).catch(() => null);
    await res?.body?.cancel();
    if (res?.ok) return;
    if (res?.status !== 403 || Date.now() + WARMUP_STEP_MS > deadline) return;
    await sleep(WARMUP_STEP_MS);
  }
}

/**
 * Proxies a googlevideo stream, forwarding Range so the browser can seek natively.
 * The browser's range is fetched upstream as consecutive bounded chunks (see CHUNK_BYTES) and sent as one body.
 * googlevideo URLs are bound to the IP that resolved them, so the bytes must flow through this server.
 */
export async function proxyStream(req: FastifyRequest, reply: FastifyReply, id: string, kind: "audio" | "video") {
  const pick = async (fresh: boolean): Promise<StreamFormat> => {
    if (fresh) invalidate(id);
    const resolved = await resolveStreams(id);
    const fmt = kind === "audio" ? resolved.audio : resolved.video;
    if (!fmt) throw new HttpError(404, msg("noSdVideo"));
    return fmt;
  };

  const controller = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });

  const asked = parseRange(req.headers.range);
  const request = async (fmt: StreamFormat, from: number, to: number | undefined) => {
    const end = Math.min(to ?? Infinity, from + CHUNK_BYTES - 1);
    const headers: Record<string, string> = { ...fmt.headers, Range: `bytes=${from}-${end}` };
    return fetch(fmt.url, { headers, signal: controller.signal });
  };

  /** Retries 403 on the same URL while it warms up, instead of resolving a new one that is just as cold. */
  const requestWarm = async (fmt: StreamFormat, from: number, to: number | undefined) => {
    const deadline = Date.now() + WARMUP_MS;
    for (;;) {
      const res = await request(fmt, from, to);
      if (res.status !== 403 || Date.now() + WARMUP_STEP_MS > deadline || controller.signal.aborted) return res;
      await res.body?.cancel();
      await sleep(WARMUP_STEP_MS);
    }
  };

  /** Warm request, resolving the URL again once if it stays rejected (expired after hours, or never opened). */
  const fetchChunk = async (from: number, to: number | undefined) => {
    let res = await requestWarm(fmt, from, to);
    if (res.status === 403 || res.status === 410) {
      await res.body?.cancel();
      fmt = await pick(true);
      res = await requestWarm(fmt, from, to);
    }
    if (res.status === 416) return res;
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new HttpError(502, msg("streamRefused", { status: res.status }), "maybe_outdated");
    }
    return res;
  };

  let fmt = await pick(false);
  const first = await fetchChunk(asked?.start ?? 0, asked?.end);
  // Asked past the end of the file.
  if (first.status === 416) {
    await first.body?.cancel();
    reply.code(416);
    const range = first.headers.get("content-range");
    if (range) reply.header("content-range", range);
    return reply.send();
  }
  const total = totalOf(first.headers.get("content-range"));

  reply.header("content-type", fmt.mime);
  reply.header("cache-control", "no-store");
  reply.header("accept-ranges", "bytes");
  for (const h of PASS_HEADERS) {
    const v = first.headers.get(h);
    if (v) reply.header(h, v);
  }

  // Upstream ignored the range (no total known): pass its answer through as it is.
  if (first.status !== 206 || total === undefined) {
    reply.code(first.status);
    const length = first.headers.get("content-length");
    if (length) reply.header("content-length", length);
    return reply.send(Readable.fromWeb(first.body as any).on("error", () => {}));
  }

  const start = asked?.start ?? 0;
  const end = Math.min(asked?.end ?? total - 1, total - 1);
  reply.code(asked ? 206 : 200);
  reply.header("content-length", String(end - start + 1));
  if (asked) reply.header("content-range", `bytes ${start}-${end}/${total}`);

  async function* chunks() {
    let res: Response = first;
    let at = start;
    for (;;) {
      const before = at;
      for await (const piece of res.body as unknown as AsyncIterable<Uint8Array>) {
        at += piece.byteLength;
        yield piece;
      }
      if (at > end) return;
      // A chunk that brought nothing would loop forever; end the body short and let the player ask again.
      if (at === before) throw new Error(`googlevideo sent no bytes at ${at}`);
      res = await fetchChunk(at, end);
    }
  }
  const body = Readable.from(chunks(), { objectMode: false });
  body.on("error", () => body.destroy());
  return reply.send(body);
}

/** `bytes=a-` or `bytes=a-b`; suffix ranges and multiple ranges are not used by media elements and fall back to the whole file. */
export function parseRange(header: string | string[] | undefined): { start: number; end?: number } | undefined {
  const m = typeof header === "string" ? /^bytes=(\d+)-(\d*)$/.exec(header.trim()) : null;
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  return end !== undefined && end < start ? undefined : { start, end };
}

function totalOf(contentRange: string | null): number | undefined {
  const m = contentRange ? /\/(\d+)$/.exec(contentRange) : null;
  return m ? Number(m[1]) : undefined;
}

/** Serves a local file with byte-range support (cached HD video, local tracks and their covers, kept audio). */
export async function serveFile(req: FastifyRequest, reply: FastifyReply, file: string, mime: string, cacheControl = "no-store") {
  const { size } = await stat(file);
  const range = typeof req.headers.range === "string" ? /bytes=(\d*)-(\d*)/.exec(req.headers.range) : null;

  reply.header("content-type", mime);
  reply.header("accept-ranges", "bytes");
  reply.header("cache-control", cacheControl);

  if (!range) {
    reply.header("content-length", size);
    return reply.send(createReadStream(file));
  }

  let start = range[1] ? Number(range[1]) : NaN;
  let end = range[2] ? Number(range[2]) : size - 1;
  if (Number.isNaN(start)) {
    // suffix range: bytes=-N
    start = Math.max(0, size - end);
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    reply.code(416).header("content-range", `bytes */${size}`);
    return reply.send();
  }

  reply.code(206);
  reply.header("content-range", `bytes ${start}-${end}/${size}`);
  reply.header("content-length", end - start + 1);
  return reply.send(createReadStream(file, { start, end }));
}
