export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  thumb: string;
  art: string;
  kind: "song" | "video";
  /** "local": a file in one of the server's music folders (see local.ts). Absent: YouTube. */
  source?: "local";
  year?: number;
  /** Response-only: a local file that is missing or whose folder is offline right now. */
  unavailable?: boolean;
  /** Response-only: a YouTube track with a copy kept on the server (see keep.ts). */
  kept?: boolean;
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
}

import { tr, type Text } from "./i18n.js";

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Local tracks: "L" + 20 base64url characters. */
export const LOCAL_ID = /^L[A-Za-z0-9_-]{20}$/;
/** Any track: a YouTube video ID or a local track ID. YouTube-only routes keep VIDEO_ID. */
export const TRACK_ID = /^([A-Za-z0-9_-]{11}|L[A-Za-z0-9_-]{20})$/;
export const isLocalId = (id: string) => LOCAL_ID.test(id);

/** Machine-readable reason so the web app can offer the right fix (e.g. "update yt-dlp"). */
export type ErrorCode = "tool_missing" | "maybe_outdated" | "bot_check";

/** An error for the person using the app: its text is translated into each request's language when sent. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public text: Text,
    public code?: ErrorCode,
  ) {
    super(tr("en", text));
  }
}
