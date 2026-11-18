# Proposal: 선택 모드, 대기열·재생목록 넣기 구분

## Why

사용자 11-18: 「지금 재생하고 있는 목록(대기열)」에 넣기와 재생목록에 넣기를 일괄 동작에서 구분해야 한다. Ctrl 클릭·Shift 드래그를 하면 「선택 모드」가 켜져야 한다(탐색기처럼).

## What Changes

- Ctrl/Cmd 클릭, Shift 클릭, Shift 드래그, 「여러 곡 고르기」는 선택 모드를 켠다. 켜져 있는 동안 그냥 클릭도 재생 대신 고르기/풀기이고, 다 풀어도 모드는 남는다. Esc나 ✕로 끈다.
- Shift를 누른 채 줄 위를 끌면 지나간 줄이 모두 골라진다(곡 끌어 옮기기 대신).
- 막대: 「다음에 재생」「대기열에 추가」 | 구분선 | 「재생목록에 추가」. 즐겨찾기는 하트만.
- 막대가 나타나고 사라질 때 줄이 튀지 않게 스크롤을 맞춘다.

## Capabilities

### Modified Capabilities

- `player-basics`: 여러 곡 고르기.

## Impact

- `web/src/components/Selection.tsx`, `TrackList.tsx`, `views/SongBox.tsx`, i18n
