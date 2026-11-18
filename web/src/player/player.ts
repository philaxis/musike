import { create } from "zustand";
import { getT, useT } from "../i18n";
import { api, capabilities, explainStreamError, streamSource, systemMedia, type ApiError, type ErrorCode } from "../lib/api";
import { createAudio } from "../lib/audio";
import { bundleParts, bundleRow, queueRows, trackTitle } from "../lib/bundles";
import { shuffled } from "../lib/format";
import { paths } from "../lib/routes";
import { isLocal, server } from "../lib/server";
import type { Bundle, Track, Unplayable } from "../lib/types";
import { useLibrary } from "../stores/library";
import { openSettings } from "../stores/system";
import { toast, useUi } from "../stores/ui";
import { crossfadeSupported, FADE_DEFAULT, FADE_MAX, mixer, noFade } from "./crossfade";

export type Repeat = "off" | "all" | "one";
/** A code translated where it is shown (so switching languages updates it), or a server error already in the right language. */
export type StatusNote = "findingClip" | "preparingHd" | "loadingVideo" | "fetchingRadio" | { error: string };
export type Status = "idle" | "loading" | "playing" | "paused" | "error";
type Kind = "audio" | "video";
type Quality = "sd" | "hd";

interface PlayerState {
  queue: Track[];
  /** Queue order before shuffle was turned on, restored when it is turned off. */
  original: Track[] | null;
  index: number;
  status: Status;
  /** What playback is busy with (or why it failed), shown instead of the artist. See `useStatusText`. */
  statusText: StatusNote | null;
  /** Which media element is driving playback right now. */
  mediaKind: Kind;
  /** Set when Video mode is on but the current song has no music video on YouTube. */
  videoNote: "noClip" | null;
  /** Intrinsic width/height of the current video, so vertical videos get a vertical stage. */
  videoAspect: number;
  position: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  preferVideo: boolean;
  quality: Quality;
  autoRadio: boolean;
  /** Seconds the next track overlaps the end of this one in Audio mode; 0 plays them one after the other. */
  fade: number;
  /** YouTube tracks found this session not to play here (by `prepare` or their stream), with why; skipped like `blocked`. */
  unplayable: Record<string, Unplayable>;

  /**
   * Plays `tracks` from row `start`; a bundle row there starts at its part `part` (0-based). `chosen`: that row was
   * picked by hand, so a track there that won't play says why instead of being skipped.
   */
  playList: (tracks: Track[], start?: number, part?: number, chosen?: boolean) => void;
  playTrack: (track: Track) => void;
  /** Puts `track` in place of every queued `oldId` (another version of a track that won't play here). */
  replaceTrack: (oldId: string, track: Track) => void;
  /** Puts tracks right after the current one (in their order). Toast with undo. */
  playNext: (tracks: Track | Track[]) => void;
  /** Puts tracks at the end of the queue. Toast with undo. */
  addToQueue: (tracks: Track | Track[]) => void;
  /** Removes `count` queue entries from `i` (a bundle's run of parts at once). Toast with undo. */
  removeAt: (i: number, count?: number) => void;
  /** Moves the entries `start`…`end - 1` (upcoming only) to just before entry `before`. */
  moveRange: (start: number, end: number, before: number) => void;
  /** Moves past the bundle the current track is a part of. */
  skipBundle: () => void;
  jumpTo: (i: number) => void;
  clearUpcoming: () => void;
  startRadio: (track: Track) => Promise<void>;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setPreferVideo: (on: boolean) => void;
  setQuality: (q: Quality) => void;
  setAutoRadio: (on: boolean) => void;
  setFade: (seconds: number) => void;
}

// Media elements live outside React so playback survives any re-render or route change.
// On iOS this is the native player behind the same API (see lib/audio.ts).
// Audio gets two decks where crossfades work: the next track starts on the spare one while this one fades out.
const decks: HTMLMediaElement[] = crossfadeSupported ? [createAudio(), createAudio()] : [createAudio()];
let audio = decks[0];

export const videoEl = document.createElement("video");
videoEl.playsInline = true;
videoEl.preload = "auto";
videoEl.setAttribute("playsinline", "");
videoEl.className = "block h-full w-full object-contain bg-black";

const mediaFor = (k: Kind): HTMLMediaElement => (k === "video" ? videoEl : audio);

/** `offset`: the audio is a server file's sound cut out on the fly from `base` seconds on (see `playsFromOffset`). */
let loaded: { id: string; kind: Kind; quality: Quality; offset: boolean } | null = null;
let pendingSeek = 0;
let token = 0;
let recordedToken = -1;
/** Where the loaded offset stream starts in the track; 0 for every other stream. */
let base = 0;
/** A seek in an offset stream waiting for the bar to settle before the stream starts over. */
let offsetSeek: number | undefined;
/** Set while Video mode plays as audio because the page is hidden (screen off, another app). */
let backgrounded = false;
/** The deck still playing the previous track under a crossfade: where that track ends, and how long the fade is. */
let outgoing: { el: HTMLMediaElement; end: number; base: number; length: number; started: boolean; timer?: number } | null =
  null;

/**
 * A server file with a video stream, or a song cut out of an album file, plays in Audio mode as its sound alone, cut
 * out on the fly: it takes no byte ranges, so a seek starts it over at `?t=` and positions count from there. Known
 * from `prepare` (asked before a server file's first load), else from the track.
 */
const offsetAudio = new Map<string, boolean>();
const playsFromOffset = (track: Track) =>
  capabilities.serverLibrary && (offsetAudio.get(track.id) ?? (isLocal(track) && track.kind === "video"));

/** When each id was last prepared (ms): the window ahead doesn't ask again for AHEAD_FRESH_MS. */
const preparedAt = new Map<string, number>();

/** What preparing a YouTube track found out: why it won't play, or the track the server put in its place. */
type Prepare = { reason: Unplayable } | { replaced: Track } | null;

/** Resolves a track's stream ahead of time (and learns how a server file streams). Resolves to why it won't play, or its stand-in. */
function prepare(id: string): Promise<Prepare> {
  return api.prepare(id).then(
    (r) => {
      const key = r.replaced?.id ?? id;
      if (r.audioMode) offsetAudio.set(key, r.audioMode === "offset");
      preparedAt.set(key, Date.now());
      return r.replaced ? { replaced: r.replaced } : null;
    },
    (e: ApiError) => (e.code === "unplayable" && e.reason ? { reason: e.reason } : null),
  );
}

/** How long after a track starts the window ahead is filled (so it never slows that start), and how long a prepared address counts as fresh. */
const AHEAD_DELAY_MS = 4000;
const AHEAD_FRESH_MS = 5 * 60_000;
/** How many tracks after and before the current one get their address resolved (and warmed) ahead. Only the next one's audio is loaded. */
const AHEAD_NEXT = 3;
const AHEAD_PREV = 2;

/** The spare audio deck holding the head of the next track (see `preloadHead`), so it starts at once. */
let preloaded: { el: HTMLMediaElement; id: string; offset: boolean } | null = null;

/**
 * A radio from `track`, without it: alike tracks from the server's taste analysis when it knows the track (box or
 * music folder), else YouTube's radio. `alike` tells which. Local tracks and bundles have no YouTube radio.
 */
async function radioFor(track: Track): Promise<{ tracks: Track[]; alike: boolean }> {
  if (capabilities.serverLibrary && track.kind !== "bundle") {
    const r = await server.tasteRadio(track.id).catch(() => null);
    if (r?.analyzed && r.tracks.length > 1) return { tracks: r.tracks.filter((t) => t.id !== track.id), alike: true };
  }
  if (isLocal(track) || track.kind === "bundle") throw new Error(getT().taste.notAnalyzed);
  return { tracks: await api.radio(track.id), alike: false };
}

const STORAGE_KEY = "musike:player";

interface Saved {
  queue: Track[];
  original: Track[] | null;
  index: number;
  position: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  preferVideo: boolean;
  quality: Quality;
  /** Saved under a new name so earlier sessions (radio on by default) start with it off: only songs in the app play. */
  radioAfterQueue: boolean;
  fade: number;
}

function readSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Saved>;
  } catch {
    return {};
  }
}

const saved = readSaved();

/**
 * Songs from YouTube Music are "art tracks": audio with a still cover. In Video mode we play the
 * song's music video instead. Song id → video id, or null when YouTube has no clip for it.
 */
const clipFor = new Map<string, string | null>();
const clipLookups = new Map<string, Promise<string | null>>();

function lookupClip(track: Track): Promise<string | null> {
  if (track.kind === "video") return Promise.resolve(track.id);
  if (isLocal(track)) return Promise.resolve(null); // a server file has no music video on YouTube
  if (clipFor.has(track.id)) return Promise.resolve(clipFor.get(track.id)!);
  let lookup = clipLookups.get(track.id);
  if (!lookup) {
    lookup = api
      .videoFor(track)
      .then(
        (v) => {
          const id = v?.id ?? null;
          clipFor.set(track.id, id);
          return id;
        },
        () => null, // network hiccup: don't remember it, try again next time
      )
      .finally(() => clipLookups.delete(track.id));
    clipLookups.set(track.id, lookup);
  }
  return lookup;
}

const needsClipLookup = (track: Track, preferVideo: boolean) =>
  preferVideo && track.kind === "song" && !isLocal(track) && !clipFor.has(track.id);

/**
 * Each of `tracks` as what it plays: a bundle row becomes its parts (lib/bundles.ts), anything else itself. Bundles the
 * library doesn't know yet (a /play/<id> link opened before it loaded) are fetched first.
 */
function withParts(tracks: Track[], then: (rows: Track[][]) => void) {
  const known = new Map<string, Bundle>((useLibrary.getState().bundles ?? []).map((b) => [b.id, b]));
  const missing = [...new Set(tracks.filter((t) => t.kind === "bundle" && !known.has(t.id)).map((t) => t.id))];
  const expand = () => then(tracks.map((t) => (t.kind !== "bundle" ? [t] : known.has(t.id) ? bundleParts(known.get(t.id)!) : [])));
  if (!missing.length) return expand();
  Promise.all(missing.map((id) => server.bundle(id))).then(
    (found) => {
      for (const b of found) known.set(b.id, b);
      expand();
    },
    (e: Error) => toast(e.message, "error"),
  );
}

export const usePlayer = create<PlayerState>((set, get, store) => {
  const kindFor = (track: Track): Kind =>
    !backgrounded && capabilities.video && get().preferVideo && (track.kind === "video" || !!clipFor.get(track.id))
      ? "video"
      : "audio";
  /** The YouTube id to stream: the song itself, or its music video in Video mode. */
  const mediaIdFor = (track: Track, kind: Kind) =>
    kind === "video" && track.kind !== "video" ? clipFor.get(track.id)! : track.id;
  const noteFor = (track: Track) =>
    get().preferVideo && track.kind === "song" && clipFor.get(track.id) === null ? ("noClip" as const) : null;
  const activeMedia = (): HTMLMediaElement | null => (loaded ? mediaFor(loaded.kind) : null);

  function play(media: HTMLMediaElement) {
    mixer.resume();
    media.play().catch((err: DOMException) => {
      if (err.name === "AbortError") return; // src changed mid-start
      if (err.name === "NotAllowedError") set({ status: "paused" }); // autoplay blocked
    });
  }

  /** Why a queued track won't play here: the server's mark, or what this session found out. */
  const blockedReason = (track: Track): Unplayable | undefined => track.blocked ?? get().unplayable[track.id];
  /**
   * A YouTube track the server put aside that this session hasn't asked about yet: preparing it may bring a stand-in
   * (another version the server puts in its place), so it is asked before it is skipped.
   */
  const unasked = (track: Track) => capabilities.serverLibrary && !!track.blocked && !isLocal(track) && !get().unplayable[track.id];
  const skippable = (track: Track) => !!track.unavailable || (!!blockedReason(track) && !unasked(track));

  /** A track picked by hand that won't play: why, in plain words, and (for a YouTube track) other versions to try. */
  function explain(track: Track, reason: Unplayable) {
    const t = getT().aside;
    const find = isLocal(track) || !capabilities.serverLibrary ? undefined : { label: t.findOther, run: () => useUi.getState().openAlternatives(track) };
    toast(t.chosen(track.title, t.why[reason]), "info", find);
  }

  // Tracks skipped in a row are told in one quiet line.
  let skipped: Unplayable[] = [];
  let skippedTimer: number | undefined;
  function noteSkipped(reason: Unplayable) {
    skipped.push(reason);
    clearTimeout(skippedTimer);
    skippedTimer = window.setTimeout(() => {
      const t = getT().aside;
      const what = new Set(skipped).size === 1 ? t.kind[skipped[0]] : t.kind.any;
      toast(t.skipped(what, skipped.length));
      skipped = [];
    }, 1200);
  }

  function markUnplayable(id: string, reason: Unplayable) {
    if (get().unplayable[id] !== reason) set((s) => ({ unplayable: { ...s.unplayable, [id]: reason } }));
  }

  /** Stand-ins put in this session that haven't started yet: a short note says so when they do. */
  const switched = new Set<string>();

  /** The server put `track` in place of `oldId` (which won't play here): the queue, open lists and the library follow. */
  function takeStandIn(oldId: string, track: Track) {
    switched.add(track.id);
    get().replaceTrack(oldId, track);
    useUi.getState().noteReplaced(oldId, track);
    void useLibrary.getState().load();
  }

  /** Asks the server about `track` (see `unasked`): its stand-in, or why it won't play. Then `then`. */
  function ask(track: Track, then: () => void) {
    void prepare(track.id).then((out) => {
      if (out && "replaced" in out) takeStandIn(track.id, out.replaced);
      else markUnplayable(track.id, out?.reason ?? track.blocked!);
      then();
    });
  }

  /** The token of the load the user picked by hand (a row, the queue): its failure is explained, not skipped. */
  let chosenToken = -1;

  function load(index: number, opts: { autoplay?: boolean; startAt?: number; dir?: 1 | -1; fade?: boolean; chosen?: boolean } = {}) {
    const s = get();
    const track = s.queue[index];
    if (!track) return;
    if (unasked(track)) {
      const mine = ++token;
      if (!opts.fade) {
        set({ index, status: "loading", statusText: null, videoNote: null, position: 0, duration: track.duration, buffered: 0 });
        activeMedia()?.pause();
      }
      return ask(track, () => mine === token && load(index, opts));
    }
    if (switched.delete(track.id)) toast(getT().aside.switched(track.title));
    const reason = blockedReason(track);
    if (opts.chosen && reason) return explain(track, reason);
    clearTimeout(offsetSeek);
    offsetSeek = undefined;
    if (!opts.fade) cutFade();

    // A server file that is gone (or whose drive isn't mounted), or a YouTube video that won't play here: skip it
    // quietly, the way playback is going.
    if (skippable(track)) {
      const step = opts.dir ?? 1;
      let next = index;
      for (; s.queue[next] && skippable(s.queue[next]); next += step) {
        const why = blockedReason(s.queue[next]);
        if (why) noteSkipped(why);
      }
      if (s.queue[next]) return load(next, { autoplay: opts.autoplay, dir: step });
      activeMedia()?.pause();
      set({ index, status: "paused", statusText: null, position: 0, duration: track.duration });
      if (!reason) toast(getT().player.unavailable(track.title), "error");
      return;
    }

    // Video mode on a song: find its music video first, then load whichever fits.
    if (needsClipLookup(track, s.preferVideo)) {
      const mine = ++token;
      set({
        index,
        status: "loading",
        statusText: "findingClip",
        videoNote: null,
        position: opts.startAt ?? 0,
        duration: track.duration,
        buffered: 0,
      });
      activeMedia()?.pause();
      setMetadata(track);
      void lookupClip(track).then(() => mine === token && load(index, opts));
      return;
    }

    // Whether a server file streams with byte ranges or from an offset comes from `prepare`: ask before its first load.
    if (capabilities.serverLibrary && isLocal(track) && !offsetAudio.has(track.id)) {
      const mine = ++token;
      if (!opts.fade) {
        set({ index, status: "loading", statusText: null, videoNote: null, position: opts.startAt ?? 0, duration: track.duration, buffered: 0 });
        activeMedia()?.pause();
      }
      void prepare(track.id).then(() => {
        if (!offsetAudio.has(track.id)) offsetAudio.set(track.id, track.kind === "video");
        if (mine === token) load(index, opts);
      });
      return;
    }

    const kind = kindFor(track);
    const offset = kind === "audio" && playsFromOffset(track);
    const startAt = offset ? Math.floor(opts.startAt ?? 0) : 0;
    // The head of this track already waits on the spare deck (`preloadHead`): play that deck rather than load again.
    const head = kind === "audio" && preloaded?.id === track.id && preloaded.offset === offset && startAt === 0 ? preloaded.el : null;
    if (head && head !== audio) {
      // Not in a crossfade (that switched decks already): the deck that played stops, the waiting one takes over.
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio = head;
      mixer.set(audio, 1);
    }
    const media = mediaFor(kind);
    // Used now, or about to be overwritten by this load.
    if (preloaded && (head || preloaded.el === media)) preloaded = null;
    const other = mediaFor(kind === "video" ? "audio" : "video");
    other.pause();
    if (other.getAttribute("src")) {
      other.removeAttribute("src");
      other.load();
    }

    token++;
    if (opts.chosen) chosenToken = token;
    base = startAt;
    loaded = { id: track.id, kind, quality: s.quality, offset };
    pendingSeek = offset ? 0 : (opts.startAt ?? 0);
    const autoplay = opts.autoplay !== false;
    set({
      index,
      mediaKind: kind,
      status: autoplay ? "loading" : "paused",
      // Video may need a server-side download first (HD, or videos without a combined SD stream).
      statusText: kind === "video" ? (s.quality === "hd" ? "preparingHd" : "loadingVideo") : null,
      videoNote: noteFor(track),
      position: offset ? base : pendingSeek,
      // A waiting deck has its metadata already (its `loadedmetadata` came while it wasn't the active one).
      duration: head && Number.isFinite(head.duration) && !offset ? head.duration : track.duration,
      buffered: head?.buffered.length ? head.buffered.end(head.buffered.length - 1) : 0,
    });
    if (kind === "audio" && s.fade > 0) connectMixer();
    applyVolume();
    if (head) {
      if (pendingSeek > 0 && head.readyState > 0) {
        head.currentTime = pendingSeek;
        pendingSeek = 0;
      }
      if (autoplay) play(head);
      setMetadata(track);
      return;
    }
    const start = (src: string) => {
      media.src = offset && base > 0 ? `${src}${src.includes("?") ? "&" : "?"}t=${base}` : src;
      if (autoplay) play(media);
    };
    // The server's proxy URL is known right away; on Android the stream is first resolved on the phone.
    const source = streamSource(mediaIdFor(track, kind), kind, s.quality);
    if (typeof source === "string") start(source);
    else {
      const mine = token;
      source.then(
        (src) => mine === token && start(src),
        (err: ApiError) => mine === token && report(err.message, err.code, err.reason),
      );
    }
    setMetadata(track);
  }

  // The window around the current track (see AHEAD_DELAY_MS): the next AHEAD_NEXT tracks' and previous AHEAD_PREV
  // tracks' addresses resolved, and in Audio mode with a spare deck the head of the next one loaded there.

  let aheadTimer: number | undefined;
  let aheadRun = 0;
  /** When the current track started playing (ms). */
  let startedAt = 0;

  function scheduleAhead(ms: number) {
    clearTimeout(aheadTimer);
    aheadTimer = window.setTimeout(() => void runAhead(), ms);
  }

  /** Queue positions that play after (dir 1) or before (dir -1) `index`, the way playback goes (wrapping on repeat-all), skipping those that won't play. */
  function neighbors(index: number, count: number, dir: 1 | -1 = 1): number[] {
    const s = get();
    const n = s.queue.length;
    const out: number[] = [];
    for (let k = 1; k < n && out.length < count; k++) {
      const raw = index + dir * k;
      const i = raw >= 0 && raw < n ? raw : s.repeat === "all" ? (raw + n) % n : -1;
      if (i < 0) break;
      if (!skippable(s.queue[i])) out.push(i);
    }
    return out;
  }

  async function runAhead() {
    // Before the current track plays, `onStarted` runs this again.
    if (!loaded || recordedToken !== token) return;
    const mine = ++aheadRun;
    const s = get();
    const [next, ...later] = neighbors(s.index, AHEAD_NEXT);
    for (const i of [next, ...later]) {
      if (i === undefined) continue;
      const ok = await warm(s.queue[i]);
      if (mine !== aheadRun) return;
      // It won't play: `markUnplayable` moved the window past it (a new run).
      if (!ok) return;
      if (i === next) preloadHead(get().queue[i]);
    }
    for (const i of neighbors(s.index, AHEAD_PREV, -1)) {
      await warm(s.queue[i]);
      if (mine !== aheadRun) return;
    }
  }

  /**
   * Resolves a track's address unless it was lately (in Video mode, its clip's). False when it turned out not to play;
   * a stand-in the server put in its place takes its place in the queue.
   */
  async function warm(track: Track): Promise<boolean> {
    const id = get().preferVideo ? ((await lookupClip(track)) ?? track.id) : track.id;
    if (Date.now() - (preparedAt.get(id) ?? 0) < AHEAD_FRESH_MS) return true;
    const out = await prepare(id);
    if (out && "replaced" in out && id === track.id) {
      takeStandIn(track.id, out.replaced);
      return true;
    }
    const reason = out && "reason" in out && id === track.id ? out.reason : unasked(track) ? track.blocked : undefined;
    if (!reason) return true;
    markUnplayable(track.id, reason);
    return false;
  }

  /**
   * Loads the start of `track` on the spare audio deck without playing it: the browser buffers its head (Firefox up to
   * a minute, Chrome a few MB) and `load` switches to that deck. Only with two decks, in Audio mode, and not while a
   * crossfade still plays on the spare deck (`stopOutgoing` runs the window again).
   */
  function preloadHead(track: Track) {
    const s = get();
    if (decks.length < 2 || s.preferVideo || outgoing || kindFor(track) !== "audio") return;
    const spare = decks.find((d) => d !== audio)!;
    const offset = playsFromOffset(track);
    if (preloaded?.el === spare && preloaded.id === track.id && preloaded.offset === offset) return;
    const src = streamSource(track.id, "audio", s.quality);
    if (typeof src !== "string") return;
    preloaded = { el: spare, id: track.id, offset };
    spare.src = src;
  }

  // A new next track (queue edited, shuffle, repeat, a track found not to play): fill the window again, but not
  // sooner than AHEAD_DELAY_MS into the current track.
  store.subscribe((s, prev) => {
    if (s.queue === prev.queue && s.index === prev.index && s.repeat === prev.repeat && s.preferVideo === prev.preferVideo && s.unplayable === prev.unplayable) return;
    scheduleAhead(Math.max(800, startedAt + AHEAD_DELAY_MS - Date.now()));
  });

  async function continueWithRadio() {
    const s = get();
    const last = s.queue[s.index];
    if (!last) return;
    set({ status: "loading", statusText: "fetchingRadio" });
    try {
      const known = new Set(get().queue.map((t) => t.id));
      const more = (await radioFor(last)).tracks.filter((t) => !known.has(t.id)).slice(0, 25);
      if (!more.length) throw new Error("empty");
      set((st) => ({
        queue: [...st.queue, ...more],
        original: st.original ? [...st.original, ...more] : null,
      }));
      toast(getT().player.radioContinuing(last.title));
      load(get().index + 1);
    } catch {
      set({ status: "paused", statusText: null, position: 0 });
    }
  }

  function onStarted() {
    const s = get();
    const track = s.queue[s.index];
    if (!track || recordedToken === token) return;
    recordedToken = token;
    // A bundle goes into the history as its row, not as the part that happens to start.
    const bundle = track.part && useLibrary.getState().bundles?.find((b) => b.id === track.part!.bundle);
    useLibrary.getState().recordPlay(bundle ? bundleRow(bundle) : track);
    startedAt = Date.now();
    scheduleAhead(AHEAD_DELAY_MS);
  }

  function onEnded() {
    const s = get();
    if (s.repeat === "one") {
      if (loaded?.offset) return load(s.index);
      const media = activeMedia();
      if (media) {
        media.currentTime = 0;
        play(media);
      }
      return;
    }
    if (s.index < s.queue.length - 1) return load(s.index + 1);
    if (s.repeat === "all" && s.queue.length) return load(0);
    if (s.autoRadio) return void continueWithRadio();
    set({ status: "paused", position: 0 });
  }

  /**
   * Near the end of a track in Audio mode, starts the next one on the spare deck so the two overlap. Not on repeat-one,
   * into Video mode, or between tracks of one local album; the end of the queue goes on as before (radio, stop).
   */
  function maybeCrossfade(at: number) {
    const s = get();
    const left = s.duration - at;
    if (!(left <= s.fade) || left < 1 || s.status !== "playing" || loaded?.kind !== "audio" || s.repeat === "one") return;
    if (!mixer.running()) return;
    const index = s.index < s.queue.length - 1 ? s.index + 1 : s.repeat === "all" ? 0 : -1;
    const current = s.queue[s.index];
    const next = s.queue[index];
    if (!current || !next || index === s.index || skippable(next) || noFade(current, next)) return;
    if (needsClipLookup(next, s.preferVideo) || kindFor(next) !== "audio") return;
    startCrossfade(index, left);
  }

  /** The next track becomes the current one now (bar, lock screen); its deck stays silent until it starts playing. */
  function startCrossfade(index: number, left: number) {
    stopOutgoing();
    const from = audio;
    const to = decks.find((d) => d !== from);
    if (!to) return;
    mixer.set(to, 0);
    outgoing = { el: from, end: get().duration, base, length: left, started: false };
    audio = to;
    load(index, { fade: true });
  }

  /** The incoming track is audible: ramp both decks over what is left of the outgoing one. */
  function beginFade() {
    const o = outgoing;
    if (!o) return;
    o.started = true;
    const seconds = Math.max(0.3, Math.min(o.length, o.end - (o.base + o.el.currentTime)));
    mixer.fade(audio, o.el, seconds);
    // Only tidies up: the outgoing deck is silent by then, and it stops by itself when its track ends.
    o.timer = window.setTimeout(() => outgoing === o && stopOutgoing(), (seconds + 0.5) * 1000);
  }

  /** Stops the previous track's deck. Before the fade began the new track is still silent: bring it up. */
  function stopOutgoing() {
    const o = outgoing;
    if (!o) return;
    outgoing = null;
    clearTimeout(o.timer);
    o.el.pause();
    o.el.removeAttribute("src");
    o.el.load();
    if (!o.started) mixer.set(audio, 1);
    // The spare deck is free again: the next track's head can wait there.
    scheduleAhead(500);
  }

  /** Ends a crossfade at once (pause, skip, another track): only the current track plays, at full level. */
  function cutFade() {
    stopOutgoing();
    mixer.set(audio, 1);
  }

  /**
   * Shows why a track can't play, then moves on (unless every track would fail the same way). A video that won't play
   * here is skipped at once with a quiet line, or explained when it was picked by hand.
   */
  function report(message: string, code?: ErrorCode, reason?: Unplayable) {
    const mine = token;
    const track = get().queue[get().index];
    if (code === "unplayable" && reason && track) {
      const giveUp = () => {
        markUnplayable(track.id, reason);
        set({ status: "paused", statusText: null });
        if (chosenToken === mine) return explain(track, reason);
        noteSkipped(reason);
        get().next();
      };
      if (!capabilities.serverLibrary || isLocal(track)) return giveUp();
      // The server may have a stand-in for it: play that instead.
      set({ status: "loading", statusText: null });
      void prepare(track.id).then((out) => {
        if (mine !== token) return;
        if (!out || !("replaced" in out)) return giveUp();
        takeStandIn(track.id, out.replaced);
        load(get().index, { chosen: chosenToken === mine });
      });
      return;
    }
    set({ status: "error", statusText: { error: message } });
    // Tool problems hit every track: offer the fix instead of skipping through the whole queue.
    const toolProblem = code === "tool_missing" || code === "maybe_outdated";
    const t = getT();
    toast(
      t.player.cantPlay(track?.title ?? t.player.aTrack, message),
      "error",
      toolProblem ? { label: code === "tool_missing" ? t.common.install : t.common.update, run: openSettings } : undefined,
    );
    if (code !== "tool_missing" && get().index < get().queue.length - 1) {
      setTimeout(() => mine === token && get().next(), 2500);
    }
  }

  // A stream URL that expired mid-song gets one fresh try from the same spot before giving up.
  let retriedToken = -1;

  function onError(media: HTMLMediaElement) {
    const mine = token;
    const url = media.currentSrc || media.src;
    if (capabilities.retryOnError && retriedToken !== mine) {
      const at = media.currentTime || get().position;
      load(get().index, { startAt: at, autoplay: true });
      retriedToken = token;
      return;
    }
    set({ status: "error" });
    explainStreamError(url).then(({ message, code, reason }) => {
      if (mine === token) report(message, code, reason);
    });
  }

  function wire(media: HTMLMediaElement) {
    const isActive = () => activeMedia() === media;
    media.addEventListener("loadedmetadata", () => {
      if (!isActive()) return;
      if (pendingSeek > 0) {
        media.currentTime = pendingSeek;
        pendingSeek = 0;
      }
      // An offset stream only knows the rest of the track; the track's own length stands.
      if (Number.isFinite(media.duration) && !loaded?.offset) set({ duration: media.duration });
      if (media === videoEl && videoEl.videoWidth && videoEl.videoHeight) {
        set({ videoAspect: videoEl.videoWidth / videoEl.videoHeight });
      }
      syncPositionState();
    });
    media.addEventListener("durationchange", () => {
      if (isActive() && Number.isFinite(media.duration) && !loaded?.offset) set({ duration: media.duration });
    });
    media.addEventListener("playing", () => {
      if (!isActive()) return;
      if (outgoing && !outgoing.started) beginFade();
      set({ status: "playing", statusText: null });
      onStarted();
      syncPlaybackState();
    });
    media.addEventListener("pause", () => {
      if (!isActive() || media.ended || get().status === "loading" || get().status === "error") return;
      set({ status: "paused" });
      syncPlaybackState();
    });
    media.addEventListener("waiting", () => {
      if (isActive() && !media.paused) set({ status: "loading" });
    });
    media.addEventListener("timeupdate", () => {
      if (!isActive() || pendingSeek > 0 || offsetSeek !== undefined) return;
      const at = base + media.currentTime;
      if (Math.abs(at - get().position) >= 0.2) set({ position: at });
      syncSystemMedia(); // throttled on the other side
      maybeCrossfade(at);
    });
    media.addEventListener("progress", () => {
      if (!isActive() || !media.buffered.length) return;
      set({ buffered: base + media.buffered.end(media.buffered.length - 1) });
    });
    media.addEventListener("seeked", () => isActive() && syncPositionState());
    media.addEventListener("ended", () => {
      if (isActive()) onEnded();
      else if (outgoing?.el === media) stopOutgoing();
    });
    media.addEventListener("error", () => {
      // The next track's head failed to load on the spare deck: drop it, its turn loads (and reports) as usual.
      if (preloaded?.el === media) {
        preloaded = null;
        media.removeAttribute("src");
        media.load();
      } else if (isActive() && media.getAttribute("src")) onError(media);
    });
  }
  for (const deck of decks) wire(deck);
  wire(videoEl);

  /** A toast's undo for tracks just queued: takes those very entries out again (not the one playing). */
  const undoTakeOut = (entries: Track[]) => ({
    label: getT().basics.undo,
    run: () => {
      const s = get();
      const current = s.queue[s.index];
      const out = new Set(entries.filter((t) => t !== current));
      const queue = s.queue.filter((t) => !out.has(t));
      set({ queue, original: s.original?.filter((t) => !out.has(t)) ?? null, index: Math.max(0, queue.indexOf(current)) });
    },
  });

  const reloadIfKindChanged = () => {
    const s = get();
    const track = s.queue[s.index];
    if (!track) return;
    set({ videoNote: noteFor(track) });
    if (!loaded || loaded.id !== track.id) return;
    const wasPlaying = s.status === "playing" || s.status === "loading";
    if (needsClipLookup(track, s.preferVideo)) return load(s.index, { startAt: s.position, autoplay: wasPlaying });
    const kind = kindFor(track);
    if (loaded.kind === kind && (kind === "audio" || loaded.quality === s.quality)) return;
    load(s.index, { startAt: s.position, autoplay: wasPlaying });
  };

  // A hidden page stops video on phones (screen off, another app): carry on as audio, and bring the video back on return.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      const { status } = get();
      if (loaded?.kind !== "video" || document.pictureInPictureElement || (status !== "playing" && status !== "loading")) return;
      backgrounded = true;
    } else if (backgrounded) backgrounded = false;
    else return;
    reloadIfKindChanged();
  });

  return {
    queue: saved.queue ?? [],
    original: saved.original ?? null,
    index: saved.index ?? 0,
    status: saved.queue?.length ? "paused" : "idle",
    statusText: null,
    mediaKind: "audio",
    videoNote: null,
    videoAspect: 16 / 9,
    position: saved.position ?? 0,
    duration: saved.queue?.[saved.index ?? 0]?.duration ?? 0,
    buffered: 0,
    volume: saved.volume ?? 0.9,
    muted: saved.muted ?? false,
    shuffle: saved.shuffle ?? false,
    repeat: saved.repeat ?? "off",
    // Builds without video (Android) always play audio, whatever a backup or an old session says.
    preferVideo: capabilities.video && (saved.preferVideo ?? false),
    quality: saved.quality ?? "sd",
    autoRadio: saved.radioAfterQueue ?? false,
    fade: saved.fade ?? FADE_DEFAULT,
    unplayable: {},

    playList: (tracks, start = 0, part = 0, chosen = false) => {
      if (!tracks.length) return;
      withParts(tracks, (rows) => {
        const at = rows[start]?.length ? start : 0;
        const all = rows.flat();
        if (!all.length) return;
        const from = Math.min(part, rows[at].length - 1);
        // Picked by hand and won't play: say why, and leave the queue as it is.
        const why = chosen && !unasked(rows[at][from]) && blockedReason(rows[at][from]);
        if (why) return explain(rows[at][from], why);
        if (get().shuffle) {
          // Bundles stay whole: rows are shuffled, never the parts inside one.
          const rest = rows.filter((_, i) => i !== at);
          set({ queue: [...rows[at].slice(from), ...shuffled(rest).flat()], original: all });
          load(0, { chosen: chosen && unasked(rows[at][from]) });
        } else {
          set({ queue: all, original: null });
          load(rows.slice(0, at).reduce((n, r) => n + r.length, 0) + from, { chosen: chosen && unasked(rows[at][from]) });
        }
      });
    },

    playTrack: (track) => {
      const s = get();
      const why = !unasked(track) && blockedReason(track);
      if (why) return explain(track, why);
      const at = s.queue.findIndex((t) => t.id === track.id || (t.part?.bundle === track.id && t.part.n === 1));
      if (at >= 0) return load(at, { chosen: true });
      if (!s.queue.length) return get().playList([track]);
      withParts([track], ([parts]) => {
        const st = get();
        const insert = st.index + 1;
        set({
          queue: [...st.queue.slice(0, insert), ...parts, ...st.queue.slice(insert)],
          original: st.original ? [...st.original, ...parts] : null,
        });
        load(insert, { chosen: true });
      });
    },

    playNext: (input) => {
      const tracks = Array.isArray(input) ? input : [input];
      if (!tracks.length) return;
      if (!get().queue.length) return get().playList(tracks);
      withParts(tracks, (rows) => {
        // Fresh entries, so undo takes out these and not an equal track queued before.
        const parts = rows.flat().map((t) => ({ ...t }));
        const s = get();
        const insert = s.index + 1;
        set({
          queue: [...s.queue.slice(0, insert), ...parts, ...s.queue.slice(insert)],
          original: s.original ? [...s.original, ...parts] : null,
        });
        const t = getT();
        toast(tracks.length === 1 ? t.player.playsNext(tracks[0].title) : t.basics.playsNextMany(tracks.length), "info", undoTakeOut(parts));
      });
    },

    addToQueue: (input) => {
      const tracks = Array.isArray(input) ? input : [input];
      if (!tracks.length) return;
      if (!get().queue.length) return get().playList(tracks);
      withParts(tracks, (rows) => {
        const parts = rows.flat().map((t) => ({ ...t }));
        const s = get();
        set({ queue: [...s.queue, ...parts], original: s.original ? [...s.original, ...parts] : null });
        const t = getT();
        toast(tracks.length === 1 ? t.player.addedToQueue(tracks[0].title) : t.basics.addedToQueueMany(tracks.length), "info", undoTakeOut(parts));
      });
    },

    removeAt: (i, count = 1) => {
      const s = get();
      if (i < 0 || i >= s.queue.length) return;
      const end = Math.min(s.queue.length, i + count);
      const cut = s.queue.slice(i, end);
      const removed = new Set(cut);
      const queue = [...s.queue.slice(0, i), ...s.queue.slice(end)];
      const original = s.original?.filter((t) => !removed.has(t)) ?? null;
      if (end <= s.index) return set({ queue, original, index: s.index - (end - i) });
      if (i > s.index) {
        set({ queue, original });
        // Undo puts them back where they were, or right after the current track if that moved past them.
        return toast(getT().basics.removedFromQueue(trackTitle(cut[0])), "info", {
          label: getT().basics.undo,
          run: () => {
            const st = get();
            const at = Math.max(st.index + 1, Math.min(i, st.queue.length));
            set({ queue: [...st.queue.slice(0, at), ...cut, ...st.queue.slice(at)], original: st.original ? [...st.original, ...cut] : null });
          },
        });
      }
      // Removing the current track: move on to whatever takes its place.
      set({ queue, original });
      if (queue[i]) load(i, { autoplay: s.status === "playing" });
      else {
        cutFade();
        activeMedia()?.pause();
        loaded = null;
        set({ index: Math.max(0, queue.length - 1), status: queue.length ? "paused" : "idle", position: 0 });
      }
    },

    moveRange: (start, end, before) => {
      const s = get();
      // Only what comes next moves: the current track and the ones played stay put.
      if (start <= s.index || end > s.queue.length || before <= s.index || (before >= start && before <= end)) return;
      const block = s.queue.slice(start, end);
      const rest = [...s.queue.slice(0, start), ...s.queue.slice(end)];
      rest.splice(before > start ? before - block.length : before, 0, ...block);
      set({ queue: rest });
    },

    skipBundle: () => {
      const s = get();
      const row = queueRows(s.queue).find((r) => r.start <= s.index && s.index < r.end);
      if (!row || !s.queue[s.index]?.part) return get().next();
      if (row.end < s.queue.length) return load(row.end);
      if (s.repeat === "all") return load(0);
      // Nothing after the bundle: carry on from its last part the way the end of the queue does.
      set({ index: row.end - 1 });
      if (s.autoRadio) return void continueWithRadio();
      cutFade();
      activeMedia()?.pause();
      set({ status: "paused", position: 0 });
    },

    jumpTo: (i) => load(i, { chosen: true }),

    replaceTrack: (oldId, track) =>
      set((s) => {
        // One new entry per old one: shuffle matches `queue` and `original` entries by identity.
        const fresh = new Map<Track, Track>();
        const swap = (list: Track[]) =>
          list.map((t) => {
            if (t.id !== oldId) return t;
            if (!fresh.has(t)) fresh.set(t, { ...track, ...(t.part ? { part: t.part } : {}) });
            return fresh.get(t)!;
          });
        return { queue: swap(s.queue), original: s.original && swap(s.original) };
      }),

    clearUpcoming: () => {
      const s = get();
      const keep = s.queue.slice(0, s.index + 1);
      const cut = s.queue.slice(s.index + 1);
      set({ queue: keep, original: s.original ? keep.slice() : null });
      if (!cut.length) return;
      toast(getT().basics.queueCleared(cut.length), "info", {
        label: getT().basics.undo,
        run: () => {
          const st = get();
          set({ queue: [...st.queue, ...cut], original: st.original ? [...st.original, ...cut] : null });
        },
      });
    },

    startRadio: async (track) => {
      toast(getT().player.startingRadio(track.title));
      try {
        const { tracks, alike } = await radioFor(track);
        get().playList([track, ...tracks.filter((t) => t.id !== track.id)], 0);
        // The alike-tracks radio is a list of its own too: open it to save it as a playlist.
        if (alike) toast(getT().taste.radioReady(track.title), "info", { label: getT().taste.showList, to: paths.tasteRadio(track.id) });
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },

    toggle: () => {
      const s = get();
      const track = s.queue[s.index];
      if (!track) return;
      const kind = kindFor(track);
      const stale =
        !loaded ||
        loaded.id !== track.id ||
        loaded.kind !== kind ||
        (kind === "video" && loaded.quality !== s.quality) ||
        needsClipLookup(track, s.preferVideo);
      if (stale || s.status === "error") return load(s.index, { startAt: s.position });
      const media = mediaFor(kind);
      if (media.paused) play(media);
      else {
        cutFade();
        media.pause();
      }
    },

    next: () => {
      const s = get();
      if (s.index < s.queue.length - 1) return load(s.index + 1);
      if (s.repeat === "all" && s.queue.length) return load(0);
      if (s.autoRadio) void continueWithRadio();
    },

    prev: () => {
      const s = get();
      if (s.position > 3 || s.index === 0) return get().seek(0);
      load(s.index - 1, { dir: -1 });
    },

    seek: (seconds) => {
      const t = Math.max(0, Math.min(seconds, get().duration || seconds));
      set({ position: t });
      const media = activeMedia();
      const track = get().queue[get().index];
      if (media && track && loaded?.offset && loaded.id === track.id) {
        // This stream can't seek: start it over from there once the bar stops moving.
        const resume = !media.paused || get().status === "loading";
        clearTimeout(offsetSeek);
        offsetSeek = window.setTimeout(() => {
          offsetSeek = undefined;
          load(get().index, { startAt: t, autoplay: resume });
        }, 250);
        return;
      }
      if (!media || !track || loaded?.id !== track.id || media.readyState === 0) {
        pendingSeek = t;
        return;
      }
      media.currentTime = t;
    },

    setVolume: (v) => {
      const volume = Math.max(0, Math.min(1, v));
      set({ volume, muted: volume === 0 });
      applyVolume();
    },

    toggleMute: () => {
      const muted = !get().muted;
      if (!muted && get().volume === 0) return get().setVolume(0.6);
      set({ muted });
      applyVolume();
    },

    toggleShuffle: () => {
      const s = get();
      const current = s.queue[s.index];
      if (!s.shuffle) {
        // Rows, not tracks: a bundle's parts stay together, the current one's first.
        const rows = queueRows(s.queue).map((r) => s.queue.slice(r.start, r.end));
        const at = rows.findIndex((r) => r.includes(current!));
        const head = rows[at] ?? [];
        const rest = shuffled(rows.filter((_, i) => i !== at)).flat();
        set({ shuffle: true, original: s.queue, queue: [...head, ...rest], index: Math.max(0, head.indexOf(current!)) });
        return;
      }
      const present = new Set(s.queue);
      const base = (s.original ?? s.queue).filter((t) => present.has(t));
      const extra = s.queue.filter((t) => !base.includes(t));
      const queue = [...base, ...extra];
      set({ shuffle: false, original: null, queue, index: Math.max(0, current ? queue.indexOf(current) : 0) });
    },

    cycleRepeat: () => {
      const order: Repeat[] = ["off", "all", "one"];
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
    },

    setPreferVideo: (on) => {
      if (on && !capabilities.video) return;
      set({ preferVideo: on });
      reloadIfKindChanged();
    },

    setQuality: (quality) => {
      set({ quality });
      reloadIfKindChanged();
    },

    setAutoRadio: (autoRadio) => set({ autoRadio }),

    setFade: (seconds) => {
      const fade = Math.max(0, Math.min(FADE_MAX, Math.round(seconds)));
      set({ fade });
      if (fade > 0 && loaded?.kind === "audio") {
        connectMixer();
        applyVolume();
      }
    },
  };
});

/** Volume and mute: on the elements, or on the mixer once the audio decks play through it (each deck stays at full). */
function applyVolume() {
  const { volume, muted } = usePlayer.getState();
  const mixed = mixer.connected();
  videoEl.volume = volume;
  videoEl.muted = muted;
  for (const deck of decks) {
    deck.volume = mixed ? 1 : volume;
    deck.muted = mixed ? false : muted;
  }
  mixer.setVolume(muted ? 0 : volume);
}

/** Routes the audio decks through the mixer once crossfades are on (see crossfade.ts). */
function connectMixer() {
  if (crossfadeSupported && !mixer.connected()) mixer.connect(decks);
}

applyVolume();

export const selectCurrent = (s: PlayerState): Track | null => s.queue[s.index] ?? null;

/** Whether the track can be shown as video (art tracks are audio with a still image). */

// Persistence: resume the same queue and position after a reload.

function persist() {
  const s = usePlayer.getState();
  const data: Saved = {
    queue: s.queue.slice(0, 500),
    original: s.original?.slice(0, 500) ?? null,
    index: s.index,
    position: s.position,
    volume: s.volume,
    muted: s.muted,
    shuffle: s.shuffle,
    repeat: s.repeat,
    preferVideo: s.preferVideo,
    quality: s.quality,
    radioAfterQueue: s.autoRadio,
    fade: s.fade,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked */
  }
}
setInterval(persist, 4000);
addEventListener("pagehide", persist);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && persist());

// Media Session: lock-screen, headset and notification controls.

function setMetadata(track: Track) {
  const title = trackTitle(track);
  systemMedia?.setTrack({ title, artist: track.artist, album: track.album ?? "", artwork: track.art || track.thumb });
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: track.artist,
    album: track.album ?? "",
    artwork:
      track.kind === "video"
        ? [
            { src: track.art, sizes: "1280x720", type: "image/jpeg" },
            { src: track.thumb, sizes: "320x180", type: "image/jpeg" },
          ]
        : [{ src: track.art, sizes: "544x544", type: "image/jpeg" }],
  });
}

/** The phone's notification and lock screen. A track that is loading is about to play, so it counts as playing:
 *  reporting a pause between tracks would let Android stop the app in the background. */
function syncSystemMedia() {
  if (!systemMedia) return;
  const { status, position, duration } = usePlayer.getState();
  systemMedia.setState({ playing: status === "playing" || status === "loading", position, duration });
}

function syncPlaybackState() {
  syncSystemMedia();
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = usePlayer.getState().status === "playing" ? "playing" : "paused";
  syncPositionState();
}

function syncPositionState() {
  syncSystemMedia();
  const { duration, position } = usePlayer.getState();
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 });
  } catch {
    /* some browsers reject transient states */
  }
}

if (systemMedia) {
  const p = () => usePlayer.getState();
  systemMedia.onAction((action, position) => {
    if (action === "play" && p().status !== "playing") p().toggle();
    else if (action === "pause" && p().status === "playing") p().toggle();
    else if (action === "next") p().next();
    else if (action === "previous") p().prev();
    else if (action === "seek" && position != null) p().seek(position);
  });
}

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const p = () => usePlayer.getState();
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => p().status !== "playing" && p().toggle()],
    ["pause", () => p().status === "playing" && p().toggle()],
    ["previoustrack", () => p().prev()],
    ["nexttrack", () => p().next()],
    ["seekto", (d) => d.seekTime != null && p().seek(d.seekTime)],
    ["seekbackward", (d) => p().seek(p().position - (d.seekOffset ?? 10))],
    ["seekforward", (d) => p().seek(p().position + (d.seekOffset ?? 10))],
  ];
  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* action not supported */
    }
  }
  const restored = selectCurrent(usePlayer.getState());
  if (restored) setMetadata(restored);
}

/** The player's status line in the current language, or null when there is nothing to say. */
export function useStatusText(): string | null {
  const note = usePlayer((s) => s.statusText);
  const t = useT();
  if (note === null) return null;
  return typeof note === "string" ? t.player.status[note] : note.error;
}
