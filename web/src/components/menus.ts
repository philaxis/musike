import { EyeIcon, EyeSlashIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { getT } from "../i18n";
import { api } from "../lib/api";
import { server } from "../lib/server";
import type { AlbumCard, LocalAlbum, LocalRoot, Playlist } from "../lib/types";
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
