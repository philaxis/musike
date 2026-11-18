export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  thumb: string;
  art: string;
  kind: "song" | "video";
  /** A file in one of the server's music folders (id `L` + 20 chars); YouTube otherwise. */
  source?: "local";
  year?: number;
  /** From the server, never stored: the local file is gone or its folder can't be read right now. */
  unavailable?: boolean;
  /** From the server, never stored: this YouTube track has a copy kept on the server. */
  kept?: boolean;
}

/** One of the server's music folders. `online` is false while it can't be read (say, the drive isn't mounted). */
export interface LocalRoot {
  name: string;
  path: string;
  online: boolean;
  albums: number;
  tracks: number;
}

/** A folder of a music root, or a file directly in the root (an album of its own). */
export interface LocalAlbum {
  root: string;
  key: string;
  name: string;
  year?: number;
  cover: string;
  trackCount: number;
  duration: number;
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

export interface Genre {
  id: string;
  name: string;
}

export interface GenreArtist {
  id: string;
  name: string;
  /** Cover of one of their releases in the genre. */
  thumb: string;
  art: string;
  /** A few of their songs in the genre. */
  hits: string[];
}

export interface GenrePage {
  id: string;
  name: string;
  /** First page of artists; `api.genreArtists` brings the next ones. */
  artists: GenreArtist[];
  hasMoreArtists: boolean;
  tracks: Track[];
}

/** An album or single as a cover in a list. */
export interface AlbumCard {
  id: string;
  title: string;
  /** Empty on an artist's own page. */
  artist: string;
  year: string;
  thumb: string;
  art: string;
}

export interface ArtistPage {
  id: string;
  name: string;
  description: string;
  banner: string;
  tracks: Track[];
  albums: AlbumCard[];
  singles: AlbumCard[];
}

export interface AlbumPage {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  /** YouTube Music's own lines, already in the app language: "Album • 1991", "13 songs • 49 minutes". */
  kind: string;
  info: string;
  thumb: string;
  art: string;
  tracks: Track[];
}
