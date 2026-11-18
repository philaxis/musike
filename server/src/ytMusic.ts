import { config } from "./config.js";
import { VIDEO_ID } from "./types.js";

// YouTube Music moves a track to a new video when its distributor changes; the old video then won't play anywhere
// (most of the songs put aside as 「한국에서 막힘」). YouTube Music still knows where it went: its link resolver
// answers with the new video, and so does its watch page (`INITIAL_ENDPOINT`, see yt-dlp issue #14066), which is the
// fallback when the resolver fails.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";
const TIMEOUT_MS = 10_000;
/** How long an answer (moved or not) is kept. */
const KEEP_MS = 24 * 3600_000;
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20251110.03.00", hl: "en" };

const watchUrl = (id: string) => `https://music.youtube.com/watch?v=${id}`;

/** The video a `navigation/resolve_url` answer opens; null when it opens something else (an unknown video: the home page). */
export function resolvedRedirect(answer: unknown): string | null {
  const id = (answer as { endpoint?: { watchEndpoint?: { videoId?: unknown } } } | null)?.endpoint?.watchEndpoint?.videoId;
  return typeof id === "string" && VIDEO_ID.test(id) ? id : null;
}

// In the page the endpoint is JSON inside a script, its quotes plain, backslashed or written \x22.
const Q = String.raw`(?:\\?"|\\x22)`;
const INITIAL = new RegExp(String.raw`INITIAL_ENDPOINT.{0,400}?videoId${Q}\s*:\s*${Q}([\w-]{11})`, "s");
const WATCH = new RegExp(String.raw`watchEndpoint${Q}\s*:\s*(?:\{|\\x7b)${Q}videoId${Q}\s*:\s*${Q}([\w-]{11})`);

/** The video a YouTube Music watch page opens (its `INITIAL_ENDPOINT`, else its first watch endpoint); null when none. */
export function pageRedirect(html: string): string | null {
  return (INITIAL.exec(html) ?? WATCH.exec(html))?.[1] ?? null;
}

async function viaResolver(id: string): Promise<string | null> {
  const res = await (config.fetch ?? fetch)("https://music.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA, origin: "https://music.youtube.com" },
    body: JSON.stringify({ context: { client: { ...CLIENT, gl: config.location.toUpperCase() } }, url: watchUrl(id) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`resolve_url: HTTP ${res.status}`);
  return resolvedRedirect(await res.json());
}

async function viaPage(id: string): Promise<string | null> {
  const res = await (config.fetch ?? fetch)(watchUrl(id), {
    headers: { "user-agent": UA, "accept-language": "en" },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // A redirect here is YouTube's "unusual traffic" page, not an answer.
  if (res.status !== 200) throw new Error(`watch page: HTTP ${res.status}`);
  return pageRedirect(await res.text());
}

const known = new Map<string, { at: number; id: string | null }>();
const asking = new Map<string, Promise<string | null>>();

/**
 * Where YouTube Music moved video `id`: the new video's ID, `id` itself when it wasn't moved, null when YouTube Music
 * doesn't know it. Rejects when neither the resolver nor the watch page answered (10 s each); answers are kept a day.
 */
export function musicRedirect(id: string): Promise<string | null> {
  const k = known.get(id);
  if (k && Date.now() - k.at < KEEP_MS) return Promise.resolve(k.id);
  let job = asking.get(id);
  if (!job) {
    job = viaResolver(id)
      .catch(() => viaPage(id))
      .then((moved) => {
        known.set(id, { at: Date.now(), id: moved });
        return moved;
      })
      .finally(() => asking.delete(id));
    asking.set(id, job);
  }
  return job;
}
