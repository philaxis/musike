import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as box from "../src/box.ts";
import { checkState, isoDuration, itemGone, signState, syncTargets, unplayable } from "../src/google.ts";
import * as library from "../src/library.ts";
import { BUNDLE_ID, TRACK_ID, type Track } from "../src/types.ts";
import { toHttpError } from "../src/ytdlp.ts";

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
    first.entries[1].blocked = { reason: "gone", at: 1 };

    const again = box.mergeTracks(first.entries, [track(vid(2)), track(vid(3))], src("youtube-playlist", "PLa", 2));
    assert.equal(again.merged, 0);
    assert.deepEqual(again.added.map((e) => e.track.id), [vid(3)]);
    assert.equal(again.entries.find((e) => e.track.id === vid(2))!.blocked, undefined, "back in a live list: not gone");

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
    assert.equal(await box.applyChecks(new Map([[vid(1), "region"], [vid(9), "gone"]]), 5), 1);
    assert.equal(await box.applyChecks(new Map([[vid(1), "region"]]), 6), 0);
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

  it("judges whether a video plays here (videos.list status, contentDetails)", () => {
    const v = (status: object, contentDetails: object = {}) => ({ id: vid(1), status, contentDetails });
    const ok = { uploadStatus: "processed", privacyStatus: "public" };
    assert.equal(unplayable(v(ok), "KR"), null);
    assert.equal(unplayable(v(ok, { regionRestriction: { blocked: ["KR", "JP"] } }), "KR"), "region");
    assert.equal(unplayable(v(ok, { regionRestriction: { blocked: ["DE"] } }), "KR"), null);
    assert.equal(unplayable(v(ok, { regionRestriction: { allowed: ["US", "CA"] } }), "KR"), "region");
    assert.equal(unplayable(v(ok, { regionRestriction: { allowed: ["US", "KR"] } }), "KR"), null);
    assert.equal(unplayable(v({ uploadStatus: "rejected", rejectionReason: "copyright", privacyStatus: "public" }), "KR"), "gone");
    assert.equal(unplayable(v({ uploadStatus: "processed", privacyStatus: "private" }), "KR"), "private");
    assert.equal(unplayable(v(ok, { contentRating: { ytRating: "ytAgeRestricted" } }), "KR"), "age");
    assert.equal(unplayable(undefined, "KR"), "gone", "missing from the answer: deleted");
  });

  it("tells yt-dlp's 'won't play' errors apart", () => {
    const reason = (line: string) => toHttpError(`ERROR: [youtube] X2KMDkyt-SM: ${line}`).reason;
    assert.equal(reason("Video unavailable. It was blocked due to the claimed content by Nintendo."), "region");
    assert.equal(reason("Video unavailable. The uploader has not made this video available in your country"), "region");
    assert.equal(reason("Private video. Sign in if you've been granted access to this video"), "private");
    assert.equal(reason("Video unavailable. This video has been removed by the uploader"), "gone");
    assert.equal(reason("Sign in to confirm your age. This video may be inappropriate for some users."), "age");
    assert.equal(toHttpError("ERROR: Sign in to confirm you're not a bot").code, "bot_check");
    assert.equal(toHttpError("ERROR: nsig extraction failed").reason, undefined);
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

describe("tracks that won't play", () => {
  it("puts them aside: out of every listing, counted by reason, back when they play again", async () => {
    library.useLibraryStorage(memory());
    box.useBoxStorage(memory());
    await box.addToBox([track(vid(1)), track(vid(2)), track(vid(3))], src("youtube-playlist", "PLa"));
    await box.editTags([vid(2)], () => ["작품:x"]);
    assert.equal(await box.applyChecks(new Map([[vid(1), null], [vid(2), "region"], [vid(3), "private"]]), 7), 2);
    assert.equal(await box.checkedAt(), 7);
    const ids = async (q: box.BoxQuery) => (await box.listBox(q)).items.map((it) => it.track.id);
    assert.deepEqual(await ids({}), [vid(1)]);
    assert.deepEqual(await ids({ source: "youtube-playlist:PLa" }), [vid(1)]);
    assert.deepEqual(await ids({ tag: "작품:x" }), []);
    assert.deepEqual(await ids({ q: "vid" }), [vid(1)], "the box search (「내 곡」) too");
    assert.deepEqual(await ids({ filter: "blocked" }), [vid(2), vid(3)]);
    const listed = (await box.listBox({ filter: "blocked" })).items.find((it) => it.track.id === vid(2))!;
    assert.equal(listed.track.blocked, "region");
    assert.equal(listed.blocked!.at, 7);
    const sources = await box.boxSources();
    assert.equal(sources.total, 1);
    assert.deepEqual(sources.aside, { region: 1, private: 1 });
    assert.deepEqual(sources.sources.map((s) => s.count), [1]);
    assert.deepEqual(await box.allTags(), []);
    // A playlist row keeps its place and says why (see /api/library).
    const annotate = await box.annotator();
    assert.equal(annotate(track(vid(2))).blocked, "region");
    assert.equal(annotate(track(vid(1))).blocked, undefined);
    // Allowed again in a later check: back in the listings.
    await box.applyChecks(new Map([[vid(2), null]]), 8);
    assert.deepEqual((await ids({})).sort(), [vid(1), vid(2)]);
    await box.markBlocked(vid(1), "gone");
    assert.deepEqual(await ids({}), [vid(2)]);
  });

  it("reads boxes saved with `gone`", async () => {
    const store = memory();
    await store.write(JSON.stringify({ entries: [{ track: track(vid(1)), sources: [src("link", "")], tags: [], addedAt: 1, gone: true }], localTags: {} }));
    box.useBoxStorage(store);
    const e = (await box.boxEntry(vid(1)))!;
    assert.deepEqual(e.blocked, { reason: "gone", at: 0 });
    assert.equal("gone" in e, false);
    assert.equal(await box.checkedAt(), undefined);
  });

  it("picks other versions closest in length, leaving out the same video and those that won't play", () => {
    const t = (id: string, duration: number) => ({ ...track(id), duration });
    const original = t(vid(0), 200);
    const found = [t(vid(0), 200), t(vid(1), 260), t(vid(2), 203), t(vid(3), 199), t(vid(4), 200), t(vid(5), 0), t(vid(6), 201), t(vid(7), 150), t(vid(8), 200)];
    const picked = box.pickAlternatives(original, found, (x) => x.id === vid(8));
    assert.deepEqual(picked.map((x) => x.id), [vid(4), vid(3), vid(6), vid(2), vid(7)]);
  });

  it("replaces a track with another version: sources, tags and playlist rows stay, the old ID stays as `was`", async () => {
    library.useLibraryStorage(memory());
    box.useBoxStorage(memory());
    const old = track(vid(1), "Fire Emblem Theme");
    await box.addToBox([old, track(vid(2))], src("youtube-playlist", "PLa", 1));
    await box.addToBox([old], src("youtube-liked", "LL", 2));
    await box.editTags([vid(1)], () => ["작품:Fire Emblem", "장르:게임"]);
    await box.applyChecks(new Map([[vid(1), "region"], [vid(2), null]]), 3);
    const p = await library.createPlaylist("Games", [track(vid(2)), old, track(vid(3))]);
    await library.addFavorite(old);
    const b = await library.createBundle({ title: "Suite", parts: [old, track(vid(3))] });

    const fresh = track(vid(9), "Fire Emblem Theme (official)");
    await box.replaceTrack(vid(1), fresh);
    assert.equal(await library.replaceTrack(vid(1), fresh), 3);

    assert.equal(await box.boxEntry(vid(1)), null);
    const e = (await box.boxEntry(vid(9)))!;
    assert.deepEqual(e.tags, ["작품:Fire Emblem", "장르:게임"]);
    assert.deepEqual(e.sources.map((s) => [s.kind, s.ref, s.was]), [["youtube-playlist", "PLa", vid(1)], ["youtube-liked", "LL", vid(1)]]);
    assert.equal(e.blocked, undefined);
    assert.equal(e.addedAt, 1);
    assert.deepEqual((await box.listBox({})).items.map((it) => it.track.id).sort(), [vid(2), vid(9)]);

    const lib = await library.getLibrary();
    assert.deepEqual(lib.playlists.find((x) => x.id === p.id)!.tracks.map((t) => t.id), [vid(2), vid(9), vid(3)]);
    assert.deepEqual(lib.favorites.map((t) => t.id), [vid(9)]);
    assert.deepEqual(lib.bundles!.find((x) => x.id === b.id)!.parts.map((t) => t.id), [vid(9), vid(3)]);

    // The next sync still lists the old video: it lands on the new entry, not as a track of its own.
    const again = await box.addToBox([old, track(vid(4))], src("youtube-playlist", "PLa", 4));
    assert.deepEqual(again.added.map((x) => x.track.id), [vid(4)]);
    const synced = await box.addToBox([old], src("youtube-playlist", "PLb", 5));
    assert.equal(synced.merged, 1);
    assert.deepEqual((await box.boxEntry(vid(9)))!.sources.map((s) => s.ref), ["PLa", "LL", "PLb"]);
  });

  it("replacing with a track the box has already merges into it", () => {
    const entries = box.mergeTracks([], [track(vid(1)), track(vid(2))], src("youtube-playlist", "PLa")).entries;
    entries[0].tags = ["a"];
    entries[1].tags = ["b"];
    const out = box.replaceEntry(entries, vid(1), track(vid(2)));
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].tags, ["b", "a"]);
  });
});
