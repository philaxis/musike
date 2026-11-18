import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Folder of the server package (bundled builds pass every path through env instead).
const root = typeof import.meta.url === "string" ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") : process.cwd();

export const config = {
  port: Number(process.env.PORT ?? 4180),
  host: process.env.HOST ?? "0.0.0.0",
  /** Explicit yt-dlp executable. When unset it is located automatically (see tools.ts). */
  ytdlpPath: process.env.YTDLP_PATH || null,
  // Extra yt-dlp flags, e.g. YTDLP_EXTRA_ARGS="--cookies-from-browser firefox"
  ytdlpExtraArgs: (process.env.YTDLP_EXTRA_ARGS ?? "").split(" ").filter(Boolean),
  dataDir: process.env.MUSIKE_DATA_DIR ?? path.join(root, "data"),
  cacheDir: process.env.MUSIKE_CACHE_DIR ?? path.join(root, "cache"),
  /** HD video cache limit; least recently played videos are evicted first. */
  cacheMaxBytes: Number(process.env.MUSIKE_CACHE_MAX_MB ?? 2048) * 1024 * 1024,
  webDist: process.env.MUSIKE_WEB_DIST ?? path.resolve(root, "..", "web", "dist"),
  /**
   * Private folder for yt-dlp, Deno and FFmpeg downloaded by Musike itself (the desktop app sets it).
   * Searched before the system PATH, and where "Instalar" puts the tools when set.
   */
  binDir: process.env.MUSIKE_BIN_DIR || null,
  /** Server music folders shown as "내 음악": `name=path;name=path` (see local.ts). Read-only. */
  localDirs: process.env.MUSIKE_LOCAL_DIRS ?? "",
  /** Taste analysis output (taste.json, audio.f32, text.f32), written by the analysis worker; read-only here. */
  analysisDir: process.env.MUSIKE_ANALYSIS_DIR || path.join(homedir(), ".local", "share", "musike", "analysis"),
  /** Where "keep on server" puts YouTube audio; also indexed as the root "받아 둔 곡". */
  keepDir: process.env.MUSIKE_KEEP_DIR || "/mnt/backup8t/orca-data/musike/keep",
  /** Google OAuth web client (`client_id`, `client_secret`) and the account's tokens: secrets, outside the repo and data. */
  googleClient: process.env.MUSIKE_GOOGLE_CLIENT || path.join(homedir(), ".config", "musike", "google-client.json"),
  googleTokens: process.env.MUSIKE_GOOGLE_TOKENS || path.join(homedir(), ".config", "musike", "google.json"),
  /** Must be listed in the client's authorized redirect URIs. */
  googleRedirect: process.env.MUSIKE_GOOGLE_REDIRECT || "https://philaxis-b760m-aorus-elite.taildeaa80.ts.net:4443/api/google/callback",
  /** YouTube Music language when a request doesn't say (the app always does). */
  lang: process.env.MUSIKE_LANG ?? "en",
  location: process.env.MUSIKE_LOCATION ?? "BR",
  /** HTTP for youtubei.js; the platform's own fetch here (the Android app passes its native one). */
  fetch: undefined as typeof fetch | undefined,
};
