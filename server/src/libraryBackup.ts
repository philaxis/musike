import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

// Before the first change of each day, library.json (and box.json) is copied to backups/<name>-YYYY-MM-DD.json
// (the last 14 of each kept), so a playlist deleted by mistake (by hand or by an agent) can be brought back.

const KEEP_DAYS = 14;
/** File → the day its backup was made. */
const doneFor = new Map<string, string>();

/** Today's date on the server's clock, as YYYY-MM-DD. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Copies `file` into `<its folder>/backups` once per day, before it is overwritten. */
export async function backupDaily(file: string): Promise<void> {
  const day = today();
  if (doneFor.get(file) === day || !existsSync(file)) return;
  const dir = path.join(path.dirname(file), "backups");
  const base = path.basename(file, ".json");
  const target = path.join(dir, `${base}-${day}.json`);
  if (!existsSync(target)) {
    await mkdir(dir, { recursive: true });
    await copyFile(file, target);
    const mine = new RegExp(`^${base}-\\d{4}-\\d{2}-\\d{2}\\.json$`);
    const old = (await readdir(dir)).filter((n) => mine.test(n)).sort().slice(0, -KEEP_DAYS);
    await Promise.all(old.map((n) => rm(path.join(dir, n), { force: true })));
  }
  doneFor.set(file, day);
}
