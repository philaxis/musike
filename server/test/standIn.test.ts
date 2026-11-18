import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import * as box from "../src/box.ts";
import { config } from "../src/config.ts";
import * as ledger from "../src/ledger.ts";
import * as library from "../src/library.ts";
import * as standIn from "../src/standIn.ts";
import type { Track } from "../src/types.ts";
import { pageRedirect, resolvedRedirect } from "../src/ytMusic.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const track = (id: string, title = id, artist = "a", duration = 60): Track => ({ id, title, artist, duration, thumb: "", art: "", kind: "song" });
const vid = (n: number) => `vid${String(n).padStart(8, "0")}`;
const memory = () => {
  let json: string | null = null;
  return { read: async () => json, write: async (s: string) => void (json = s) };
};
const src = (kind: box.SourceKind, ref: string, at = 1): box.BoxSource => ({ kind, ref, name: ref || kind, at });

describe("where YouTube Music moved a track", () => {
  it("reads the link resolver's answer", () => {
    // pjiHfYuZg5w (KISIDA KYODAN – Losers, blocked everywhere) now plays as dW0oA3Yx7Qk.
    assert.equal(resolvedRedirect(JSON.parse(fixture("ytm-resolve-url.json"))), "dW0oA3Yx7Qk");
    assert.equal(resolvedRedirect(JSON.parse(fixture("ytm-resolve-url-unknown.json"))), null, "an unknown video opens the home page");
    assert.equal(resolvedRedirect(null), null);
  });

  it("reads the watch page's INITIAL_ENDPOINT", () => {
    // cDCAXCO2eoE's watch page (trimmed), which opens 0GNgAmK9uMA.
    assert.equal(pageRedirect(fixture("ytm-watch.html")), "0GNgAmK9uMA");
    assert.equal(pageRedirect(String.raw`ytcfg.set({'INITIAL_ENDPOINT': '\x7b\x22watchEndpoint\x22:\x7b\x22videoId\x22:\x22dW0oA3Yx7Qk\x22\x7d\x7d'})`), "dW0oA3Yx7Qk");
    assert.equal(pageRedirect("<html><body>nothing here</body></html>"), null);
  });

  it("takes the moved track only when it is the same song", () => {
    const losers = track(vid(1), "Losers", "KISIDA KYODAN & THE AKEBOSI ROCKETS", 229);
    assert.ok(box.redirectFits(losers, { title: "Losers", artist: "KISIDA KYODAN & THE AKEBOSI ROCKETS", duration: 229 }), "same title");
    assert.ok(box.redirectFits(losers, { title: "LOSERS (2024 Remaster)", artist: "Someone else", duration: 300 }), "alike title");
    const komm = track(vid(2), "Komm,susser Tod (Mー10 Director's Edit.Version)", "ARIANNE", 466);
    assert.ok(box.redirectFits(komm, { title: "Komm, süßer Tod ~来て、優しい死よ~", artist: "ARIANNE - Topic", duration: 469 }), "same artist, length within 5 s");
    assert.equal(box.redirectFits(komm, { title: "Thanatos", artist: "ARIANNE", duration: 500 }), false, "same artist, another length");
    assert.equal(box.redirectFits(losers, { title: "Good Luck, Babe!", artist: "Chappell Roan", duration: 229 }), false, "another song");
  });
});

describe("choosing a stand-in", () => {
  it("prefers the same title and length, then the same title and artist, then the closest in length", () => {
    const original = track(vid(0), "Uncle Skunk", "Guthrie Govan", 200);
    const alt = (n: number, title: string, artist: string, duration: number) => ({ ...track(vid(n), title, artist, duration) });
    const found = [
      alt(1, "Uncle Skunk (Live)", "Guthrie Govan", 200),
      alt(2, "Uncle Skunk", "Guthrie Govan", 240),
      alt(3, "Uncle Skunk", "Cover Band", 202),
      alt(4, "Uncle Skunk", "Cover Band", 260),
    ];
    const picked = box.pickAlternatives(original, found, () => false);
    assert.deepEqual(picked.map((a) => a.track.id), [vid(1), vid(3), vid(2), vid(4)], "the dialog: closest in length");
    // vid(4): the same title by someone else, 60 s longer (> 15%): only offered, never put in by itself.
    assert.deepEqual(box.standInOrder(original, picked).map((a) => a.track.id), [vid(3), vid(2), vid(1)]);
    assert.deepEqual(picked.map((a) => box.standInTier(original, a)), [2, 0, 1, null]);
    assert.deepEqual(box.standInOrder(original, picked.filter((a) => a.track.id !== vid(3))).map((a) => a.track.id), [vid(2), vid(1)]);
    assert.deepEqual(box.standInOrder(original, []), []);
  });

  it("never puts in another song or a far other length by itself", () => {
    const offered = (original: Track, other: Track) => box.pickAlternatives(original, [other], () => false);
    const highHeart = track(vid(0), "High Heart", "9 and the Numbers", 239);
    const epik = track(vid(1), "Epik High (ft. Lee Hi)- 'Can You Hear My Heart' (Scarlet Heart:Ryeo OST, Part 6)[Han|Rom|Eng lyrics]", "ashleygold25", 247);
    assert.equal(box.standInTier(highHeart, { track: epik, sameTitle: false, sameArtist: false }), null, "another song name");
    const headWind = track(vid(2), "A HEAD WIND", "Naoya Matsuoka", 321);
    const anime = track(vid(3), "『灰と幻想のグリムガル』第1話挿入歌「Head Wind」(K)NoW_NAME《アニメMV》", "TOHO animation チャンネル", 146);
    const [a] = offered(headWind, anime);
    assert.ok(a, "still offered in 「다른 판 찾기」");
    assert.equal(box.standInTier(headWind, a), null, "146 s for 321 s, another artist");
    const cover = track(vid(4), "The Prime of Life / Naoya Matsuoka【Cover】", "profkyao", 475);
    const prime = track(vid(5), "THE PRIME OF LIFE", "Naoya Matsuoka", 479);
    assert.equal(box.standInTier(prime, offered(prime, cover)[0]), 2, "a cover of the same piece, length within 15%");
  });
});

describe("stand-ins and 「되돌리기」", () => {
  it("puts a stand-in in everywhere, lists it, and puts the original back aside for good", async () => {
    config.dataDir = mkdtempSync(path.join(tmpdir(), "musike-standin-"));
    ledger.resetLedger();
    library.useLibraryStorage(memory());
    box.useBoxStorage(memory());
    const old = track(vid(1), "Losers", "KISIDA KYODAN", 229);
    await box.addToBox([old, track(vid(2)), track(vid(3)), track(vid(4))], src("youtube-playlist", "PLa", 1));
    await box.editTags([vid(1)], () => ["장르:록"]);
    await box.applyChecks(new Map([[vid(1), "region"], [vid(3), "gone"], [vid(4), "private"]]), 2);
    const p = await library.createPlaylist("Rock", [track(vid(2)), old]);

    const fresh = track(vid(9), "Losers", "KISIDA KYODAN", 229);
    const r = await standIn.replaceEverywhere(vid(1), fresh, "redirect", "region");
    assert.equal(r.rows, 1);
    await standIn.replaceEverywhere(vid(3), track(vid(7)), "alternative", "gone");
    await standIn.replaceEverywhere(vid(4), track(vid(8)), "manual");
    assert.equal((await box.replacementOf(vid(1)))?.id, vid(9));
    assert.equal(await box.replacementOf(vid(2)), null, "still in the box itself");

    const e = (await box.boxEntry(vid(9)))!;
    assert.deepEqual([e.replaced?.by, e.replaced?.was.id, e.replaced?.reason], ["redirect", vid(1), "region"]);
    assert.deepEqual(e.sources.map((s) => s.was), [vid(1)]);
    // Searched stand-ins first, then hand-picked, then YouTube Music's moves.
    const listed = await box.listBox({ filter: "replaced" });
    assert.deepEqual(listed.items.map((it) => it.track.id), [vid(7), vid(8), vid(9)]);
    assert.deepEqual(listed.items.map((it) => it.replaced?.was.id), [vid(3), vid(4), vid(1)]);
    assert.deepEqual((await box.boxSources()).replaced, { redirect: 1, alternative: 1, manual: 1 });
    // The video ledger: plays, taste and the map follow each old ID to its stand-in.
    const follow = await ledger.aliases();
    assert.deepEqual([vid(1), vid(3), vid(4), vid(2)].map(follow.resolve), [vid(9), vid(7), vid(8), vid(2)]);
    assert.deepEqual((await ledger.recentEvents(10)).events.map((x) => [x.kind, x.id]).sort(), [["replaced", vid(1)], ["replaced", vid(3)], ["replaced", vid(4)]]);
    assert.deepEqual((await box.listBox({ filter: "blocked" })).items, []);

    const back = await standIn.restore(vid(9));
    assert.equal(back.track.id, vid(1));
    assert.equal(back.track.blocked, "region");
    assert.equal(back.rows, 1);
    assert.equal(await box.boxEntry(vid(9)), null);
    const restored = (await box.boxEntry(vid(1)))!;
    assert.equal(restored.blocked?.reason, "region");
    assert.equal(restored.keepAside, true);
    assert.equal(restored.replaced, undefined);
    assert.deepEqual(restored.tags, ["장르:록"]);
    assert.deepEqual(restored.sources.map((s) => s.was), [undefined]);
    assert.deepEqual((await library.getLibrary()).playlists.find((x) => x.id === p.id)!.tracks.map((t) => t.id), [vid(2), vid(1)]);
    assert.equal((await ledger.aliases()).resolve(vid(1)), vid(1), "restored: the old ID is its own again");
    // Never replaced by itself again, and answered at once when played.
    assert.deepEqual((await box.asideForStandIn(Date.now())).map((t) => t.id), []);
    assert.equal(await standIn.settledAside(vid(1)), "region");
    assert.equal(await standIn.standInFor(vid(1), "region"), null);
    await assert.rejects(standIn.restore(vid(2)), /wasn't put in place/);
  });

  it("splits a stand-in that was a box track of its own when restored", () => {
    const entries = box.mergeTracks([], [track(vid(1))], src("youtube-playlist", "PLa")).entries;
    entries.push(...box.mergeTracks([], [track(vid(2))], src("youtube-liked", "LL")).entries);
    entries[0].blocked = { reason: "region", at: 1 };
    const merged = box.replaceEntry(entries, vid(1), track(vid(2)), { by: "alternative", at: 2 });
    assert.equal(merged.length, 1);
    const r = box.restoreEntry(merged, vid(2), 3)!;
    assert.equal(r.split, true);
    const [kept, back] = r.entries;
    assert.deepEqual([kept.track.id, kept.sources.map((s) => s.ref), kept.replaced], [vid(2), ["LL"], undefined]);
    assert.deepEqual([back.track.id, back.sources.map((s) => [s.ref, s.was]), back.blocked], [vid(1), [["PLa", undefined]], { reason: "region", at: 3 }]);
    assert.equal(box.restoreEntry(r.entries, vid(2), 4), null);
  });

  it("keeps a Premium-only mark the account's check can't see", async () => {
    box.useBoxStorage(memory());
    await box.addToBox([track(vid(1)), track(vid(2))], src("link", ""));
    await box.markBlocked(vid(1), "premium");
    await box.markBlocked(vid(2), "region");
    await box.applyChecks(new Map([[vid(1), null], [vid(2), null]]), 5);
    assert.equal((await box.boxEntry(vid(1)))!.blocked?.reason, "premium");
    assert.equal((await box.boxEntry(vid(2)))!.blocked, undefined);
  });

  it("looks again for stand-ins once a day, oldest look first", async () => {
    box.useBoxStorage(memory());
    await box.addToBox([track(vid(1)), track(vid(2)), track(vid(3))], src("link", ""));
    await box.applyChecks(new Map([[vid(1), "region"], [vid(2), "region"], [vid(3), "age"]]), 1);
    await box.markLooked(vid(2), 100);
    await box.markLooked(vid(3), 300);
    assert.deepEqual((await box.asideForStandIn(200)).map((t) => t.id), [vid(1), vid(2)]);
    assert.deepEqual((await box.asideForStandIn(1000)).map((t) => t.id), [vid(1), vid(2), vid(3)]);
  });
});
