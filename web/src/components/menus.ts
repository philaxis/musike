import { EyeIcon, EyeSlashIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { getT } from "../i18n";
import { api } from "../lib/api";
import { server, type Mix, type TasteGroupCard, type TrackWorks } from "../lib/server";
import { groupTitle, mixAbout, mixTitle } from "../lib/taste";
import type { AlbumCard, LocalAlbum, LocalRoot, Playlist, Track } from "../lib/types";
import { useLibrary } from "../stores/library";
import { useLocal } from "../stores/local";
import { toast, useUi, type MenuExtra, type MenuTarget } from "../stores/ui";
import { isTvMode } from "../tv/tvMode";

// Menus for things that hold tracks (albums, playlists, folders). TV mode only plays: no extras there.

const extras = (list: MenuExtra[]) => (isTvMode() ? [] : list);

export function playlistMenu(p: Playlist): MenuTarget {
  const t = getT();
  const edit = useUi.getState().setPlaylistEdit;
  return {
    kind: "group",
    title: p.name,
    sub: t.library.playlistSub(p.tracks.length),
    thumb: p.tracks[0]?.thumb,
    // Read when an entry is picked, so a change made meanwhile is included.
    load: async () => useLibrary.getState().playlists.find((x) => x.id === p.id)?.tracks ?? [],
    extras: extras([
      { label: t.collection.rename, icon: PencilSimpleIcon, run: () => edit({ kind: "rename", id: p.id }) },
      { label: t.collection.deletePlaylist, icon: TrashIcon, danger: true, run: () => edit({ kind: "delete", id: p.id }) },
    ]),
  };
}

export function favoritesMenu(): MenuTarget {
  const t = getT();
  const { favorites } = useLibrary.getState();
  return { kind: "group", title: t.nav.favorites, sub: t.common.tracks(favorites.length), load: async () => useLibrary.getState().favorites };
}

export function historyMenu(): MenuTarget {
  const t = getT();
  const { history } = useLibrary.getState();
  return { kind: "group", title: t.nav.recentlyPlayed, sub: t.common.tracks(history.length), load: async () => useLibrary.getState().history };
}

/** An album of a music folder; hiding it hides every one of its tracks. */
export function localAlbumMenu(a: LocalAlbum, inHiddenRoot = false): MenuTarget {
  const t = getT();
  const setHidden = async (hide: boolean) => {
    try {
      const { tracks } = await server.album(a.root, a.key, true);
      const target = { ids: tracks.map((x) => x.id) };
      await (hide ? useLocal.getState().hide(target) : useLocal.getState().unhide(target));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return {
    kind: "group",
    title: a.name,
    sub: [a.root, a.year, t.common.tracks(a.trackCount)].filter(Boolean).join(" · "),
    thumb: a.cover,
    load: async () => (await server.album(a.root, a.key, false)).tracks,
    // A hidden folder is shown again as a whole, not album by album.
    extras: inHiddenRoot
      ? []
      : extras([
          a.hidden
            ? { label: t.hide.unhide, icon: EyeIcon, run: () => void setHidden(false) }
            : { label: t.hide.hide, icon: EyeSlashIcon, run: () => void setHidden(true) },
        ]),
  };
}

/** A music folder: every album of it, in order. */
export function localRootMenu(r: LocalRoot): MenuTarget {
  const t = getT();
  const local = useLocal.getState();
  return {
    kind: "group",
    title: r.name,
    sub: r.online ? t.local.rootSub(r.albums, r.tracks) : t.local.offline,
    load: () => server.rootTracks(r.name),
    extras: extras([
      r.hidden
        ? { label: t.hide.unhide, icon: EyeIcon, run: () => void local.unhide({ root: r.name }) }
        : { label: t.hide.hideFolder, icon: EyeSlashIcon, run: () => void local.hide({ root: r.name }) },
    ]),
  };
}

/** A YouTube Music album card. */
export function youtubeAlbumMenu(a: AlbumCard): MenuTarget {
  return {
    kind: "group",
    title: a.title,
    sub: [a.artist, a.year].filter(Boolean).join(" · "),
    thumb: a.thumb,
    load: async () => (await api.album(a.id)).tracks,
  };
}

/** A sound group of the taste analysis: all of its tracks, most typical first. */
export function tasteGroupMenu(g: TasteGroupCard): MenuTarget {
  const t = getT();
  return {
    kind: "group",
    title: groupTitle(g, t),
    sub: t.taste.groupSub(g.size, g.artists),
    thumb: g.tracks[0]?.thumb,
    load: async () => (await server.tasteGroup(g.id)).tracks,
  };
}

/** An automatic playlist; its tracks came with the card. */
export function mixMenu(m: Mix): MenuTarget {
  const t = getT();
  return { kind: "group", title: mixTitle(m, t), sub: mixAbout(m, t), thumb: m.tracks[0]?.thumb, load: async () => m.tracks };
}

/** The album the analysis puts a track on: my tracks of it, or a local file's whole music-folder album. */
export function workAlbumMenu(a: NonNullable<TrackWorks["album"]>, thumb?: string): MenuTarget {
  const t = getT();
  const local = a.local;
  return {
    kind: "group",
    title: a.name,
    sub: t.common.tracks(a.count),
    thumb,
    load: async () => (local ? await server.album(local.root, local.key, false) : await server.workAlbum(a.key)).tracks,
  };
}

/** One performance of a work, its movements in order; `tracks` when the page already has them. */
export function performanceMenu(p: { key: string; work: string; performer: string; count: number }, thumb?: string, tracks?: Track[]): MenuTarget {
  const t = getT();
  return {
    kind: "group",
    title: p.work,
    sub: [p.performer || t.works.unknownPerformer, t.common.tracks(p.count)].join(" · "),
    thumb,
    load: async () => tracks ?? (await server.performance(p.key)).tracks,
  };
}
