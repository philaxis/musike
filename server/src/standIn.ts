import { setTimeout as sleep } from "node:timers/promises";
import * as box from "./box.js";
import { checkVideos, videoTrack } from "./google.js";
import { msg, type Lang } from "./i18n.js";
import * as ledger from "./ledger.js";
import type { ReplacedBy } from "./ledger.js";
import * as library from "./library.js";
import { ownSession, search } from "./search.js";
import { HttpError, VIDEO_ID, type Track, type Unplayable } from "./types.js";
import { premiumOnly, resolveStreams } from "./ytdlp.js";
import { musicRedirect } from "./ytMusic.js";

// Stand-ins: a track that won't play here (blocked in this country, deleted, private, age-restricted, Premium only)
// is replaced by one that does whenever there is one, in this order:
//  1. where YouTube Music moved it (a distributor change gives a track a new video; the old one plays nowhere), when
//     that is the same song (`box.redirectFits`);
//  2. the best of 「다른 판 찾기」's candidates (`box.standInOrder`).
// Only when neither plays does it stay put aside. This runs when a track turns out not to play (`/api/prepare`) and
// after each check of the song box; 「되돌리기」 (`restore`) puts the original back for good. Premium-only tracks, which
// the account's check can't see, are looked for ahead too (`findPremiumOnly`).

/** How long a track put aside waits before a stand-in is looked for again (the check, and plays before it). */
const LOOK_AGAIN_MS = 24 * 3600_000;
/** Tracks looked at together by `fixAside`. */
const PARALLEL = 3;

/**
 * Video `id` as a track when it plays here (yt-dlp resolves it): its own title, channel and length, else `like`'s
 * (the direct fallback knows no channel). Null when it won't play; other failures (a tool problem) are thrown.
 */
async function playable(id: string, like: Track): Promise<Track | null> {
  try {
    const r = await resolveStreams(id);
    const t = videoTrack(id, r.title, r.uploader ?? "", Math.round(r.duration));
    return r.uploader ? t : { ...t, artist: like.artist, kind: like.kind };
  } catch (e) {
    if (e instanceof HttpError && (e.code === "unplayable" || e.status === 404)) return null;
    throw e;
  }
}

/** The track YouTube Music moved `original` to, when it moved and that plays here. */
async function movedTrack(original: Track): Promise<Track | null> {
  const moved = await musicRedirect(original.id);
  return moved && moved !== original.id ? playable(moved, original) : null;
}

/**
 * 「다른 판 찾기」: other versions of `original` from YouTube (its title's words with the artist, else alone), that
 * play here as far as the box and the account know, with an alike title (see `box.pickAlternatives`). Not `exclude`.
 * Throws when YouTube couldn't be searched at all.
 */
export async function findAlternatives(original: Track, lang: Lang | undefined, exclude: string[] = []): Promise<box.Alternative[]> {
  // Upload titles carry noise search doesn't match ("13. … 【… OST】 【HQ 1080p】").
  const title = box.titleWords(original.title).join(" ") || original.title;
  const annotate = await box.annotator();
  let answered = false;
  for (const q of [`${title} ${original.artist}`.trim(), title]) {
    const ask = (kind: "song" | "video") =>
      search(q.slice(0, 200), kind, lang).then(
        (r) => ((answered = true), r),
        (): Track[] => [],
      );
    const [songs, videos] = await Promise.all([ask("song"), ask("video")]);
    const found = [...songs, ...videos].filter((t, i, all) => VIDEO_ID.test(t.id) && !exclude.includes(t.id) && all.findIndex((x) => x.id === t.id) === i);
    // The account (when connected) tells which results won't play here either; without it the box's marks do.
    const checked = await checkVideos(found.map((t) => t.id)).catch(() => new Map<string, Unplayable | null>());
    const alternatives = box.pickAlternatives(original, found.map(annotate), (t) => !!t.blocked || !!checked.get(t.id));
    if (alternatives.length) return alternatives;
  }
  if (!answered) throw new HttpError(502, msg("searchFailed", { detail: "YouTube" }));
  return [];
}

/**
 * The candidates the 「다른 판 찾기」 dialog shows for box track `id` (for a stand-in: for its original): where
 * YouTube Music moved it first, when it plays here, then `findAlternatives`.
 */
export async function candidates(id: string, lang: Lang): Promise<box.Alternative[]> {
  const original = (await box.boxEntry(id))?.replaced?.was ?? (await box.findTrack(id));
  if (!original) throw new HttpError(404, msg("trackNotFound", { id }));
  const exclude = [id, original.id];
  const [moved, found] = await Promise.all([movedTrack(original).catch(() => null), findAlternatives(original, lang, exclude)]);
  if (!moved || exclude.includes(moved.id)) return found;
  const first: box.Alternative = { track: moved, sameTitle: false, sameArtist: box.sameArtist(original.artist, moved.artist), redirect: true };
  return [first, ...found.filter((a) => a.track.id !== moved.id)];
}

type Choice = { track: Track; by: "redirect" | "alternative" };

/**
 * What to put in place of `original`: where YouTube Music moved it, if that plays and is the same song, else the first
 * of `findAlternatives` in `box.standInOrder` that plays. Null when none; throws when YouTube couldn't be asked.
 */
async function chooseStandIn(original: Track): Promise<Choice | null> {
  const moved = await movedTrack(original);
  if (moved && box.redirectFits(original, moved)) return { track: moved, by: "redirect" };
  const alternatives = box.standInOrder(original, await findAlternatives(original, undefined, [original.id]));
  for (const a of alternatives) {
    if (await playable(a.track.id, a.track)) return { track: library.sanitizeTrack(a.track), by: "alternative" };
  }
  return null;
}

/**
 * Puts `track` in place of `oldId` in the song box, playlists, favorites and bundles (keeping sources, tags and
 * places; see `box.replaceEntry`). Every replacement goes through here, by hand or by itself.
 */
export async function replaceEverywhere(oldId: string, track: Track, by: ReplacedBy, reason?: Unplayable): Promise<{ track: Track; rows: number }> {
  await box.replaceTrack(oldId, track, { by, reason, at: Date.now() });
  const rows = await library.replaceTrack(oldId, track);
  // The video ledger's alias map makes plays, taste, radio and the map follow `oldId` to the new video.
  await ledger.recordReplaced(oldId, track, by);
  return { track: (await box.annotator())(track), rows };
}

/**
 * 「되돌리기」: the original back in place of stand-in `id`, put aside again and never replaced by itself again.
 * Playlists, favorites and bundles get it back too, unless the stand-in was a box track of its own before.
 */
export async function restore(id: string): Promise<{ track: Track; rows: number }> {
  const r = await box.restoreTrack(id, Date.now());
  if (!r) throw new HttpError(404, msg("notReplaced"));
  const rows = r.split ? 0 : await library.replaceTrack(id, r.was);
  await ledger.recordRestored(r.was.id, id);
  return { track: (await box.annotator())(r.was), rows };
}

/**
 * Why box track `id` won't play, when that is settled for now: put aside, and a stand-in was looked for lately or it
 * was put back by hand. Lets `/api/prepare` answer at once instead of asking yt-dlp and YouTube again.
 */
export async function settledAside(id: string): Promise<Unplayable | null> {
  const e = await box.boxEntry(id);
  if (!e?.blocked) return null;
  return e.keepAside || Date.now() - (e.standInAt ?? 0) < LOOK_AGAIN_MS ? e.blocked.reason : null;
}

/** One look per track at a time: a play and the check may ask together. Undefined: YouTube couldn't be asked. */
const looking = new Map<string, Promise<Choice | null | undefined>>();

/** Looks for a stand-in for `original` (which won't play for `reason`) and puts it in, or notes that there is none. */
function lookFor(original: Track, reason: Unplayable): Promise<Choice | null | undefined> {
  let job = looking.get(original.id);
  if (job) return job;
  job = (async () => {
    const choice = await chooseStandIn(original).catch(() => undefined);
    // YouTube couldn't be asked: looked at again next time.
    if (choice === undefined) return undefined;
    if (choice) await replaceEverywhere(original.id, choice.track, choice.by, reason);
    else await box.markLooked(original.id, Date.now());
    return choice;
  })().finally(() => looking.delete(original.id));
  looking.set(original.id, job);
  return job;
}

/**
 * A stand-in for `id`, which turned out not to play for `reason`, put in everywhere (see `replaceEverywhere`); null
 * when there is none (looked for at most once a day per track) or it was put back by hand.
 */
export async function standInFor(id: string, reason: Unplayable): Promise<Track | null> {
  if (await settledAside(id)) return null;
  const original = await box.findTrack(id);
  if (!original) return null;
  const choice = await lookFor(original, reason);
  return choice ? (await box.annotator())(choice.track) : null;
}

export interface FixResult {
  redirect: number;
  alternative: number;
  /** Still put aside: no stand-in plays. */
  aside: number;
  /** YouTube couldn't be asked; looked at again next time. */
  failed: number;
}

let fixing: Promise<FixResult> | null = null;

/**
 * Looks for stand-ins for every box track put aside that wasn't looked at in a day (on its own, never one put back by
 * hand), three at a time. Runs after each check of the song box and when the server starts. One run at a time.
 */
export function fixAside(): Promise<FixResult> {
  fixing ??= (async () => {
    const result: FixResult = { redirect: 0, alternative: 0, aside: 0, failed: 0 };
    const queue = await box.asideForStandIn(Date.now() - LOOK_AGAIN_MS);
    const worker = async () => {
      for (let original = queue.shift(); original; original = queue.shift()) {
        const reason = (await box.boxEntry(original.id))?.blocked?.reason;
        if (!reason) continue;
        const choice = await lookFor(original, reason);
        if (choice === undefined) result.failed++;
        else if (!choice) result.aside++;
        else result[choice.by]++;
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    return result;
  })().finally(() => (fixing = null));
  return fixing;
}

/**
 * `findPremiumOnly` asks one track at a time with a pause between, on a session of its own renewed every
 * PREMIUM_SESSION_ASKS: YouTube starts answering "try again later" to a session after several hundred quick asks.
 */
const PREMIUM_GAP_MS = 250;
const PREMIUM_SESSION_ASKS = 150;
let premiumRun: Promise<number> | null = null;

/**
 * Asks YouTube directly, for every box track not put aside, whether it plays for Music Premium members only (the
 * account's check can't tell), and puts those aside as "premium" so `fixAside` puts stand-ins in before anyone plays
 * them. About a quarter of an hour for the whole box. Skipped when the last run is more recent than `ifOlderThan`
 * (ms). Returns how many were found; one run at a time.
 */
export function findPremiumOnly(ifOlderThan = 0): Promise<number> {
  premiumRun ??= (async () => {
    const last = await box.premiumCheckedAt();
    if (last !== undefined && Date.now() - last < ifOlderThan) return 0;
    const ids = (await box.youtubeEntries()).filter((e) => !e.blocked && VIDEO_ID.test(e.track.id)).map((e) => e.track.id);
    const found: string[] = [];
    let session = await ownSession("en");
    for (const [n, id] of ids.entries()) {
      if (n > 0 && n % PREMIUM_SESSION_ASKS === 0) session = await ownSession("en");
      if (await premiumOnly(id, session)) found.push(id);
      await sleep(PREMIUM_GAP_MS);
    }
    const at = Date.now();
    if (found.length) await box.applyChecks(new Map(found.map((id): [string, Unplayable] => [id, "premium"])), at, false);
    for (const id of found) await ledger.recordPlayFailure(id, "premium", at);
    await box.markPremiumChecked(at);
    return found.length;
  })().finally(() => (premiumRun = null));
  return premiumRun;
}
