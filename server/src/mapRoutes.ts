import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { langOf, msg, tr, type Msg } from "./i18n.js";
import { lookup } from "./tasteRoutes.js";
import type { Track } from "./types.js";

// The music map (#26): the 3D map page the analysis writes to `<analysis>/map/`, served under /api/map/ so the web
// app's service worker and 404 fallback leave it alone. The 「음악 지도」 screen shows it in a same-origin iframe.

const PREFIX = "/api/map/";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
};
/** Text worth compressing: the page alone is ~6 MB with its data inline. */
const TEXT: Record<string, true> = { ".html": true, ".js": true, ".mjs": true, ".css": true, ".json": true, ".svg": true };

const mapDir = () => path.join(config.analysisDir, "map");

/** The newest gzip of each text file, while its size and mtime stay the same. */
const zipped = new Map<string, { tag: string; body: Promise<Buffer> }>();
const gzipAsync = promisify(gzip);

/**
 * The file a request points at, or null when it is outside the map folder (`..`, encoded or not, or a symlink
 * leading out) or not there. A folder means its index.html.
 */
export async function mapFile(rel: string): Promise<{ file: string; size: number; mtimeMs: number } | null> {
  if (rel.includes("\0")) return null;
  const root = mapDir();
  let file = path.resolve(root, rel);
  const inside = (p: string, r: string) => p === r || p.startsWith(r + path.sep);
  if (!inside(file, root)) return null;
  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      file = path.join(file, "index.html");
      info = await stat(file);
    }
    if (!info.isFile() || !inside(await realpath(file), await realpath(root))) return null;
    return { file, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

/** Whether the map is there, and how many songs it has (from the analysis's `map/api/status.json`). */
export async function mapStatus(): Promise<{ ready: boolean; songs: number; generatedAt: string | null }> {
  const page = await mapFile("index.html");
  if (!page) return { ready: false, songs: 0, generatedAt: null };
  try {
    const s = JSON.parse(await readFile(path.join(mapDir(), "api", "status.json"), "utf8")) as { songCount?: unknown; finishedAt?: unknown };
    return {
      ready: true,
      songs: typeof s.songCount === "number" ? s.songCount : 0,
      generatedAt: typeof s.finishedAt === "string" ? s.finishedAt : new Date(page.mtimeMs).toISOString(),
    };
  } catch {
    return { ready: true, songs: 0, generatedAt: new Date(page.mtimeMs).toISOString() };
  }
}

function notFound(req: FastifyRequest, reply: FastifyReply, text: Msg) {
  return reply.code(404).send({ error: tr(langOf(req), text) });
}

async function serve(req: FastifyRequest, reply: FastifyReply) {
  const pathname = req.url.split("?")[0]!;
  let rel: string;
  try {
    rel = decodeURIComponent(pathname.slice(PREFIX.length));
  } catch {
    return notFound(req, reply, msg("mapFileNotFound"));
  }
  const found = await mapFile(rel);
  if (!found) {
    const ready = await mapFile("index.html");
    return notFound(req, reply, msg(ready ? "mapFileNotFound" : "mapMissing"));
  }
  const ext = path.extname(found.file).toLowerCase();
  const tag = `W/"${found.size.toString(36)}-${Math.floor(found.mtimeMs).toString(36)}"`;
  reply.header("Content-Type", TYPES[ext] ?? "application/octet-stream");
  // Always ask again; an unchanged file costs a 304 only (the page and its search files are ~15 MB).
  reply.header("Cache-Control", "no-cache");
  reply.header("ETag", tag);
  reply.header("Vary", "Accept-Encoding");
  if (req.headers["if-none-match"] === tag) return reply.code(304).send();

  const accepts = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  if (!accepts || !TEXT[ext]) return reply.send(await readFile(found.file));
  let entry = zipped.get(found.file);
  if (!entry || entry.tag !== tag) {
    entry = { tag, body: readFile(found.file).then((raw) => gzipAsync(raw)) };
    zipped.set(found.file, entry);
    entry.body.catch(() => zipped.delete(found.file));
  }
  reply.header("Content-Encoding", "gzip");
  return reply.send(await entry.body);
}

const MAP_TRACKS = 500;

/** The playable tracks of map points, in order: a play or menu from the map. Unknown and gone tracks are left out. */
export async function mapTracks(ids: unknown): Promise<Track[]> {
  const list = Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === "string"))].slice(0, MAP_TRACKS) : [];
  const found = await Promise.all(list.map(lookup));
  return found.flatMap((k) => (k ? [k.track] : []));
}

export function registerMapRoutes(app: FastifyInstance) {
  app.get("/api/taste/map", () => mapStatus());
  app.post("/api/taste/map/tracks", async (req) => ({ tracks: await mapTracks(((req.body ?? {}) as { ids?: unknown }).ids) }));
  app.get("/api/map", (_req, reply) => reply.redirect(PREFIX));
  app.get(`${PREFIX}*`, serve);
}
