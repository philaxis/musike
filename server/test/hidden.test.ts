import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { HiddenStore, parseTarget, visibleTracks } from "../src/hidden.ts";
import { localId } from "../src/localNames.ts";
import { HttpError } from "../src/types.ts";

const ride = localId("야마시타 타츠로", "[1980.09.21] RIDE ON TIME (Lossless).mp4");
const mint = localId("카시오페아", "[1982.xx.xx] Mint Jams (320 Kbps).mp4");
const dirs: string[] = [];
const tempFile = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "musike-hidden-"));
  dirs.push(dir);
  return path.join(dir, "data", "hidden.json");
};
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

describe("hidden store", () => {
  it("hides tracks and roots, keeps them across a reload, and unhides", async () => {
    const file = await tempFile();
    const store = new HiddenStore(file);
    await store.load();
    assert.deepEqual(store.list(), { ids: [], roots: [] });

    await store.hide({ ids: [ride] });
    await store.hide({ ids: [ride], root: "카시오페아" });
    assert.ok(store.isHidden(ride, "야마시타 타츠로"));
    assert.ok(store.isHidden(mint, "카시오페아"), "a track of a hidden root is hidden");
    assert.ok(!store.isHidden(localId("야마시타 타츠로", "other.mp4"), "야마시타 타츠로"));

    // Written atomically: no temp file left behind.
    assert.deepEqual(await readdir(path.dirname(file)), ["hidden.json"]);
    const reloaded = new HiddenStore(file);
    await reloaded.load();
    assert.deepEqual(reloaded.list(), { ids: [ride], roots: ["카시오페아"] });

    assert.deepEqual(await reloaded.unhide({ ids: [ride], root: "카시오페아" }), { ids: [], roots: [] });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { ids: [], roots: [] });
  });

  it("keeps every write when several overlap", async () => {
    const file = await tempFile();
    const store = new HiddenStore(file);
    await store.load();
    await Promise.all([store.hide({ ids: [ride] }), store.hide({ ids: [mint] }), store.hide({ ids: [], root: "카시오페아" })]);
    const reloaded = new HiddenStore(file);
    await reloaded.load();
    assert.deepEqual(reloaded.list(), { ids: [ride, mint], roots: ["카시오페아"] });
  });

  it("starts empty from a broken file and drops bad entries", async () => {
    const file = await tempFile();
    const store = new HiddenStore(file);
    await store.hide({ ids: [ride] });
    await writeFile(file, "{not json", "utf8");
    await store.load();
    assert.deepEqual(store.list(), { ids: [], roots: [] });
    await writeFile(file, JSON.stringify({ ids: [ride, "../etc", 3], roots: ["", "카시오페아", null] }), "utf8");
    await store.load();
    assert.deepEqual(store.list(), { ids: [ride], roots: ["카시오페아"] });
    assert.ok(existsSync(file));
  });
});

describe("hide requests", () => {
  it("reads ids and root", () => {
    assert.deepEqual(parseTarget({ ids: [ride] }), { ids: [ride] });
    assert.deepEqual(parseTarget({ root: "카시오페아" }), { ids: [], root: "카시오페아" });
  });

  it("refuses empty or malformed bodies", () => {
    for (const bad of [undefined, {}, { ids: [] }, { ids: ["dQw4w9WgXcQ"] }, { ids: ride }, { root: "" }, { root: 3 }]) {
      assert.throws(() => parseTarget(bad), HttpError, JSON.stringify(bad));
    }
  });
});

describe("listing filter", () => {
  const tracks = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("leaves hidden tracks out by default", () => {
    const view = visibleTracks(tracks, (id) => id === "b", false);
    assert.deepEqual(view, { tracks: [{ id: "a" }, { id: "c" }], allHidden: false });
  });

  it("keeps them marked when asked", () => {
    const view = visibleTracks(tracks, (id) => id === "b", true);
    assert.deepEqual(view.tracks, [{ id: "a" }, { id: "b", hidden: true }, { id: "c" }]);
    assert.equal("hidden" in tracks[1], false, "the stored track is not changed");
  });

  it("knows when a whole album is hidden", () => {
    assert.deepEqual(visibleTracks(tracks, () => true, false), { tracks: [], allHidden: true });
    assert.equal(visibleTracks(tracks, () => true, true).allHidden, true);
    assert.equal(visibleTracks([], () => true, true).allHidden, false);
  });
});
