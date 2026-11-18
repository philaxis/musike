import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPermutation, sanitizeTrack } from "../src/library.ts";
import { cleanName, localId, mediaFiles, nameTrack, parseFileName, parseRoots, relInRoot } from "../src/localNames.ts";
import { parsePlaylistLink } from "../src/playlistImport.ts";
import { HttpError, TRACK_ID, VIDEO_ID } from "../src/types.ts";

describe("TRACK_ID", () => {
  it("accepts YouTube IDs and local IDs", () => {
    assert.ok(TRACK_ID.test("dQw4w9WgXcQ"));
    const id = localId("야마시타 타츠로", "[1980.09.21] RIDE ON TIME (Lossless).mp4");
    assert.match(id, /^L[A-Za-z0-9_-]{20}$/);
    assert.ok(TRACK_ID.test(id));
    assert.ok(!VIDEO_ID.test(id));
  });

  it("rejects other shapes", () => {
    for (const bad of ["", "short", "dQw4w9WgXcQx", "L" + "a".repeat(19), "L" + "a".repeat(21), "X" + "a".repeat(20), "dQw4w9WgX/Q"]) {
      assert.ok(!TRACK_ID.test(bad), bad);
    }
  });

  it("keeps the same ID for the same path and a different one elsewhere", () => {
    assert.equal(localId("a", "x/y.mp4"), localId("a", "x/y.mp4"));
    assert.notEqual(localId("a", "x/y.mp4"), localId("b", "x/y.mp4"));
  });

  it("sanitizeTrack keeps local tracks with their relative cover", () => {
    const id = localId("카시오페아", "[1982.xx.xx] Mint Jams (320 Kbps).mp4");
    const t = sanitizeTrack({ id, title: "Mint Jams", artist: "카시오페아", duration: 2400, thumb: `/api/local/${id}/cover`, art: "/etc/passwd", kind: "video", year: 1982, unavailable: true });
    assert.equal(t.source, "local");
    assert.equal(t.thumb, `/api/local/${id}/cover`);
    assert.equal(t.art, "");
    assert.equal(t.year, 1982);
    assert.equal("unavailable" in t, false);
    assert.throws(() => sanitizeTrack({ id: "L123" }), HttpError);
  });
});

describe("file names", () => {
  const cases: [string, string, number | undefined][] = [
    ["[1980.09.21] RIDE ON TIME (Lossless).mp4", "RIDE ON TIME", 1980],
    ["[1982.xx.xx] Mint Jams (320 Kbps).mp4", "Mint Jams", 1982],
    ["[2001.02.00] CM Collection Vol.1 (192 Kbps).mp4", "CM Collection Vol.1", 2001],
    ["[1990.04.25] Endless Game (VBR).mp4", "Endless Game", 1990],
    ["[1978.05.25] IT'S A POPPIN' TIME (320 Kbps) Disc I.mp4", "IT'S A POPPIN' TIME Disc I", 1978],
    ["[1987.xx.xx] Perfect, Live II (192 Kbps) CD 1.mp4", "Perfect, Live II CD 1", 1987],
    ["[1977.05.25] SPACY (2002 Remaster) (Lossless).mp4", "SPACY (2002 Remaster)", 1977],
    ["[1991.08.25] Turner's Steamroller (VBR)_audiosr.mp4", "Turner's Steamroller (AudioSR)", 1991],
    ["[1980.10.20] MY SUGAR BABE.mp4", "MY SUGAR BABE", 1980],
    ["Yamashita Tatsuro - Itsuka Hareta Hi ni [MP3 V0].mp4", "Yamashita Tatsuro - Itsuka Hareta Hi ni", undefined],
    ["2026-11-13 [Study with Rookiss] AI 게임 프로토타입 제작 (1일차, 마이크 없음) [NhqsrcLOnag].mp4", "[Study with Rookiss] AI 게임 프로토타입 제작 (1일차, 마이크 없음)", 2026],
  ];
  for (const [file, title, year] of cases) {
    it(file, () => assert.deepEqual(parseFileName(file), year ? { title, year } : { title }));
  }

  it("artist is the tag, else the root name", () => {
    const rel = "[1980.09.21] RIDE ON TIME (Lossless).mp4";
    assert.deepEqual(nameTrack("야마시타 타츠로", rel, {}), { title: "RIDE ON TIME", artist: "야마시타 타츠로", year: 1980 });
    assert.equal(nameTrack("야마시타 타츠로", rel, { artist: "山下達郎", title: "Ride On Time" }).artist, "山下達郎");
    assert.equal(nameTrack("x", "Song.mp3", { date: "1985-03-01" }).year, 1985);
  });

  it("artist of a yt-bulk archive is the channel folder", () => {
    const rel = "루키스AI/2026-11-13 [Study with Rookiss] AI 게임 [NhqsrcLOnag]/2026-11-13 [Study with Rookiss] AI 게임 [NhqsrcLOnag].mp4";
    const n = nameTrack("유튜브 보관함", rel, {});
    assert.equal(n.artist, "루키스AI");
    assert.equal(n.title, "[Study with Rookiss] AI 게임");
    assert.equal(n.year, 2026);
  });

  it("cleans folder names without eating dots", () => {
    assert.deepEqual(cleanName("[1996.xx.xx] Super Best Vol.2 (Lossless)"), { title: "Super Best Vol.2", year: 1996 });
  });
});

describe("partial files", () => {
  it("skips yt-dlp format pieces when the merged file is there", () => {
    const names = ["v [abc].mp4", "v [abc].f248.webm", "v [abc].f251.webm", "v [abc].info.json", "poster.jpg", "x.f140.m4a"];
    assert.deepEqual(mediaFiles(names), ["v [abc].mp4", "x.f140.m4a"]);
  });

  it("skips hidden, temporary and unknown files", () => {
    assert.deepEqual(mediaFiles([".a.mp4", "b.temp.m4a", "c.mp4.part", "d.f248.mp4.part-Frag7.part", "e.txt", "f.FLAC"]), ["f.FLAC"]);
  });
});

describe("roots", () => {
  it("parses MUSIKE_LOCAL_DIRS", () => {
    assert.deepEqual(parseRoots("야마시타 타츠로=/m/야마시타 타츠로; 카시오페아 = /m/카시오페아 ;bad;=x;y="), [
      { name: "야마시타 타츠로", path: "/m/야마시타 타츠로" },
      { name: "카시오페아", path: "/m/카시오페아" },
    ]);
  });

  it("refuses paths outside a root", () => {
    assert.equal(relInRoot("/m/root", "/m/root/a/b.mp4"), "a/b.mp4");
    assert.equal(relInRoot("/m/root", "/m/root/../other/b.mp4"), null);
    assert.equal(relInRoot("/m/root", "/m/root/a/../../etc/passwd"), null);
    assert.equal(relInRoot("/m/root", "/m/rootx/b.mp4"), null);
    assert.equal(relInRoot("/m/root", "/m/root"), null);
    assert.equal(relInRoot("/m/root", "a/b.mp4"), null);
  });
});

describe("playlist links", () => {
  const id = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";
  it("reads every accepted shape", () => {
    assert.equal(parsePlaylistLink(`https://www.youtube.com/playlist?list=${id}`)?.listId, id);
    assert.equal(parsePlaylistLink(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${id}&index=3`)?.url, `https://www.youtube.com/playlist?list=${id}`);
    assert.equal(parsePlaylistLink(`youtube.com/playlist?list=${id}`)?.listId, id);
    assert.equal(parsePlaylistLink(`https://m.youtube.com/playlist?list=${id}`)?.listId, id);
    const music = parsePlaylistLink(`https://music.youtube.com/playlist?list=${id}`);
    assert.equal(music?.listId, id);
    assert.equal(music?.music, true);
    const album = parsePlaylistLink("https://music.youtube.com/playlist?list=OLAK5uy_kLTXyd-YNXN0r8nW6ndC5Mu41vCWqsK7c");
    assert.equal(album?.listId, "OLAK5uy_kLTXyd-YNXN0r8nW6ndC5Mu41vCWqsK7c");
    assert.equal(album?.music, true);
    assert.equal(parsePlaylistLink(`https://youtu.be/dQw4w9WgXcQ?list=${id}`)?.listId, id);
    assert.equal(parsePlaylistLink(id)?.listId, id);
  });

  it("is not a playlist link", () => {
    for (const s of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://example.com/playlist?list=" + id, "mint jams", "PLAY"]) {
      assert.equal(parsePlaylistLink(s), null, s);
    }
  });

  it("refuses login-only lists (Liked, Watch later)", () => {
    for (const s of ["https://www.youtube.com/playlist?list=LL", "https://www.youtube.com/playlist?list=WL", "https://music.youtube.com/playlist?list=LM", "WL"]) {
      assert.throws(() => parsePlaylistLink(s), (e: unknown) => e instanceof HttpError && e.status === 400 && typeof e.text !== "string" && e.text.key === "loginRequired", s);
    }
  });
});

describe("reorder", () => {
  const current = ["a", "b", "c"];
  it("accepts an exact permutation", () => {
    assert.ok(isPermutation(current, ["c", "a", "b"]));
    assert.ok(isPermutation([], []));
  });
  it("refuses anything else", () => {
    assert.ok(!isPermutation(current, ["a", "b"]));
    assert.ok(!isPermutation(current, ["a", "b", "c", "d"]));
    assert.ok(!isPermutation(current, ["a", "a", "b"]));
    assert.ok(!isPermutation(current, ["a", "b", "x"]));
    assert.ok(!isPermutation(current, ["a", "b", 3]));
    assert.ok(!isPermutation(current, "a,b,c"));
  });
});
