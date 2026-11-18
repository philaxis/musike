import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { msg } from "./i18n.js";
import { localId } from "./localNames.js";
import { HttpError, type Track } from "./types.js";

// Album files split into songs without new files: data/segments.json lists, per root and path inside it, each song's
// time range and title. local.ts turns them into tracks of their own ("virtual" tracks) that stream that range of the
// file; the whole file stays a track (playlists keep it) but leaves the listings.

export interface Segment {
  /** The song's number in the file; with the file's path it makes the track ID, so keep it when fixing a range. */
  no: number;
  /** Seconds into the file. */
  start: number;
  end: number;
  title: string;
}

/** segments.json: root name → path inside the root → songs in time order. */
export type SegmentsFile = Record<string, Record<string, Segment[]>>;

const MAX_SEGMENTS = 500;

/** "L" + 20 characters of sha256("<root>/<path>#<no>"): stable while the file stays put and the song keeps its number. */
export const segmentId = (root: string, rel: string, no: number) => localId(root, `${rel}#${no}`);

const invalid = (detail: string) => new HttpError(400, msg("invalidSegments", { detail }));

/**
 * Reads a song list: 1 to 500 songs, each with a unique whole number `no` ≥ 1, `start` ≥ 0 before `end`, a title;
 * in time order without overlaps, and (when the file's length is known) ending inside the file. Times keep
 * millisecond precision.
 */
export function parseSegments(input: unknown, duration?: number): Segment[] {
  if (!Array.isArray(input) || input.length > MAX_SEGMENTS) throw invalid(`a list of up to ${MAX_SEGMENTS} songs`);
  const seen = new Set<number>();
  const out = input.map((raw, i): Segment => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const at = `song ${i + 1}`;
    if (!Number.isInteger(s.no) || (s.no as number) < 1 || (s.no as number) > 9999 || seen.has(s.no as number)) {
      throw invalid(`${at}: "no" must be a whole number from 1, used once`);
    }
    seen.add(s.no as number);
    const time = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : NaN);
    const start = time(s.start);
    const end = time(s.end);
    if (!(start >= 0) || !(end > start)) throw invalid(`${at}: needs 0 ≤ start < end (seconds)`);
    if (duration !== undefined && end > duration + 1) throw invalid(`${at}: ends after the file (${Math.round(duration)} s)`);
    const title = typeof s.title === "string" ? s.title.trim().slice(0, 300) : "";
    if (!title) throw invalid(`${at}: needs a title`);
    return { no: s.no as number, start, end, title };
  });
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].end) throw invalid(`song ${i + 1} starts before song ${i} ends`);
  }
  return out;
}

/**
 * The tracks of a split file, from the whole file's track: each song's title and length; artist, album (the file's
 * own title unless it has an album), year and cover stay the file's.
 */
export function segmentTracks(file: Track, root: string, rel: string, segments: Segment[]): Track[] {
  return segments.map((s) => ({
    id: segmentId(root, rel, s.no),
    title: s.title,
    artist: file.artist,
    album: file.album ?? file.title,
    duration: Math.round(s.end - s.start),
    thumb: file.thumb,
    art: file.art,
    kind: "song",
    source: "local",
    ...(file.year ? { year: file.year } : {}),
  }));
}

export class SegmentStore {
  private data: SegmentsFile = {};
  private writing: Promise<void> = Promise.resolve();
  /** Bumped by every `set`, so a load that read the file before it doesn't bring the old list back. */
  private changes = 0;

  constructor(private readonly file: string) {}

  /** A missing or broken file means no splits; entries that don't read as song lists are dropped. */
  async load() {
    await this.writing;
    const seen = this.changes;
    const data: SegmentsFile = {};
    try {
      const raw = existsSync(this.file) ? (JSON.parse(await readFile(this.file, "utf8")) as unknown) : null;
      for (const [root, files] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
        if (!files || typeof files !== "object") continue;
        for (const [rel, list] of Object.entries(files as Record<string, unknown>)) {
          try {
            const segments = parseSegments(list);
            if (segments.length) (data[root] ??= {})[rel] = segments;
          } catch {
            // a broken list: that file stays whole
          }
        }
      }
    } catch {
      // unreadable: no splits
    }
    if (seen === this.changes) this.data = data;
  }

  get(root: string, rel: string): Segment[] | undefined {
    return this.data[root]?.[rel];
  }

  /** The split files of a root (paths inside it) with their song counts. */
  files(root: string): { path: string; songs: number }[] {
    return Object.entries(this.data[root] ?? {}).map(([rel, list]) => ({ path: rel, songs: list.length }));
  }

  /** Replaces a file's songs; an empty list makes it whole again. Written atomically, one write at a time. */
  set(root: string, rel: string, segments: Segment[]): Promise<void> {
    this.changes++;
    if (segments.length) (this.data[root] ??= {})[rel] = segments;
    else if (this.data[root]) {
      delete this.data[root][rel];
      if (!Object.keys(this.data[root]).length) delete this.data[root];
    }
    const json = JSON.stringify(this.data, null, 1);
    const job = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, json, "utf8");
      await rename(tmp, this.file);
    });
    this.writing = job.catch(() => {});
    return job;
  }
}
