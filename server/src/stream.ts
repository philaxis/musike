import { setTimeout as sleep } from "node:timers/promises";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";
import { invalidate, resolveStreams, type StreamFormat } from "./ytdlp.js";

const PASS_HEADERS = ["content-length", "content-range", "accept-ranges", "last-modified"];

/** googlevideo answers 403 for a second or two after yt-dlp resolves a URL; keep asking for this long. */
const WARMUP_MS = 8_000;
const WARMUP_STEP_MS = 500;

/**
 * Proxies a googlevideo stream, forwarding Range so the browser can seek natively.
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

  const request = async (fmt: StreamFormat) => {
    const headers: Record<string, string> = { ...fmt.headers };
    const range = req.headers.range;
    if (typeof range === "string") headers.Range = range;
    return fetch(fmt.url, { headers, signal: controller.signal });
  };

  /** Retries 403 on the same URL while it warms up, instead of resolving a new one that is just as cold. */
  const requestWarm = async (fmt: StreamFormat) => {
    const deadline = Date.now() + WARMUP_MS;
    for (;;) {
      const res = await request(fmt);
      if (res.status !== 403 || Date.now() + WARMUP_STEP_MS > deadline || controller.signal.aborted) return res;
      await res.body?.cancel();
      await sleep(WARMUP_STEP_MS);
    }
  };

  let fmt = await pick(false);
  let upstream = await requestWarm(fmt);
  // Expired or rejected URL: resolve again once.
  if (upstream.status === 403 || upstream.status === 410) {
    await upstream.body?.cancel();
    fmt = await pick(true);
    upstream = await requestWarm(fmt);
  }
  if (!upstream.ok || !upstream.body) {
    throw new HttpError(502, msg("streamRefused", { status: upstream.status }), "maybe_outdated");
  }

  reply.code(upstream.status);
  reply.header("content-type", fmt.mime);
  reply.header("cache-control", "no-store");
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) reply.header(h, v);
  }
  if (!upstream.headers.get("accept-ranges")) reply.header("accept-ranges", "bytes");

  const body = Readable.fromWeb(upstream.body as any);
  body.on("error", () => body.destroy());
  return reply.send(body);
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
