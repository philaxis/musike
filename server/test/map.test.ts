import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import Fastify from "fastify";
import * as box from "../src/box.ts";
import { config } from "../src/config.ts";
import * as library from "../src/library.ts";
import { mapFile, registerMapRoutes } from "../src/mapRoutes.ts";
import type { Track } from "../src/types.ts";

const track = (id: string): Track => ({ id, title: id, artist: "a", duration: 60, thumb: "", art: "", kind: "song" });
const memory = () => {
  let json: string | null = null;
  return { read: async () => json, write: async (s: string) => void (json = s) };
};

const SECRET = '{"secret":"taste"}';

/** An analysis folder with a map, a file beside the map (taste.json) and one outside the analysis folder. */
async function analysis(withMap = true) {
  const dir = await mkdtemp(path.join(tmpdir(), "musike-map-"));
  const outside = path.join(dir, "outside.txt");
  await writeFile(outside, "outside");
  const root = path.join(dir, "analysis");
  await mkdir(root);
  await writeFile(path.join(root, "taste.json"), SECRET);
  if (withMap) {
    await mkdir(path.join(root, "map", "api"), { recursive: true });
    await writeFile(path.join(root, "map", "index.html"), `<!doctype html><title>map</title>${"<p>점</p>".repeat(500)}`);
    await writeFile(path.join(root, "map", "search.js"), "console.log('search')");
    await writeFile(path.join(root, "map", "vectors_e5.bin"), Buffer.from([1, 2, 3, 4]));
    await writeFile(path.join(root, "map", "api", "status.json"), JSON.stringify({ songCount: 4405, finishedAt: "2026-11-18T06:55:00+09:00" }));
    await symlink(outside, path.join(root, "map", "link.txt"));
  }
  config.analysisDir = root;
  const app = Fastify();
  registerMapRoutes(app);
  return app;
}

describe("music map files", () => {
  it("serves the page and its files", async () => {
    const app = await analysis();
    const page = await app.inject({ method: "GET", url: "/api/map/" });
    assert.equal(page.statusCode, 200);
    assert.match(page.headers["content-type"] as string, /^text\/html/);
    assert.match(page.body, /<title>map<\/title>/);
    const js = await app.inject({ method: "GET", url: "/api/map/search.js?v=1" });
    assert.equal(js.statusCode, 200);
    assert.match(js.headers["content-type"] as string, /^text\/javascript/);
    const bin = await app.inject({ method: "GET", url: "/api/map/vectors_e5.bin", headers: { "accept-encoding": "gzip" } });
    assert.equal(bin.headers["content-encoding"], undefined);
    assert.deepEqual([...bin.rawPayload], [1, 2, 3, 4]);
    const nested = await app.inject({ method: "GET", url: "/api/map/api/status.json" });
    assert.equal(nested.json().songCount, 4405);
    const bare = await app.inject({ method: "GET", url: "/api/map" });
    assert.equal(bare.statusCode, 302);
    assert.equal(bare.headers.location, "/api/map/");
  });

  it("gzips text and answers 304 to an unchanged file", async () => {
    const app = await analysis();
    const first = await app.inject({ method: "GET", url: "/api/map/index.html", headers: { "accept-encoding": "gzip, br" } });
    assert.equal(first.headers["content-encoding"], "gzip");
    assert.match(gunzipSync(first.rawPayload).toString(), /<title>map<\/title>/);
    assert.ok(first.rawPayload.length < 2000);
    const etag = first.headers.etag as string;
    assert.ok(etag);
    const again = await app.inject({ method: "GET", url: "/api/map/index.html", headers: { "if-none-match": etag } });
    assert.equal(again.statusCode, 304);
    assert.equal(again.body, "");
  });

  it("never serves anything outside the map folder", async () => {
    const app = await analysis();
    for (const url of [
      "/api/map/../taste.json",
      "/api/map/..%2ftaste.json",
      "/api/map/%2e%2e/taste.json",
      "/api/map/%2e%2e%2f%2e%2e%2foutside.txt",
      "/api/map/api/../../taste.json",
      "/api/map/..%5ctaste.json",
      "/api/map/%2fetc%2fpasswd",
      "/api/map/link.txt",
      "/api/map/index.html%00.js",
      "/api/map/%E0%A4%A",
    ]) {
      const res = await app.inject({ method: "GET", url });
      // A broken escape is turned away by the router itself (400); everything else is "not in the map".
      assert.ok(res.statusCode === 404 || res.statusCode === 400, `${url}: ${res.statusCode}`);
      assert.doesNotMatch(res.body, /secret|outside|root:/, url);
    }
    // The same, below the router: whatever it lets through, the file lookup stays inside map/.
    for (const rel of ["../taste.json", "api/../../taste.json", "/etc/passwd", "link.txt", "../../outside.txt"]) assert.equal(await mapFile(rel), null, rel);
    assert.ok(await mapFile("api/status.json"));
  });

  it("says so when the analysis has not made a map yet", async () => {
    const app = await analysis(false);
    const page = await app.inject({ method: "GET", url: "/api/map/", headers: { "x-musike-lang": "ko" } });
    assert.equal(page.statusCode, 404);
    assert.match(page.json().error, /지도가 아직 없어요/);
    const status = await app.inject({ method: "GET", url: "/api/taste/map" });
    assert.deepEqual(status.json(), { ready: false, songs: 0, generatedAt: null });
  });

  it("reports the map's song count", async () => {
    const app = await analysis();
    const status = await app.inject({ method: "GET", url: "/api/taste/map" });
    assert.deepEqual(status.json(), { ready: true, songs: 4405, generatedAt: "2026-11-18T06:55:00+09:00" });
    const missing = await app.inject({ method: "GET", url: "/api/map/nope.js" });
    assert.equal(missing.statusCode, 404);
  });

  it("gives the playable tracks of map points, in order", async () => {
    const app = await analysis();
    library.useLibraryStorage(memory());
    box.useBoxStorage(memory());
    await box.addToBox([track("vidAAAAAAAA"), track("vidBBBBBBBB"), track("vidGGGGGGGG")], { kind: "link", ref: "", name: "link", at: 1 });
    await box.markBlocked("vidGGGGGGGG", "gone");
    const res = await app.inject({ method: "POST", url: "/api/taste/map/tracks", payload: { ids: ["vidBBBBBBBB", "vidGGGGGGGG", "nope", "vidAAAAAAAA", "vidBBBBBBBB", 3] } });
    assert.deepEqual(res.json().tracks.map((t: Track) => t.id), ["vidBBBBBBBB", "vidAAAAAAAA"]);
    const empty = await app.inject({ method: "POST", url: "/api/taste/map/tracks", payload: {} });
    assert.deepEqual(empty.json(), { tracks: [] });
  });
});
