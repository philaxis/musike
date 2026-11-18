import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import * as box from "./box.js";
import { config } from "./config.js";
import { langOf, msg, tr, type Lang } from "./i18n.js";
import * as ledger from "./ledger.js";
import { fixAside } from "./standIn.js";
import { HttpError, VIDEO_ID, type Track, type Unplayable } from "./types.js";

// The user's YouTube account, read-only: Google sign-in (OAuth web flow, scope youtube.readonly), the playlists
// (private ones too) and liked videos, and a sync that brings their new tracks into the song box. Plain fetch, no SDK.
// The refresh token lives in ~/.config/musike/google.json (0600), never in the repo or the data folder.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/youtube/v3/";
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const SCOPES = ["openid", "email", YOUTUBE_SCOPE];
const STATE_MS = 10 * 60_000;
const TIMEOUT_MS = 30_000;
/** Liked videos: listed with the playlists under this ID (YouTube's own ID for the list). */
export const LIKED = "LL";
const LIST_ID = /^[A-Za-z0-9_-]{2,80}$/;

interface Client {
  id: string;
  secret: string;
}

interface Tokens {
  refreshToken: string;
  accessToken?: string;
  /** ms */
  expiresAt?: number;
  email?: string;
  connectedAt: number;
  /** Google refused the refresh token (revoked, or expired by a test-mode consent screen). */
  revoked?: true;
}

/** The OAuth client file: `{ client_id, client_secret }`, or Google's download (`{ web: { … } }`). */
async function client(): Promise<Client> {
  const raw = await readFile(config.googleClient, "utf8").catch(() => null);
  const data = raw ? JSON.parse(raw) : null;
  const c: { client_id?: unknown; client_secret?: unknown } | null = data?.web ?? data?.installed ?? data;
  if (typeof c?.client_id !== "string" || typeof c.client_secret !== "string") throw new HttpError(503, msg("googleNoClient"));
  return { id: c.client_id, secret: c.client_secret };
}

async function readTokens(): Promise<Tokens | null> {
  const raw = await readFile(config.googleTokens, "utf8").catch(() => null);
  const t = raw ? (JSON.parse(raw) as Tokens) : null;
  return t?.refreshToken ? t : null;
}

async function writeTokens(t: Tokens): Promise<void> {
  const file = config.googleTokens;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(t, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

// Sign-in

type Back = "settings" | "home";
const BACK_PATH: Record<Back, string> = { settings: "/settings", home: "/" };

const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** The OAuth `state`: time, nonce and where to return, HMAC-signed so a callback can only answer our own login. */
export function signState(secret: string, back: Back, now = Date.now()): string {
  const payload = `${now.toString(36)}.${randomBytes(9).toString("base64url")}.${back}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Where to return after sign-in, or null when the state is forged, malformed or older than 10 minutes. */
export function checkState(secret: string, state: string, now = Date.now()): Back | null {
  const m = /^([0-9a-z]+)\.([\w-]+)\.(settings|home)\.([\w-]+)$/.exec(state);
  if (!m) return null;
  const expected = Buffer.from(sign(secret, `${m[1]}.${m[2]}.${m[3]}`));
  const got = Buffer.from(m[4]);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const age = now - parseInt(m[1], 36);
  return age >= -60_000 && age <= STATE_MS ? (m[3] as Back) : null;
}

export function loginUrl(clientId: string, redirect: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${q}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, { method: "POST", body: new URLSearchParams(params), signal: AbortSignal.timeout(TIMEOUT_MS) });
  return (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as TokenResponse;
}

/** The email in an ID token straight from Google's token endpoint (over TLS, so not verified again here). */
function emailOf(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown };
  return typeof claims.email === "string" ? claims.email : undefined;
}

/** Exchanges the callback's code for tokens and stores them. Returns an error reason for the redirect, or null. */
async function finishLogin(code: string): Promise<string | null> {
  const c = await client();
  const r = await tokenRequest({ code, client_id: c.id, client_secret: c.secret, redirect_uri: config.googleRedirect, grant_type: "authorization_code" });
  if (!r.access_token) return r.error ?? "token";
  // Granular consent lets the YouTube box be unticked; without it nothing can be read.
  if (r.scope && !r.scope.split(" ").includes(YOUTUBE_SCOPE)) return "scope";
  const refreshToken = r.refresh_token ?? (await readTokens())?.refreshToken;
  if (!refreshToken) return "no_refresh_token";
  await writeTokens({
    refreshToken,
    accessToken: r.access_token,
    expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
    email: emailOf(r.id_token),
    connectedAt: Date.now(),
  });
  return null;
}

const reconnect = () => new HttpError(409, msg("googleReconnect"), "google_login");

/** A valid access token, refreshed when it is about to expire (or `force`d after a 401). */
async function accessToken(force = false): Promise<string> {
  const t = await readTokens();
  if (!t) throw new HttpError(409, msg("googleNotConnected"), "google_login");
  if (t.revoked) throw reconnect();
  if (!force && t.accessToken && (t.expiresAt ?? 0) - 60_000 > Date.now()) return t.accessToken;
  const c = await client();
  const r = await tokenRequest({ refresh_token: t.refreshToken, client_id: c.id, client_secret: c.secret, grant_type: "refresh_token" });
  if (r.error === "invalid_grant") {
    await writeTokens({ ...t, revoked: true, accessToken: undefined });
    throw reconnect();
  }
  if (!r.access_token) throw new HttpError(502, msg("googleFailed", { detail: r.error_description ?? r.error ?? "token" }));
  await writeTokens({ ...t, accessToken: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 });
  return r.access_token;
}

export async function status() {
  if (!existsSync(config.googleClient)) return { connected: false, reason: "no_client" };
  const t = await readTokens();
  if (!t) return { connected: false, reason: "not_connected" };
  try {
    await accessToken();
    return { connected: true, email: t.email ?? null };
  } catch (err) {
    if (err instanceof HttpError && err.code === "google_login") return { connected: false, reason: "revoked", email: t.email ?? null };
    // Google unreachable for a moment: still connected.
    return { connected: true, email: t.email ?? null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Forgets the account here and asks Google to revoke the token (best effort). */
export async function disconnect(): Promise<void> {
  const t = await readTokens();
  if (t && !t.revoked) {
    await fetch(`${REVOKE_URL}?${new URLSearchParams({ token: t.refreshToken })}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }
  await rm(config.googleTokens, { force: true });
}

// YouTube Data API

interface Page<T> {
  items?: T[];
  nextPageToken?: string;
  pageInfo?: { totalResults?: number };
}

async function api<T>(endpoint: string, params: Record<string, string>): Promise<Page<T>> {
  const url = `${API}${endpoint}?${new URLSearchParams(params)}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken(attempt > 0)}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401 && attempt === 0) continue;
    const body = (await res.json().catch(() => ({}))) as Page<T> & { error?: { message?: string } };
    if (!res.ok) throw new HttpError(502, msg("googleFailed", { detail: body.error?.message ?? `HTTP ${res.status}` }));
    return body;
  }
}

/** Every item of a paged list (50 per request: one quota unit each). */
async function all<T>(endpoint: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let pageToken = "";
  do {
    const page = await api<T>(endpoint, { ...params, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** Seconds of an ISO-8601 duration as YouTube gives it ("PT1H2M3S", "P1DT2M"); 0 when unreadable (live streams). */
export function isoDuration(s: string | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s ?? "");
  if (!m) return 0;
  const [, d, h, min, sec] = m.map((v) => Number(v ?? 0));
  return Math.round(d * 86400 + h * 3600 + min * 60 + sec);
}

interface Snippet {
  title?: string;
  channelTitle?: string;
  videoOwnerChannelTitle?: string;
  thumbnails?: Record<string, { url?: string }>;
}

interface Video {
  id: string;
  snippet?: Snippet;
  contentDetails?: { duration?: string; regionRestriction?: { allowed?: string[]; blocked?: string[] }; contentRating?: { ytRating?: string } };
  status?: { uploadStatus?: string; privacyStatus?: string };
}

/**
 * Why a video won't play in `region` (ISO 3166 code), from `videos.list` with `part=status,contentDetails`; null when
 * it plays. Missing from the answer: deleted. The same judgement every check makes (sync, first start, candidates).
 */
export function unplayable(video: Video | undefined, region: string): Unplayable | null {
  if (!video) return "gone";
  const upload = video.status?.uploadStatus;
  if (upload === "rejected" || upload === "deleted" || upload === "failed") return "gone";
  if (video.status?.privacyStatus === "private") return "private";
  const r = video.contentDetails?.regionRestriction;
  if (r?.blocked?.includes(region) || (r?.allowed && !r.allowed.includes(region))) return "region";
  if (video.contentDetails?.contentRating?.ytRating === "ytAgeRestricted") return "age";
  return null;
}

/** `videos.list` with `part` for `ids`, 50 per request (one quota unit each, whatever the parts); deleted videos are left out. */
async function videoDetails(ids: string[], part = "contentDetails"): Promise<Map<string, Video>> {
  const out = new Map<string, Video>();
  for (let i = 0; i < ids.length; i += 50) {
    const page = await api<Video>("videos", { part, id: ids.slice(i, i + 50).join(","), maxResults: "50" });
    for (const v of page.items ?? []) out.set(v.id, v);
  }
  return out;
}

/** `unplayable` for each of `ids` here (MUSIKE_LOCATION), 50 per request. */
export async function checkVideos(ids: string[]): Promise<Map<string, Unplayable | null>> {
  const region = config.location.toUpperCase();
  const found = await videoDetails(ids, "status,contentDetails");
  return new Map(ids.map((id) => [id, unplayable(found.get(id), region)]));
}

/**
 * Checks every YouTube track of the song box: stores whether each plays here in the box, and what YouTube says of
 * each (title, channel, length, status) in the video ledger, which notes what changed. Returns how many newly won't
 * play and the changes found.
 */
export async function checkBox(): Promise<{ checked: number; blocked: number; changes: number }> {
  const entries = (await box.youtubeEntries()).filter((e) => VIDEO_ID.test(e.track.id));
  const ids = entries.map((e) => e.track.id);
  const region = config.location.toUpperCase();
  const at = Date.now();
  const found = await videoDetails(ids, "snippet,status,contentDetails");
  const verdicts = new Map(ids.map((id) => [id, unplayable(found.get(id), region)]));
  const blocked = await box.applyChecks(verdicts, at);
  const seen = new Map(
    ids.map((id): [string, ledger.Seen | null] => {
      const v = found.get(id);
      const status = verdicts.get(id) ?? "ok";
      return [id, v ? { title: v.snippet?.title ?? "", channel: v.snippet?.channelTitle ?? "", duration: isoDuration(v.contentDetails?.duration), status } : null];
    }),
  );
  const addedAt = new Map(entries.map((e) => [e.track.id, e.addedAt]));
  const changes = await ledger.recordCheck(seen, at, (id) => addedAt.get(id) ?? at);
  // Then stand-ins for what is put aside: minutes (YouTube Music, yt-dlp, search), not waited for.
  void fixAside().catch(() => {});
  return { checked: ids.length, blocked, changes: changes.length };
}

/** The first check of the song box, at startup when there was none yet and the account is connected. */
export async function checkBoxOnce(): Promise<void> {
  if ((await box.checkedAt()) !== undefined) return;
  const t = await readTokens();
  if (!t || t.revoked || !existsSync(config.googleClient)) return;
  await checkBox();
}

/** A YouTube video as a Musike track (same images and song/video rule as playlist import). */
export function videoTrack(id: string, title: string, channel: string, duration: number): Track {
  return {
    id,
    title: title.slice(0, 300) || id,
    artist: channel.replace(/ - Topic$/, "").slice(0, 300),
    duration,
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    art: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    kind: / - Topic$/.test(channel) ? "song" : "video",
  };
}

export interface AccountPlaylist {
  id: string;
  title: string;
  count: number;
  privacy: string;
  thumb: string;
}

async function accountPlaylists(lang: Lang): Promise<AccountPlaylist[]> {
  const mine = await all<{ id: string; snippet?: Snippet; contentDetails?: { itemCount?: number }; status?: { privacyStatus?: string } }>(
    "playlists",
    { part: "snippet,contentDetails,status", mine: "true" },
  );
  const liked = await api("videos", { part: "id", myRating: "like", maxResults: "1" });
  return [
    { id: LIKED, title: tr(lang, msg("likedVideos")), count: liked.pageInfo?.totalResults ?? 0, privacy: "private", thumb: "" },
    ...mine.map((p) => ({
      id: p.id,
      title: p.snippet?.title ?? p.id,
      count: p.contentDetails?.itemCount ?? 0,
      privacy: p.status?.privacyStatus ?? "",
      thumb: p.snippet?.thumbnails?.medium?.url ?? p.snippet?.thumbnails?.default?.url ?? "",
    })),
  ];
}

// Playlists not to bring in, by ID (data/google-exclude.json). New YouTube playlists are brought in by default.

const excludeFile = () => path.join(config.dataDir, "google-exclude.json");

async function readExcluded(): Promise<string[]> {
  const raw = await readFile(excludeFile(), "utf8").catch(() => null);
  const ids = raw ? (JSON.parse(raw) as { ids?: unknown }).ids : [];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

async function writeExcluded(ids: string[]): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  const tmp = `${excludeFile()}.tmp`;
  await writeFile(tmp, JSON.stringify({ ids }, null, 2), "utf8");
  await rename(tmp, excludeFile());
}

/** The playlists a sync reads: all but the excluded ones. */
export function syncTargets<P extends { id: string }>(playlists: P[], excluded: string[]): P[] {
  return playlists.filter((p) => !excluded.includes(p.id));
}

interface PlaylistItem {
  snippet?: Snippet;
  contentDetails?: { videoId?: string };
  status?: { privacyStatus?: string };
}

/** Deleted and private videos stay in a playlist as placeholders without an owner channel: not tracks to bring in. */
export function itemGone(item: PlaylistItem): boolean {
  return !item.snippet?.videoOwnerChannelTitle || item.status?.privacyStatus === "private";
}

export interface SyncResult {
  added: { id: string; title: string; source: string }[];
  merged: number;
  /** Box tracks newly found not to play here (see `unplayable`). */
  blocked: number;
  playlists: number;
}

/** One playlist's live tracks. */
async function readPlaylistTracks(id: string): Promise<Track[]> {
  if (id === LIKED) {
    const videos = await all<Video>("videos", { part: "snippet,contentDetails", myRating: "like" });
    return videos.map((v) => videoTrack(v.id, v.snippet?.title ?? "", v.snippet?.channelTitle ?? "", isoDuration(v.contentDetails?.duration)));
  }
  const items = await all<PlaylistItem>("playlistItems", { part: "snippet,contentDetails,status", playlistId: id });
  const live: { vid: string; snippet: Snippet }[] = [];
  const fresh = new Set<string>();
  for (const item of items) {
    const vid = item.contentDetails?.videoId ?? "";
    if (!VIDEO_ID.test(vid) || itemGone(item)) continue;
    live.push({ vid, snippet: item.snippet ?? {} });
    if (!(await box.boxEntry(vid))) fresh.add(vid);
  }
  // Durations only for tracks the box doesn't have yet (quota); a video missing from the answer was deleted.
  const details = await videoDetails([...fresh]);
  return live
    .filter(({ vid }) => !fresh.has(vid) || details.has(vid))
    .map(({ vid, snippet }) => videoTrack(vid, snippet.title ?? "", snippet.videoOwnerChannelTitle ?? "", isoDuration(details.get(vid)?.contentDetails?.duration)));
}

let syncing: Promise<SyncResult> | null = null;

async function runSync(lang: Lang): Promise<SyncResult> {
  const targets = syncTargets(await accountPlaylists(lang), await readExcluded());
  const result: SyncResult = { added: [], merged: 0, blocked: 0, playlists: targets.length };
  for (const p of targets) {
    const tracks = await readPlaylistTracks(p.id);
    const source = { kind: p.id === LIKED ? ("youtube-liked" as const) : ("youtube-playlist" as const), ref: p.id, name: p.title, at: Date.now() };
    const r = await box.addToBox(tracks, source);
    result.added.push(...r.added.map((e) => ({ id: e.track.id, title: e.track.title, source: p.title })));
    result.merged += r.merged;
  }
  // Then whether each box track (old and new) still plays here (deleted, private, blocked in this country), and
  // what changed about each on YouTube (the video ledger).
  result.blocked = (await checkBox()).blocked;
  return result;
}

/** Brings new tracks of every playlist (but the excluded) and the liked videos into the box, then checks them all. One sync at a time. */
export function sync(lang: Lang): Promise<SyncResult> {
  syncing ??= runSync(lang).finally(() => (syncing = null));
  return syncing;
}

export function registerGoogleRoutes(app: FastifyInstance) {
  /** `?from=home` returns to the start page after sign-in; anything else to Settings. */
  app.get("/api/google/login", async (req, reply) => {
    const c = await client();
    const back: Back = (req.query as { from?: string }).from === "home" ? "home" : "settings";
    return reply.redirect(loginUrl(c.id, config.googleRedirect, signState(c.secret, back)), 302);
  });

  app.get("/api/google/callback", async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    const c = await client();
    const back = checkState(c.secret, state ?? "");
    const to = BACK_PATH[back ?? "settings"];
    const reason = !back ? "state" : error ? error : !code ? "code" : await finishLogin(code);
    const query = reason ? `google=error&reason=${encodeURIComponent(reason)}` : "google=connected";
    return reply.redirect(`${to}?${query}`, 302);
  });

  app.get("/api/google/status", () => status());

  app.delete("/api/google", async () => {
    await disconnect();
    return { connected: false };
  });

  app.get("/api/google/playlists", async (req) => {
    const excluded = await readExcluded();
    return { playlists: (await accountPlaylists(langOf(req))).map((p) => ({ ...p, excluded: excluded.includes(p.id) })) };
  });

  /** `{ ids }`: the playlists a sync skips (the whole list; [] brings them all in). */
  app.put("/api/google/excluded", async (req) => {
    const { ids } = (req.body ?? {}) as { ids?: unknown };
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !LIST_ID.test(id))) throw new HttpError(400, msg("idsRequired"));
    const clean = [...new Set(ids as string[])];
    await writeExcluded(clean);
    return { excluded: clean };
  });

  app.post("/api/google/sync", (req) => sync(langOf(req)));
}
