export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  thumb: string;
  art: string;
  /** "bundle": several tracks played in order as one row (see Bundle); its parts are in the library's `bundles`. */
  kind: "song" | "video" | "bundle";
  /** "local": a file in one of the server's music folders (see local.ts). Absent: YouTube. */
  source?: "local";
  year?: number;
  /** Response-only: a local file that is missing or whose folder is offline right now. */
  unavailable?: boolean;
  /** Response-only: a YouTube track with a copy kept on the server (see keep.ts). */
  kept?: boolean;
  /** Response-only: a local track left out of "내 음악" (hidden.ts); only in listings asked to include hidden items. */
  hidden?: boolean;
  /** Response-only: why this YouTube track can't play here (the song box's last check, see google.ts `unplayable`). */
  blocked?: Unplayable;
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  tracks: Track[];
}

export interface Library {
  favorites: Track[];
  playlists: Playlist[];
  history: Track[];
  /** Absent in libraries saved before bundles existed. */
  bundles?: Bundle[];
}

/** Several tracks played in order as one track (a symphony's movements, a live set). */
export interface Bundle {
  id: string;
  title: string;
  artist?: string;
  parts: Track[];
  tags: string[];
}

import { tr, type Text } from "./i18n.js";

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Local tracks: "L" + 20 base64url characters. */
export const LOCAL_ID = /^L[A-Za-z0-9_-]{20}$/;
/** Bundles: "B" + 20 base64url characters. */
export const BUNDLE_ID = /^B[A-Za-z0-9_-]{20}$/;
/** Any track: a YouTube video ID, a local track ID or a bundle ID. YouTube-only routes keep VIDEO_ID. */
export const TRACK_ID = /^([A-Za-z0-9_-]{11}|[LB][A-Za-z0-9_-]{20})$/;
export const isLocalId = (id: string) => LOCAL_ID.test(id);
export const isBundleId = (id: string) => BUNDLE_ID.test(id);

/** Machine-readable reason so the web app can offer the right fix (e.g. "update yt-dlp", "connect Google again"). */
export type ErrorCode = "tool_missing" | "maybe_outdated" | "bot_check" | "google_login" | "unplayable";

/**
 * Why a YouTube video can't play on this server: blocked in its country, deleted (or rejected), private,
 * age-restricted, for YouTube Music Premium members only.
 */
export type Unplayable = "region" | "gone" | "private" | "age" | "premium";
export const UNPLAYABLE: Unplayable[] = ["region", "gone", "private", "age", "premium"];

/** An error for the person using the app: its text is translated into each request's language when sent. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public text: Text,
    public code?: ErrorCode,
    /** With code "unplayable": why. */
    public reason?: Unplayable,
  ) {
    super(tr("en", text));
  }
}

/** A video that won't play here, whatever is tried: skipped by the app instead of retried. */
export const unplayableError = (reason: Unplayable, text: Text) => new HttpError(reason === "age" ? 403 : 404, text, "unplayable", reason);
