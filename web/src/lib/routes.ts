/** Every page's address, in one place. */
export const paths = {
  home: "/",
  search: "/search",
  searchList: "/search/list",
  genre: (id: string) => `/search/genre/${encodeURIComponent(id)}`,
  artist: (id: string) => `/search/artist/${id}`,
  album: (id: string) => `/search/album/${id}`,
  library: "/library",
  favorites: "/favorites",
  history: "/history",
  playlist: (id: string) => `/playlist/${id}`,
  /** My music: a server folder's albums, and one album's tracks. */
  localRoot: (root: string) => `/library/local/${encodeURIComponent(root)}`,
  localAlbum: (root: string, key: string) => `/library/local/${encodeURIComponent(root)}/album?key=${encodeURIComponent(key)}`,
  /** The song box, filtered: `filter=untagged`, `by=source|tag` (picking), `source=kind:ref`, `tag=…`. */
  box: (query: Record<string, string> = {}) => {
    const q = new URLSearchParams(query).toString();
    return `/library/box${q ? `?${q}` : ""}`;
  },
  /** 「내 기록」: listening stats, `?period=4w|6m|all`. */
  stats: "/library/stats",
  /** Where Google sign-in returns (`?google=connected|error`): opens Settings. */
  settings: "/settings",
  /** Direct links (sent by the assistant or notifications): play a track, or a playlist from the start, on this device. */
  playLink: (id: string) => `/play/${id}`,
  listLink: (id: string) => `/list/${id}`,
  /** A file on the server by its absolute path (download notifications). */
  openFile: "/open",
};

/** Hash that opens the full-screen Now Playing sheet on phones (so Back closes it). */
export const NOW_PLAYING_HASH = "now-playing";

// Musike 1.1 and earlier used Portuguese addresses; bookmarks and installed shortcuts may still point there.
const LEGACY_PATHS: [string, string][] = [
  ["/buscar/lista", paths.searchList],
  ["/buscar/genero/", "/search/genre/"],
  ["/buscar/artista/", "/search/artist/"],
  ["/buscar", paths.search],
  ["/biblioteca", paths.library],
  ["/favoritas", paths.favorites],
  ["/historico", paths.history],
];

/** The current address for an old one, or null when it is already current. */
export function legacyRedirect(pathname: string, search: string, hash: string): string | null {
  let path = pathname;
  for (const [from, to] of LEGACY_PATHS) {
    if (pathname === from || pathname.startsWith(from.endsWith("/") ? from : `${from}/`)) {
      path = to + pathname.slice(from.length);
      break;
    }
  }
  let query = search;
  const params = new URLSearchParams(search);
  if (params.has("tipo") || params.has("ver")) {
    if (params.get("tipo") === "videos") params.set("type", "videos");
    if (params.get("ver") === "musicas") params.set("view", "songs");
    params.delete("tipo");
    params.delete("ver");
    query = params.toString() ? `?${params}` : "";
  }
  const fragment = hash === "#tocando" ? `#${NOW_PLAYING_HASH}` : hash;
  const next = path + query + fragment;
  return next === pathname + search + hash ? null : next;
}
