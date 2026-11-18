import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as box from "../src/box.ts";
import { checkState, isoDuration, itemGone, signState, syncTargets } from "../src/google.ts";
import * as library from "../src/library.ts";
import { BUNDLE_ID, TRACK_ID, type Track } from "../src/types.ts";

const track = (id: string, title = id): Track => ({ id, title, artist: "a", duration: 60, thumb: "", art: "", kind: "song" });
const vid = (n: number) => `vid${String(n).padStart(8, "0")}`;
const memory = () => {
  let json: string | null = null;
  return { read: async () => json, write: async (s: string) => void (json = s) };
};
const src = (kind: box.SourceKind, ref: string, at = 1): box.BoxSource => ({ kind, ref, name: ref || kind, at });

describe("song box", () => {
  it("merges by track ID: new tracks on top, a second source only adds the source", () => {
    const first = box.mergeTracks([], [track(vid(1)), track(vid(2)), track(vid(1))], src("youtube-playlist", "PLa", 1));
    assert.deepEqual(first.entries.map((e) => e.track.id), [vid(1), vid(2)]);
    assert.equal(first.added.length, 2);
    first.entries[1].gone = true;

    const again = box.mergeTracks(first.entries, [track(vid(2)), track(vid(3))], src("youtube-playlist", "PLa", 2));
    assert.equal(again.merged, 0);
    assert.deepEqual(again.added.map((e) => e.track.id), [vid(3)]);
    assert.equal(again.entries.find((e) => e.track.id === vid(2))!.gone, undefined, "back in a live list: not gone");

    const liked = box.mergeTracks(again.entries, [track(vid(2))], src("youtube-liked", "LL", 3));
    assert.equal(liked.merged, 1);
    assert.equal(liked.entries.length, 3);
    assert.deepEqual(liked.entries.find((e) => e.track.id === vid(2))!.sources.map((s) => s.kind), ["youtube-playlist", "youtube-liked"]);
  });

  it("filters by untagged, source, tag and words", () => {
    const entries = box.mergeTracks([], [track(vid(1), "Asayake"), track(vid(2), "Domino Line")], src("youtube-playlist", "PLa")).entries;
    box.mergeTracks(entries, [track(vid(2))], src("youtube-liked", "LL"));
    entries[0].tags = ["작품:Asayake"];
    const ids = (q: box.BoxQuery) => box.filterItems(entries, q).map((e) => e.track.id);
    assert.deepEqual(ids({}), [vid(1), vid(2)]);
    assert.deepEqual(ids({ filter: "untagged" }), [vid(2)]);
    assert.deepEqual(ids({ source: "youtube-liked" }), [vid(2)]);
    assert.deepEqual(ids({ source: "youtube-playlist:PLa" }), [vid(1), vid(2)]);
    assert.deepEqual(ids({ source: "youtube-playlist:PLb" }), []);
    assert.deepEqual(ids({ tag: "작품:Asayake" }), [vid(1)]);
    assert.deepEqual(ids({ q: "domino" }), [vid(2)]);
    assert.deepEqual(ids({ q: "asayake 작품" }), [vid(1)], "tags are searched too");
  });

  it("pages by 200", () => {
    const entries = box.mergeTracks([], Array.from({ length: 450 }, (_, i) => track(vid(i))), src("link", "")).entries;
    const p1 = box.pageItems(entries);
    assert.equal(p1.items.length, 200);
    assert.equal(p1.total, 450);
    assert.equal(p1.next, "200");
    const p3 = box.pageItems(entries, "400");
    assert.equal(p3.items.length, 50);
    assert.equal(p3.next, null);
    assert.equal(box.pageItems(entries, "junk").items[0].track.id, vid(0));
  });
});

describe("tags", () => {
  it("cleans tags", () => {
    assert.deepEqual(library.cleanTags(["  작품:Asayake ", "작품:Asayake", "", 3, "분위기:  밤"]), ["작품:Asayake", "분위기: 밤"]);
    assert.deepEqual(library.cleanTags("x"), []);
  });

  it("splits versions into originals and arrangements", () => {
    const items = [
      { track: track("studio00000"), tags: ["작품:Asayake"] },
      { track: track("live1985000"), tags: ["작품:Asayake", "판본:1985 라이브"] },
      { track: track("brass000000"), tags: ["작품:Asayake", "편곡:브라스"] },
      { track: track("other000000"), tags: ["작품:Domino Line"] },
    ];
    const v = box.splitVersions(items, ["작품:Asayake"]);
    assert.deepEqual(v.originals.map((i) => i.track.id), ["studio00000", "live1985000"]);
    assert.deepEqual(v.arrangements.map((i) => i.track.id), ["brass000000"]);
    assert.deepEqual(box.splitVersions(items, []), { originals: [], arrangements: [] });
  });

  it("tags box tracks and bundles, finds versions across them, reports unknown IDs", async () => {
    library.useLibraryStorage(memory());
    box.useBoxStorage(memory());
    await box.addToBox([track(vid(1)), track(vid(2)), track("L" + "a".repeat(20))], src("link", ""));
    const bundle = await library.createBundle({ title: "Asayake (brass)", parts: [track(vid(2))] });
    const r = await box.editTags([vid(1), bundle.id, vid(9)], (t) => [...t, "작품:Asayake"]);
    assert.deepEqual(r.updated.sort(), [bundle.id, vid(1)].sort());
    assert.deepEqual(r.missing, [vid(9)]);
    await box.editTags([bundle.id], (t) => [...t, "편곡:브라스"]);
    const v = await box.versions(vid(1));
    assert.deepEqual(v.works, ["Asayake"]);
    assert.deepEqual(v.originals.map((i) => i.track.id), [vid(1)]);
    assert.deepEqual(v.arrangements.map((i) => i.track.kind), ["bundle"]);
    assert.deepEqual(await box.allTags(), [{ tag: "작품:Asayake", count: 2 }, { tag: "편곡:브라스", count: 1 }]);
    await box.editTags([vid(1)], (t) => t.filter((x) => x !== "작품:Asayake"));
    assert.equal((await box.listBox({ filter: "untagged" })).total, 2);
    assert.equal(await box.markGone([vid(1), vid(9)]), 1);
    assert.equal(await box.markGone([vid(1)]), 0);
  });
});

describe("bundles", () => {
  it("IDs are B + 20 characters and pass as track IDs", () => {
    const id = library.newBundleId();
    assert.match(id, BUNDLE_ID);
    assert.ok(TRACK_ID.test(id));
    assert.notEqual(id, library.newBundleId());
  });

  it("sanitizeTrack keeps bundle references and only them as bundles", () => {
    const id = library.newBundleId();
    const ref = library.sanitizeTrack({ id, title: "Beethoven 5", artist: "Karajan", duration: 1900, thumb: "https://i.ytimg.com/x.jpg", kind: "bundle" });
    assert.equal(ref.kind, "bundle");
    assert.equal(ref.source, undefined);
    assert.equal(library.sanitizeTrack({ id: vid(1), kind: "bundle" }).kind, "song");
  });

  it("follows edits into playlist rows and leaves them on delete", async () => {
    library.useLibraryStorage(memory());
    const b = await library.createBundle({ title: "Beethoven 5", parts: [track(vid(1)), track(vid(2))] });
    const row = library.bundleTrack(b);
    assert.equal(row.duration, 120);
    assert.equal(row.kind, "bundle");
    const p = await library.createPlaylist("Classics", [row, track(vid(3))]);
    await library.updateBundle(b.id, { title: "Beethoven 5 · Karajan 1962", artist: "Karajan" });
    assert.equal(p.tracks[0].title, "Beethoven 5 · Karajan 1962");
    assert.equal(p.tracks[0].artist, "Karajan");
    await assert.rejects(library.createBundle({ title: "x", parts: [row] }));
    await assert.rejects(library.createBundle({ title: " ", parts: [track(vid(1))] }));
    await library.deleteBundle(b.id);
    const lib = await library.getLibrary();
    assert.deepEqual(lib.playlists[0].tracks.map((t) => t.id), [vid(3)]);
    assert.equal(lib.bundles!.length, 0);
  });
});

describe("youtube account", () => {
  it("syncs every playlist but the excluded ones", () => {
    const lists = [{ id: "LL" }, { id: "PLa" }, { id: "PLb" }];
    assert.deepEqual(syncTargets(lists, ["PLb"]).map((p) => p.id), ["LL", "PLa"]);
    assert.deepEqual(syncTargets(lists, []).length, 3);
  });

  it("spots deleted and private playlist items", () => {
    assert.ok(itemGone({ snippet: { title: "Deleted video" }, status: { privacyStatus: "privacyStatusUnspecified" } }));
    assert.ok(itemGone({ snippet: { title: "Private video", videoOwnerChannelTitle: "x" }, status: { privacyStatus: "private" } }));
    assert.ok(!itemGone({ snippet: { title: "Asayake", videoOwnerChannelTitle: "Casiopea - Topic" }, status: { privacyStatus: "public" } }));
  });

  it("signs the OAuth state for 10 minutes", () => {
    const now = 1_800_000_000_000;
    const state = signState("secret", "home", now);
    assert.equal(checkState("secret", state, now + 60_000), "home");
    assert.equal(checkState("secret", signState("secret", "settings", now), now), "settings");
    assert.equal(checkState("other", state, now), null);
    assert.equal(checkState("secret", state, now + 11 * 60_000), null);
    assert.equal(checkState("secret", state.replace(".home.", ".settings."), now), null);
    assert.equal(checkState("secret", "garbage", now), null);
  });

  it("reads ISO-8601 durations", () => {
    assert.equal(isoDuration("PT3M33S"), 213);
    assert.equal(isoDuration("PT1H2M3S"), 3723);
    assert.equal(isoDuration("PT45S"), 45);
    assert.equal(isoDuration("P1DT2M"), 86520);
    assert.equal(isoDuration("PT0S"), 0);
    assert.equal(isoDuration("P0D"), 0);
    assert.equal(isoDuration(undefined), 0);
    assert.equal(isoDuration("3:33"), 0);
  });
});
