# Proposal: 보관함에 「유튜브에서 들여온 곡」 보이기

## Why

사용자 11-18(화면 그림): "왜 노래는 유튜브에서 노래 아닌 것만 가져오고, 실제 노래는 안 가져옴?" 유튜브 계정에서 음악 재생목록 29개(3,418곡)는 곡 상자에 들어갔지만, 보관함에는 곡 상자 칸에 곡 수도 없고 「내 음악」에 yt-bulk가 받은 강의 영상(「유튜브 보관함」)만 보여서 노래가 안 들어온 것처럼 보였다.

## What Changes

- 보관함의 「곡 상자」 칸에 전체 곡 수를 보인다(여러 출처의 같은 곡은 한 번).
- 보관함에 「유튜브에서 들여온 곡」 칸: 들여온 유튜브 재생목록마다 이름·곡 수, 누르면 그 출처로 거른 곡 상자.
- `GET /api/box/sources`가 `total`(곡 상자 곡 수)도 준다.
- 운영: yt-bulk가 받은 강의 영상 폴더 「유튜브 보관함」은 숨긴다(숨기기 기능, 파일·알림 링크는 그대로).

## Capabilities

### New Capabilities

(없음)

### Modified Capabilities

- `song-box`: 보관함에서 출처별로 들어가기.

## Impact

- `server/src/box.ts`, `server/src/boxRoutes.ts`, `web/src/views/Library.tsx`, `web/src/views/SongBox.tsx`, `web/src/lib/server.ts`, i18n
