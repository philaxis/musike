# Proposal: 대기열에 지나간 곡 보이기

## Why

사용자 11-18: 대기열에서 뒤쪽 곡을 누르면 그 앞 곡들이 바로 없어진다. 실제로는 대기열에 남아 있지만 칸이 「지금 재생 중」과 「다음 곡」만 그려서 사라진 것처럼 보였다.

## What Changes

- 대기열 칸 맨 위에 「지나간 곡 N」(최근 50곡, 흐리게)을 둔다. 누르면 그 곡으로 돌아가고, ✕로 뺄 수 있다.
- 칸을 열면 「지금 재생 중」이 맨 위에 오게 스크롤해 둔다(지나간 곡은 위로 올리면 보임).

## Capabilities

### Modified Capabilities

- `player-basics`: 대기열 다루기.

## Impact

- `web/src/components/Queue.tsx`, i18n
