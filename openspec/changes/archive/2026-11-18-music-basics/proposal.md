# Proposal: 음악 앱이면 기본으로 되는 것들

## Why

사용자 11-18: "우클릭이 안 먹히고, 선택한 다음에 집어넣기도 없고, 앨범 전체를 플레이리스트에 넣을 수도 있게… 음악앱이면 기본적으로 만족해야 하는 것." 곡 상자 줄은 우클릭이 안 되고, 여러 곡 고르기는 곡 상자·목록 찾기에만 있었으며, 앨범 카드·재생목록·폴더는 통째로 다룰 메뉴가 없었다.

## What Changes

- 곡·앨범·재생목록·폴더가 보이는 곳 어디서나 우클릭(데스크톱)과 길게 누르기(폰)로 ⋯와 같은 메뉴. 브라우저 메뉴는 뜨지 않는다.
- 모든 곡 목록에서 여러 곡 고르기(Ctrl/Cmd 클릭, Shift 범위, 체크 칸, Ctrl+A, Esc)와 고른 곡 막대(재생·다음에 재생·대기열·재생목록·즐겨찾기·재생목록에서 빼기). `components/Selection.tsx` 하나로 곡 상자와 목록이 같이 쓴다.
- 앨범·재생목록·폴더 통째 메뉴(재생·섞어 재생·다음에 재생·대기열·재생목록에 추가·숨기기/이름 바꾸기/지우기).
- 데스크톱에서 곡(또는 고른 곡)을 옆 메뉴 재생목록·즐겨찾기로 끌어 놓기.
- 대기열에서 끌어서 순서 바꾸기, 빼기·비우기에 되돌리기.
- 단축키: 곡을 누른 뒤에도 스페이스가 재생/일시정지, Ctrl/Cmd+F 검색, Ctrl+A·Esc 고르기.
- 재생목록에 이미 있는 곡을 넣으면 「이미 있는 N곡은 빼고 넣을까요?」(빼고 넣기 기본/모두 넣기). 서버: `POST /api/playlists/:pid/tracks`에 `duplicates: true`, `DELETE /api/playlists/:pid/tracks {at, ids}`(자리로 빼기), 순서 바꾸기는 같은 곡 두 번을 허용, 한 번에 5000곡까지.
- 넣기·빼기 알림마다 「되돌리기」.

## Capabilities

### New Capabilities

- `player-basics`: 메뉴, 여러 곡 고르기, 통째 다루기, 끌어 놓기, 대기열, 단축키, 겹치는 곡.

### Modified Capabilities

(없음)

## Impact

- 서버: `server/src/library.ts`, `server/src/app.ts`, `server/src/i18n.ts`, 시험.
- 웹: 새 `components/menuTrigger.ts`, `components/menus.ts`, `components/TrackDrag.tsx`; `Selection.tsx`, `TrackList.tsx`, `TrackMenu.tsx`, `Queue.tsx`, `Rail.tsx`, `Dialogs.tsx`, `reorder.ts`, `AlbumTiles.tsx`, `LocalRoots.tsx`, `NowPlaying.tsx`, `PlayerBar.tsx`, 보기 화면들, `stores/{ui,library}.ts`, `player/player.ts`, `hooks/useShortcuts.ts`, i18n. `HideMenu`는 메뉴로 옮겨 지움.
