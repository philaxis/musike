import type { Messages } from "../i18n";
import type { Mix } from "./server";

// Names shown for the taste analysis' sound groups and the automatic playlists (lib/server.ts).

/** A sound group's name; two of a genre with the same name are told apart by an artist (`tell`). */
export function groupTitle(g: { name: string | null; tell?: string | null }, t: Messages): string {
  if (!g.name) return t.taste.noGroup;
  return g.tell ? `${g.name} (${g.tell})` : g.name;
}

export function mixTitle(m: Mix, t: Messages): string {
  return m.kind === "daily" ? t.taste.daily(m.n ?? 1) : t.taste[m.kind];
}

/** What a mix is: a daily mix's sound group and artists, the others' rule. */
export function mixAbout(m: Mix, t: Messages): string {
  const about = {
    daily: t.taste.aboutDaily,
    onRepeat: t.taste.aboutOnRepeat,
    forgotten: t.taste.aboutForgotten,
    newForYou: t.taste.aboutNewForYou,
    upbeat: t.taste.aboutUpbeat,
    calm: t.taste.aboutCalm,
  }[m.kind];
  return m.kind === "daily" ? [m.name, m.artists.join(", ")].filter(Boolean).join(" · ") || about : about;
}
