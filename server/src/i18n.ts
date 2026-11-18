/**
 * Messages the server sends to people (errors, update progress), in every language the app speaks.
 * They are kept as keys and translated when sent, so each device gets its own language.
 */

export type Lang = "en" | "pt-BR" | "ko";
type Params = Record<string, string | number>;

const en = {
  invalidVideoId: "Invalid video ID.",
  emptyQuery: "Type something to search.",
  searchFailed: "Search is unavailable right now ({detail}). Try again in a moment.",
  missingTitle: "Give the song's title.",
  notBackup: "This file isn't a Musike backup.",
  newerBackup: "This backup was made by a newer Musike. Update the app to import it.",
  idMismatch: "The ID doesn't match.",
  tracksRequired: "Send a list of tracks.",
  invalidGenre: "Invalid genre.",
  invalidOffset: "Invalid position.",
  invalidArtist: "Invalid artist.",
  routeNotFound: "Route not found.",
  noFreePort: "No free port between {from} and {to}.",
  invalidTrack: "Invalid track.",
  playlistNotFound: "Playlist not found.",
  playlistNameRequired: "Give the playlist a name.",
  genresUnavailable: "Couldn't load the genres right now. Try again.",
  genreUnavailable: "Couldn't open this genre right now. Try again.",
  genreEmpty: "Nothing found for this genre.",
  artistUnavailable: "Couldn't open this artist right now. Try again.",
  artistNotFound: "Artist not found.",
  albumUnavailable: "Couldn't open this album right now. Try again.",
  albumNotFound: "Album not found.",
  invalidAlbum: "Invalid album.",
  ytdlpMissing: "yt-dlp wasn't found on this computer. Open Settings in Musike to install it.",
  ytdlpTimeout: "yt-dlp took too long to answer.",
  ytdlpCantRun: "Couldn't run yt-dlp ({error}). Open Settings in Musike.",
  botCheck: "YouTube is asking this connection to prove it's not a bot. If you're on a VPN, turn it off and try again.",
  videoUnavailable: "This video isn't available on YouTube.",
  ageRestricted: "Age-restricted video. It needs cookies from a signed-in account.",
  ytdlpFailed: "yt-dlp failed.",
  ytdlpOutdated: "{detail} YouTube may have changed: update yt-dlp in Settings.",
  noAudio: "No audio format available for this video.",
  noSdVideo: "This video has no combined SD version. Use HD.",
  streamRefused: "YouTube refused the stream (HTTP {status}). Try updating yt-dlp in Settings.",
  noWinget: "yt-dlp wasn't found and winget isn't available. Install it manually: https://github.com/yt-dlp/yt-dlp",
  installingYtdlp: "Installing yt-dlp",
  updatingYtdlp: "Updating yt-dlp",
  directUpdateFailed: "Direct update failed, trying winget",
  downloadingTools: "Downloading yt-dlp and Deno from GitHub",
  alreadyLatest: "Already on the latest version ({version})",
  ytdlpReady: "yt-dlp {version} is ready to use",
  updateFailed: "Couldn't update yt-dlp.",
  toolMissing: "{tool} wasn't found on this computer.",
  downloadFailed: "Downloading {tool} failed (HTTP {status}).",
  ffmpegPackage: "Unexpected FFmpeg package.",
  invalidTrackId: "Invalid track ID.",
  notPermutation: "Send every track ID of the playlist exactly once, in the new order.",
  localNotFound: "This file isn't in the music folders.",
  localOffline: "This music folder can't be read right now.",
  localRootNotFound: "Music folder not found.",
  noCover: "This track has no cover.",
  notPlaylistUrl: "That isn't a YouTube playlist link.",
  loginRequired: "Lists that need a sign-in (Liked videos, Watch later) can't be imported.",
  playlistEmpty: "This playlist has no playable videos.",
  keepYoutubeOnly: "Only YouTube tracks can be kept on the server.",
  keepNotFound: "There is no kept copy of this track.",
};

export type MsgKey = keyof typeof en;

const pt: Record<MsgKey, string> = {
  invalidVideoId: "ID de vídeo inválido.",
  emptyQuery: "Digite algo para buscar.",
  searchFailed: "A busca está indisponível agora ({detail}). Tente de novo em instantes.",
  missingTitle: "Informe o título da música.",
  notBackup: "Este arquivo não é um backup do Musike.",
  newerBackup: "Backup de uma versão mais nova do Musike. Atualize o app para importar.",
  idMismatch: "ID não confere.",
  tracksRequired: "Envie uma lista de faixas.",
  invalidGenre: "Gênero inválido.",
  invalidOffset: "Posição inválida.",
  invalidArtist: "Artista inválido.",
  routeNotFound: "Rota não encontrada.",
  noFreePort: "Nenhuma porta livre entre {from} e {to}.",
  invalidTrack: "Faixa inválida.",
  playlistNotFound: "Playlist não encontrada.",
  playlistNameRequired: "Dê um nome à playlist.",
  genresUnavailable: "Não foi possível carregar os gêneros agora. Tente de novo.",
  genreUnavailable: "Não foi possível abrir este gênero agora. Tente de novo.",
  genreEmpty: "Nada encontrado para este gênero.",
  artistUnavailable: "Não foi possível abrir este artista agora. Tente de novo.",
  artistNotFound: "Artista não encontrado.",
  albumUnavailable: "Não foi possível abrir este álbum agora. Tente de novo.",
  albumNotFound: "Álbum não encontrado.",
  invalidAlbum: "Álbum inválido.",
  ytdlpMissing: "O yt-dlp não foi encontrado neste computador. Abra Ajustes no Musike para instalar.",
  ytdlpTimeout: "O yt-dlp demorou demais para responder.",
  ytdlpCantRun: "Não foi possível executar o yt-dlp ({error}). Abra Ajustes no Musike.",
  botCheck: "O YouTube está pedindo para esta conexão provar que não é um robô. Se estiver usando VPN, desligue e tente de novo.",
  videoUnavailable: "Vídeo indisponível no YouTube.",
  ageRestricted: "Vídeo com restrição de idade. Requer cookies de uma conta logada.",
  ytdlpFailed: "Falha no yt-dlp.",
  ytdlpOutdated: "{detail} O YouTube pode ter mudado: atualize o yt-dlp em Ajustes.",
  noAudio: "Nenhum formato de áudio disponível para este vídeo.",
  noSdVideo: "Este vídeo não tem versão SD combinada. Use HD.",
  streamRefused: "O YouTube recusou o stream (HTTP {status}). Tente atualizar o yt-dlp em Ajustes.",
  noWinget: "yt-dlp não encontrado e o winget não está disponível. Instale manualmente: https://github.com/yt-dlp/yt-dlp",
  installingYtdlp: "Instalando yt-dlp",
  updatingYtdlp: "Atualizando yt-dlp",
  directUpdateFailed: "Atualização direta falhou, tentando pelo winget",
  downloadingTools: "Baixando yt-dlp e Deno do GitHub",
  alreadyLatest: "Já está na versão mais recente ({version})",
  ytdlpReady: "yt-dlp {version} pronto para uso",
  updateFailed: "Não foi possível atualizar o yt-dlp.",
  toolMissing: "{tool} não encontrado neste computador.",
  downloadFailed: "Download de {tool} falhou (HTTP {status}).",
  ffmpegPackage: "Pacote do FFmpeg inesperado.",
  invalidTrackId: "ID de faixa inválido.",
  notPermutation: "Envie cada ID de faixa da playlist exatamente uma vez, na nova ordem.",
  localNotFound: "Este arquivo não está nas pastas de música.",
  localOffline: "Esta pasta de música não pode ser lida agora.",
  localRootNotFound: "Pasta de música não encontrada.",
  noCover: "Esta faixa não tem capa.",
  notPlaylistUrl: "Isso não é um link de playlist do YouTube.",
  loginRequired: "Listas que exigem login (vídeos curtidos, Assistir mais tarde) não podem ser importadas.",
  playlistEmpty: "Esta playlist não tem vídeos reproduzíveis.",
  keepYoutubeOnly: "Só faixas do YouTube podem ser guardadas no servidor.",
  keepNotFound: "Não há cópia guardada desta faixa.",
};

const ko: Record<MsgKey, string> = {
  invalidVideoId: "영상 번호가 올바르지 않아요.",
  emptyQuery: "찾을 말을 입력해 주세요.",
  searchFailed: "지금은 검색이 안 돼요({detail}). 잠시 뒤 다시 해 주세요.",
  missingTitle: "곡 제목을 알려 주세요.",
  notBackup: "Musike 백업 파일이 아니에요.",
  newerBackup: "더 새 Musike에서 만든 백업이에요. 앱을 업데이트한 뒤 가져와 주세요.",
  idMismatch: "번호가 맞지 않아요.",
  tracksRequired: "곡 목록을 보내 주세요.",
  invalidGenre: "장르가 올바르지 않아요.",
  invalidOffset: "위치가 올바르지 않아요.",
  invalidArtist: "가수가 올바르지 않아요.",
  routeNotFound: "없는 주소예요.",
  noFreePort: "{from}부터 {to}까지 빈 포트가 없어요.",
  invalidTrack: "곡 정보가 올바르지 않아요.",
  playlistNotFound: "재생목록을 찾을 수 없어요.",
  playlistNameRequired: "재생목록 이름을 정해 주세요.",
  genresUnavailable: "지금은 장르를 불러올 수 없어요. 다시 해 주세요.",
  genreUnavailable: "지금은 이 장르를 열 수 없어요. 다시 해 주세요.",
  genreEmpty: "이 장르에서 찾은 게 없어요.",
  artistUnavailable: "지금은 이 가수를 열 수 없어요. 다시 해 주세요.",
  artistNotFound: "가수를 찾을 수 없어요.",
  albumUnavailable: "지금은 이 앨범을 열 수 없어요. 다시 해 주세요.",
  albumNotFound: "앨범을 찾을 수 없어요.",
  invalidAlbum: "앨범이 올바르지 않아요.",
  ytdlpMissing: "이 컴퓨터에서 yt-dlp를 찾지 못했어요. Musike 설정에서 설치해 주세요.",
  ytdlpTimeout: "yt-dlp가 너무 오래 답하지 않아요.",
  ytdlpCantRun: "yt-dlp를 실행하지 못했어요({error}). Musike 설정을 열어 주세요.",
  botCheck: "유튜브가 이 연결이 로봇이 아닌지 확인하려고 해요. VPN을 쓰고 있다면 끄고 다시 해 주세요.",
  videoUnavailable: "유튜브에서 볼 수 없는 영상이에요.",
  ageRestricted: "나이 제한 영상이에요. 로그인한 계정의 쿠키가 필요해요.",
  ytdlpFailed: "yt-dlp가 실패했어요.",
  ytdlpOutdated: "{detail} 유튜브가 바뀌었을 수 있어요. 설정에서 yt-dlp를 업데이트해 주세요.",
  noAudio: "이 영상에는 받을 수 있는 소리가 없어요.",
  noSdVideo: "이 영상에는 SD 합본이 없어요. HD로 봐 주세요.",
  streamRefused: "유튜브가 재생을 거절했어요(HTTP {status}). 설정에서 yt-dlp를 업데이트해 보세요.",
  noWinget: "yt-dlp가 없고 winget도 쓸 수 없어요. 직접 설치해 주세요: https://github.com/yt-dlp/yt-dlp",
  installingYtdlp: "yt-dlp 설치 중",
  updatingYtdlp: "yt-dlp 업데이트 중",
  directUpdateFailed: "바로 업데이트하지 못해 winget으로 해 볼게요",
  downloadingTools: "GitHub에서 yt-dlp와 Deno 받는 중",
  alreadyLatest: "이미 최신 판이에요({version})",
  ytdlpReady: "yt-dlp {version} 준비 완료",
  updateFailed: "yt-dlp를 업데이트하지 못했어요.",
  toolMissing: "이 컴퓨터에서 {tool}을(를) 찾지 못했어요.",
  downloadFailed: "{tool} 받기에 실패했어요(HTTP {status}).",
  ffmpegPackage: "FFmpeg 꾸러미가 예상과 달라요.",
  invalidTrackId: "곡 번호가 올바르지 않아요.",
  notPermutation: "재생목록의 곡 번호를 하나도 빠짐없이 한 번씩, 새 순서로 보내 주세요.",
  localNotFound: "음악 폴더에 없는 파일이에요.",
  localOffline: "지금은 이 음악 폴더를 읽을 수 없어요.",
  localRootNotFound: "음악 폴더를 찾을 수 없어요.",
  noCover: "이 곡에는 표지가 없어요.",
  notPlaylistUrl: "유튜브 재생목록 링크가 아니에요.",
  loginRequired: "로그인이 필요한 목록은 못 가져와요",
  playlistEmpty: "이 재생목록에는 틀 수 있는 영상이 없어요.",
  keepYoutubeOnly: "유튜브 곡만 서버에 받아 둘 수 있어요.",
  keepNotFound: "이 곡은 받아 둔 파일이 없어요.",
};

const CATALOG: Record<Lang, Record<MsgKey, string>> = { en, "pt-BR": pt, ko };

/** A message translated when it is sent: a key plus the values for its {placeholders}. */
export interface Msg {
  key: MsgKey;
  params?: Params;
}

/** Something to show a person: a message to translate, or text that needs none (tool output). */
export type Text = Msg | string;

export const msg = (key: MsgKey, params?: Params): Msg => ({ key, params });

export function tr(lang: Lang, text: Text): string {
  if (typeof text === "string") return text;
  return CATALOG[lang][text.key].replace(/\{(\w+)\}/g, (all, name: string) => String(text.params?.[name] ?? all));
}

export const isLang = (v: unknown): v is Lang => v === "en" || v === "pt-BR" || v === "ko";

/** The language a request asked for. The app always says; anything else (media elements, curl) gets English. */
export function langOf(req: { headers: Record<string, string | string[] | undefined> }): Lang {
  const asked = req.headers["x-musike-lang"];
  return isLang(asked) ? asked : "en";
}

/** The code YouTube Music uses for its own words (genre names, artist bios). */
export const youtubeLang = (lang: Lang) => (lang === "pt-BR" ? "pt" : lang === "ko" ? "ko" : "en");
