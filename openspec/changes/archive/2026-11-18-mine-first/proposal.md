# Proposal: 기본은 들여온 곡만

## Why

사용자 11-18: "기본적으로 내 앱 안에 들여온 노래만 나오게 하라." 검색은 유튜브 결과를 기본으로 보여 주고, 대기열이 끝나면 유튜브 라디오가 저절로 이어져 들여오지 않은 곡이 나왔다.

## What Changes

- 검색의 기본 「내 곡」: 곡 상자(내 폴더 포함)에서만 찾는다. 「유튜브」 탭을 눌러야 유튜브를 찾고, 그때만 유튜브 추천어·장르를 보인다. 링크 붙여 넣기는 그대로.
- 대기열이 끝난 뒤 유튜브 라디오 자동 재생은 기본으로 끈다(저장 이름을 바꿔 예전 켜짐 값도 꺼짐으로 시작). 대기열 칸의 스위치로 켤 수 있다.

## Capabilities

### New Capabilities

(없음)

### Modified Capabilities

- `song-box`: 검색 기본 범위.

## Impact

- `web/src/views/Search.tsx`, 새 `web/src/components/MineResults.tsx`(`LocalResults.tsx` 대신), `web/src/player/player.ts`, i18n
