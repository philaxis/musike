import { shuffled } from "./format";
import type { Bundle, Track } from "./types";

// Bundles: several tracks played in order as one row. Lists hold the row (kind "bundle", the bundle's id); the player
// puts the parts in the queue, each marked with its place (`part`), so "next" moves to the next part and no fade
// comes between them (player/crossfade.ts). A performance of a multi-movement work plays the same way (`work`, see
// WorkUnit): the server's row for a whole performance carries its movements, and movements listed together join.

let runs = 0;

/**
 * A bundle's parts as queue tracks. Each expansion gets its own `run`, so a bundle queued twice stays two runs.
 * `movements`: the parts are one performance's movements.
 */
export function bundleParts(b: Pick<Bundle, "id" | "title" | "parts"> & { movements?: boolean }): Track[] {
  const run = `${Date.now().toString(36)}-${(runs++).toString(36)}`;
  const movements = b.movements ? { movements: true } : {};
  return b.parts.map((t, i) => ({ ...t, part: { bundle: b.id, title: b.title, n: i + 1, of: b.parts.length, run, ...movements } }));
}

/** A performance row of the server (`work.parts`) as the bundle it plays as. */
export const workBundle = (t: Track) => (t.work?.parts ? { id: t.id, title: t.work.title, parts: t.work.parts, movements: true } : null);

/** Tracks as playlists and ♥ keep them: a performance row (made for one response, never stored) is its movements. */
export const storedTracks = (tracks: Track[]) => tracks.flatMap((t) => t.work?.parts ?? [t]);

/** A movement listed on a work page (`work` without parts, not queued in a run yet): its performance. */
const movementOf = (t: Track | undefined) => (t?.work && !t.work.parts && !t.part ? t.work.key : null);

/** `tracks` in groups of indexes: movements of one performance listed next to each other together, the rest alone. */
function movementGroups(tracks: Track[]): number[][] {
  const groups: number[][] = [];
  tracks.forEach((t, i) => {
    if (movementOf(t) !== null && movementOf(t) === movementOf(tracks[i - 1])) groups[groups.length - 1].push(i);
    else groups.push([i]);
  });
  return groups;
}

/**
 * Queue rows from a list and what each of its tracks plays (`expanded`, one entry per track): movements of one
 * performance listed next to each other (a work page marks them with `work`) join into one run, like a bundle's parts,
 * so they stay together and in order, shuffled too. `place[i]`: the row track `i` went into and its position there.
 */
export function joinMovements(tracks: Track[], expanded: Track[][]) {
  const place: { row: number; at: number }[] = [];
  const rows = movementGroups(tracks).map((group, row) => {
    group.forEach((i, at) => (place[i] = { row, at }));
    if (group.length === 1) return expanded[group[0]];
    const first = tracks[group[0]];
    return bundleParts({ id: `W${first.id}`, title: first.work!.title, parts: group.map((i) => tracks[i]), movements: true });
  });
  return { rows, place };
}

/** `tracks` shuffled for a shuffle button: a performance's movements listed together stay together, in order. */
export const shuffledWorks = (tracks: Track[]) => shuffled(movementGroups(tracks)).flatMap((group) => group.map((i) => tracks[i]));

/** The row that stands for a bundle in lists (as the server makes it): its title, total length, first cover. */
export function bundleRow(b: Bundle): Track {
  const first = b.parts[0];
  return {
    id: b.id,
    title: b.title,
    artist: b.artist ?? first?.artist ?? "",
    duration: b.parts.reduce((n, t) => n + t.duration, 0),
    thumb: first?.thumb ?? "",
    art: first?.art ?? "",
    kind: "bundle",
  };
}

/** "2/4 · Andante" for a bundle part, the plain title otherwise. */
export const trackTitle = (t: Track) => (t.part ? `${t.part.n}/${t.part.of} · ${t.title}` : t.title);

/** The queue as rows: [start, end) of each run of one bundle's parts, or of a single track. */
export function queueRows(queue: Track[]): { start: number; end: number }[] {
  const rows: { start: number; end: number }[] = [];
  for (let i = 0; i < queue.length; ) {
    const run = queue[i].part?.run;
    let end = i + 1;
    while (run && queue[end]?.part?.run === run) end++;
    rows.push({ start: i, end });
    i = end;
  }
  return rows;
}
