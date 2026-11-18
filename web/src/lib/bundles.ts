import type { Bundle, Track } from "./types";

// Bundles: several tracks played in order as one row. Lists hold the row (kind "bundle", the bundle's id); the player
// puts the parts in the queue, each marked with its place (`part`), so "next" moves to the next part and no fade
// comes between them (player/crossfade.ts).

let runs = 0;

/** A bundle's parts as queue tracks. Each expansion gets its own `run`, so a bundle queued twice stays two runs. */
export function bundleParts(b: Bundle): Track[] {
  const run = `${Date.now().toString(36)}-${(runs++).toString(36)}`;
  return b.parts.map((t, i) => ({ ...t, part: { bundle: b.id, title: b.title, n: i + 1, of: b.parts.length, run } }));
}

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
