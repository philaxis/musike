import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { LibraryStorage } from "./library.js";
import { backupDaily } from "./libraryBackup.js";

/** A JSON file in the data folder (library.json, box.json), replaced atomically (write a temp file, then rename over). */
export function fileStorage(dir = config.dataDir, name = "library.json"): LibraryStorage {
  const file = path.join(dir, name);
  return {
    read: async () => (existsSync(file) ? readFile(file, "utf8") : null),
    write: async (json) => {
      await mkdir(dir, { recursive: true });
      await backupDaily(file).catch(() => {});
      const tmp = `${file}.tmp`;
      await writeFile(tmp, json, "utf8");
      await rename(tmp, file);
    },
  };
}
