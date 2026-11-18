import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants as zlib, gzip } from "node:zlib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { langOf, msg, tr, type Msg } from "./i18n.js";
import { aliases } from "./ledger.js";
import { loadWorks, lookup } from "./tasteRoutes.js";
import type { Track } from "./types.js";
import { unitRows } from "./works.js";

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
/** Worth compressing: text, and the int8 search vectors (a third smaller). */
const COMPRESS: Record<string, true> = { ".html": true, ".js": true, ".mjs": true, ".css": true, ".json": true, ".svg": true, ".bin": true };
/** The analysis names its data and scripts after their content (`points.<12 hex>.json`): such a file never changes. */
const HASHED = /\.[0-9a-f]{12}\.[a-z0-9]+$/;

const mapDir = () => path.join(config.analysisDir, "map");

/**
 * The compressed copies of each file while its size and mtime stay the same: gzip right away, brotli (best level, a
 * quarter smaller than gzip but seconds for the map data) made in the background, one at a time, and used once there.
 */
type Packed = { tag: string; gzip: Promise<Buffer>; br: Buffer | null };
const packed = new Map<string, Packed>();
/** A day's map is about a dozen files; older ones fall out. */
const MAX_PACKED = 40;
const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);
let brotliQueue: Promise<unknown> = Promise.resolve();

function pack(file: string, tag: string): Packed {
  const had = packed.get(file);
  if (had?.tag === tag) return had;
  const raw = readFile(file);
  const entry: Packed = { tag, gzip: raw.then((b) => gzipAsync(b)), br: null };
  packed.delete(file);
  packed.set(file, entry);
  if (packed.size > MAX_PACKED) packed.delete(packed.keys().next().value!);
  entry.gzip.catch(() => packed.get(file) === entry && packed.delete(file));
  brotliQueue = brotliQueue
    .then(async () => {
      if (packed.get(file) !== entry) return;
      const b = await raw;
      entry.br = await brotliAsync(b, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: b.length } });
    })
    .catch(() => undefined);
  return entry;
}

/** The ETag of a file version; warm() and serve() must agree on it. */
const tagOf = (f: { size: number; mtimeMs: number }) => `W/"${f.size.toString(36)}-${Math.floor(f.mtimeMs).toString(36)}"`;

/**
 * Start compressing today's map files (the page and what `files.json` names) before they are asked for; resolves
 * once their brotli copies are made.
 */
export async function warmMap() {
  let names: string[] = [];
  try {
    const list: unknown = JSON.parse(await readFile(path.join(mapDir(), "files.json"), "utf8"));
    const files = list && typeof list === "object" && "files" in list && list.files && typeof list.files === "object" ? list.files : {};
    names = Object.values(files).filter((x): x is string => typeof x === "string");
  } catch {
    /* an older map without the list: compressed when asked */
  }
  for (const name of ["index.html", ...names]) {
    const found = await mapFile(name);
    if (found && COMPRESS[path.extname(found.file).toLowerCase()]) pack(found.file, tagOf(found));
  }
  await brotliQueue;
}

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
  // Asked when the library or the map screen opens: the map's files are compressed by the time the page wants them.
  void warmMap();
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
  const tag = tagOf(found);
  reply.header("Content-Type", TYPES[ext] ?? "application/octet-stream");
  // A content-named file is kept for good (its name changes with it); anything else is asked again and costs a 304
  // when unchanged (index.html, which names today's files).
  reply.header("Cache-Control", HASHED.test(path.basename(found.file)) ? "public, max-age=31536000, immutable" : "no-cache");
  reply.header("ETag", tag);
  reply.header("Vary", "Accept-Encoding");
  if (req.headers["if-none-match"] === tag) return reply.code(304).send();

  const accepts = String(req.headers["accept-encoding"] ?? "");
  const gz = /\bgzip\b/.test(accepts);
  const br = /\bbr\b/.test(accepts);
  if (!COMPRESS[ext] || !(gz || br)) return reply.send(await readFile(found.file));
  const entry = pack(found.file, tag);
  if (br && entry.br) {
    reply.header("Content-Encoding", "br");
    return reply.send(entry.br);
  }
  if (!gz) return reply.send(await readFile(found.file));
  reply.header("Content-Encoding", "gzip");
  return reply.send(await entry.gzip);
}

const MAP_TRACKS = 500;

/**
 * The playable tracks of map points, in order: a play or menu from the map. A replaced video's point is the video in
 * its place (the map is only redrawn by the next analysis). A movement of a performance that is one unit is its whole
 * performance, once, where its first point comes. Unknown and gone tracks are left out.
 */
export async function mapTracks(ids: unknown): Promise<Track[]> {
  const { resolve } = await aliases();
  const given = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string").map(resolve) : [];
  const list = [...new Set(given)].slice(0, MAP_TRACKS);
  const { works } = await loadWorks();
  // The analysed tracks that play are all in `works.known`; others (not analysed yet) are looked up one by one.
  const found = await Promise.all(
    list.map(async (id) => {
      const i = works.taste.index.get(id);
      if (i !== undefined) return works.known.has(id) ? unitRows(works, [i])[0] : null;
      return (await lookup(id))?.track ?? null;
    }),
  );
  const rows = found.filter((t): t is Track => !!t);
  return rows.filter((t, n) => rows.findIndex((x) => x.id === t.id) === n);
}

export function registerMapRoutes(app: FastifyInstance) {
  app.get("/api/taste/map", () => mapStatus());
  app.post("/api/taste/map/tracks", async (req) => ({ tracks: await mapTracks(((req.body ?? {}) as { ids?: unknown }).ids) }));
  app.get("/api/map", (_req, reply) => reply.redirect(PREFIX));
  app.get(`${PREFIX}*`, serve);
}
