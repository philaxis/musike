import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { msg } from "./i18n.js";
import { HttpError, LOCAL_ID } from "./types.js";

// Hidden "내 음악" items: single local tracks (by ID) and whole roots (by name), kept in data/hidden.json. Hiding
// only leaves them out of the "내 음악" listings and search; the files stay, and playlists, favorites, history and
// the queue keep and play them.

export interface Hidden {
  ids: string[];
  roots: string[];
}

/** What a hide/unhide request names: tracks, a root, or both. */
export interface HideTarget {
  ids: string[];
  root?: string;
}

/** Reads a request body `{ ids?, root? }`; refuses anything that names nothing or isn't shaped right. */
export function parseTarget(body: unknown): HideTarget {
  const { ids, root } = (body ?? {}) as { ids?: unknown; root?: unknown };
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 5000 || !ids.every((id) => typeof id === "string" && LOCAL_ID.test(id)))) {
    throw new HttpError(400, msg("invalidTrackId"));
  }
  if (root !== undefined && (typeof root !== "string" || !root || root.length > 200)) throw new HttpError(400, msg("localRootNotFound"));
  const target: HideTarget = { ids: (ids as string[] | undefined) ?? [], ...(root ? { root: root as string } : {}) };
  if (!target.ids.length && !target.root) throw new HttpError(400, msg("hideNothing"));
  return target;
}

export class HiddenStore {
  private ids = new Set<string>();
  private roots = new Set<string>();
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load() {
    let data: Partial<Hidden> = {};
    try {
      if (existsSync(this.file)) data = JSON.parse(await readFile(this.file, "utf8")) as Partial<Hidden>;
    } catch {
      // unreadable: start empty rather than refuse to start
    }
    this.ids = new Set((Array.isArray(data.ids) ? data.ids : []).filter((id): id is string => typeof id === "string" && LOCAL_ID.test(id)));
    this.roots = new Set((Array.isArray(data.roots) ? data.roots : []).filter((r): r is string => typeof r === "string" && !!r));
  }

  /** A track is hidden on its own or with its whole root. */
  isHidden(id: string, root: string): boolean {
    return this.ids.has(id) || this.roots.has(root);
  }

  isRootHidden(root: string): boolean {
    return this.roots.has(root);
  }

  list(): Hidden {
    return { ids: [...this.ids], roots: [...this.roots] };
  }

  hide(target: HideTarget): Promise<Hidden> {
    for (const id of target.ids) this.ids.add(id);
    if (target.root) this.roots.add(target.root);
    return this.save();
  }

  unhide(target: HideTarget): Promise<Hidden> {
    for (const id of target.ids) this.ids.delete(id);
    if (target.root) this.roots.delete(target.root);
    return this.save();
  }

  /** Written atomically (temp file, then rename), one write at a time. */
  private async save(): Promise<Hidden> {
    const data = this.list();
    const json = JSON.stringify(data);
    const write = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, json, "utf8");
      await rename(tmp, this.file);
    });
    this.writing = write.catch(() => {});
    await write;
    return data;
  }
}

/**
 * The tracks of an album (or root) as a listing shows them: hidden ones left out, or with `show` kept and marked
 * `hidden: true`. `allHidden` tells whether every track is hidden (an album card shown dimmed).
 */
export function visibleTracks<T extends { id: string }>(
  tracks: T[],
  isHidden: (id: string) => boolean,
  show: boolean,
): { tracks: (T & { hidden?: true })[]; allHidden: boolean } {
  const out: (T & { hidden?: true })[] = [];
  let hiddenCount = 0;
  for (const t of tracks) {
    if (!isHidden(t.id)) out.push(t);
    else {
      hiddenCount++;
      if (show) out.push({ ...t, hidden: true });
    }
  }
  return { tracks: out, allHidden: tracks.length > 0 && hiddenCount === tracks.length };
}
