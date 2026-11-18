import { capabilities } from "../lib/api";
import { canMixAudio } from "../lib/audio";
import { isLocal } from "../lib/server";
import type { Track } from "../lib/types";

/** Seconds two tracks overlap: the setting's default and its upper end. 0 turns crossfades off. */
export const FADE_DEFAULT = 4;
export const FADE_MAX = 12;

/**
 * Crossfades mix two audio elements through Web Audio, which only hears same-origin streams: the server's proxy, not
 * the YouTube URLs the Android app plays directly.
 */
export const crossfadeSupported = canMixAudio && capabilities.serverLibrary;

/** Consecutive tracks of one local album play on without a fade, so live albums and gapless records stay whole. */
export const sameAlbum = (a: Track, b: Track) =>
  isLocal(a) && isLocal(b) && !!a.album && a.album === b.album && a.artist === b.artist;

interface Graph {
  ctx: AudioContext;
  /** The player's volume and mute. */
  master: GainNode;
  /** Each element's own level, ramped during a fade. */
  gains: Map<HTMLMediaElement, GainNode>;
}

let graph: Graph | null = null;

/** Equal-power curves: the sum of the two tracks' power stays level through the overlap. */
const curve = (rise: boolean) =>
  Float32Array.from({ length: 33 }, (_, i) => (rise ? Math.sin : Math.cos)((i / 32) * (Math.PI / 2)));
const FADE_IN = curve(true);
const FADE_OUT = curve(false);

/**
 * The audio graph behind crossfades. Ramps are scheduled on the audio thread, so they keep their timing in a hidden
 * page (screen off) where the browser throttles timers.
 */
export const mixer = {
  /**
   * Routes the elements through Web Audio. Happens once (an element can't be unrouted) and only after the user has
   * touched the page: before that the audio context would start suspended and silence everything routed into it.
   */
  connect(elements: HTMLMediaElement[]): boolean {
    if (graph) return true;
    if ("userActivation" in navigator && !navigator.userActivation.hasBeenActive) return false;
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.connect(ctx.destination);
      const gains = new Map<HTMLMediaElement, GainNode>();
      for (const el of elements) {
        const gain = ctx.createGain();
        ctx.createMediaElementSource(el).connect(gain).connect(master);
        gains.set(el, gain);
      }
      graph = { ctx, master, gains };
      void ctx.resume().catch(() => {});
      // Handy for checking a fade from the console (the window has no such field in its type).
      const host = globalThis as { __musikeMixer?: Graph };
      host.__musikeMixer = graph;
      return true;
    } catch {
      return false;
    }
  },

  connected: () => graph !== null,
  running: () => graph?.ctx.state === "running",

  resume() {
    if (graph && graph.ctx.state !== "running") void graph.ctx.resume().catch(() => {});
  },

  setVolume(level: number) {
    if (graph) graph.master.gain.value = level;
  },

  /** Puts an element at a level right away, dropping any fade in progress. */
  set(el: HTMLMediaElement, level: number) {
    const gain = graph?.gains.get(el)?.gain;
    if (!graph || !gain) return;
    gain.cancelScheduledValues(0);
    gain.setValueAtTime(level, graph.ctx.currentTime);
  },

  /** Fades `incoming` up and `outgoing` down over the same `seconds`, starting now. */
  fade(incoming: HTMLMediaElement, outgoing: HTMLMediaElement, seconds: number) {
    if (!graph) return;
    const now = graph.ctx.currentTime;
    for (const [el, shape] of [
      [incoming, FADE_IN],
      [outgoing, FADE_OUT],
    ] as const) {
      const gain = graph.gains.get(el)?.gain;
      if (!gain) continue;
      gain.cancelScheduledValues(0);
      gain.setValueCurveAtTime(shape, now, seconds);
    }
  },
};
