import { request } from "../lib/http";
import type { Track } from "../lib/types";
import { isTvMode } from "../tv/tvMode";
import { usePlayer } from "./player";

// The listening log (see server/src/plays.ts): while a track is the current one, count the seconds actually heard
// (only while playing; a seek is not listening). When it stops being the current one, send one line. Lines that
// fail to send wait in memory and go with the next one; a page closing sends with `keepalive`.

const MIN_HEARD = 2;
/** A position step longer than this is a seek, not playback (timeupdate fires every 0.25 s or so). */
const MAX_STEP = 3;

interface Open {
  key: string;
  track: Track;
  startedAt: number;
  heard: number;
  lastPos: number;
  duration: number;
}

/** The same track stays the same listen through a shuffle or a queue reorder; a bundle part is its own. */
const keyOf = (t: Track) => `${t.id}|${t.part?.run ?? ""}|${t.part?.n ?? ""}`;

let open: Open | null = null;
let waiting: object[] = [];

const device = () => (isTvMode() ? "tv" : matchMedia("(pointer: coarse)").matches ? "phone" : "pc");

function close(end: "finished" | "skipped" | "left") {
  const o = open;
  open = null;
  if (!o || o.heard < MIN_HEARD) return;
  const fade = usePlayer.getState().fade;
  // A crossfade moves on a few seconds before the end: that still counts as played to the end.
  const finished = end === "finished" || (o.duration > 0 && o.lastPos >= o.duration - Math.max(fade, 0) - 3);
  waiting.push({
    startedAt: o.startedAt,
    endedAt: Date.now(),
    id: o.track.id,
    title: o.track.title,
    artist: o.track.artist,
    album: o.track.album,
    source: o.track.source === "local" ? "local" : "youtube",
    duration: o.duration,
    heard: o.heard,
    end: finished ? "finished" : end,
    device: device(),
    part: o.track.part?.n,
  });
  send(end === "left");
}

function send(leaving: boolean) {
  const plays = waiting;
  waiting = [];
  request("/api/plays", { method: "POST", json: { plays }, keepalive: leaving }).catch(() => {
    // Offline or the server restarting: keep them for the next send (bounded, oldest dropped).
    waiting = [...plays, ...waiting].slice(-200);
  });
}

function begin(track: Track, position: number, duration: number) {
  open = { key: keyOf(track), track, startedAt: Date.now(), heard: 0, lastPos: position, duration: duration || track.duration || 0 };
}

/** Starts following the player. Call once. */
export function startPlayLog() {
  usePlayer.subscribe((s, prev) => {
    const track = s.queue[s.index];
    if (open && (!track || keyOf(track) !== open.key)) close("skipped");
    if (!track) return;
    if (!open) begin(track, s.position, s.duration);
    const o = open!;
    if (s.duration > 0) o.duration = s.duration;
    // Repeat-one (or a restart from the very end): the position falls back to the start after the end.
    if (s.position + 5 < o.lastPos && o.duration > 0 && o.lastPos >= o.duration - 3) {
      close("finished");
      begin(track, s.position, s.duration);
      return;
    }
    const step = s.position - o.lastPos;
    if (s.status === "playing" && prev.status === "playing" && step > 0 && step <= MAX_STEP) o.heard += step;
    o.lastPos = s.position;
  });
  addEventListener("pagehide", () => close("left"));
}
