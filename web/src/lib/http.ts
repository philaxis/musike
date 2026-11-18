import { getLang, getT } from "../i18n";
import { ApiError } from "./apiTypes";

/** The server answers errors (and YouTube Music answers names, like genres) in the app's language. */
export const LANG_HEADER = "x-musike-lang";

/** A JSON request to the Musike server; errors come back as ApiError with the server's message. */
export async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      [LANG_HEADER]: getLang(),
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(rest.headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? getT().player.httpError(res.status), body.code);
  return body as T;
}
