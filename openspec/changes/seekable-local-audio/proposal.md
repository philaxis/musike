# Proposal: 내 음악 곡이 원격 파이어폭스에서 재생 도중 끊기는 문제

## Why

사용자 11-18(화면 그림): 밖에서 파이어폭스로 타츠로 곡을 들으면 「재생하지 못했어요 · 서버에 닿지 않아요」가 나고 다음 곡도 멈춘다. 같은 곡은 서버에서 바로 받으면 멀쩡하다. 서버 기록을 보니 끊긴 곡의 소리 요청은 끝나지 않은 채 남아 있었다. 소리만 떼어 보내는 곡(앨범 영상, 나눈 곡)은 길이를 모르는 채 흘려보내고 구간 요청(`Range`)을 무시해 처음부터 다시 보냈다. 파이어폭스는 미리 받아 둔 만큼 받고 내려받기를 멈췄다가 `Range: bytes=N-`로 이어 받는데, 처음부터 다시 오니 포기한다.

## What Changes

- 소리만 떼어 보내기를 FFmpeg bitexact로 바꿔 매번 같은 바이트가 나오게 하고, 처음 한 번 크기를 재어(메모리, 곡당 수 바이트) `Content-Length`·`Accept-Ranges`·206 `Content-Range`로 답한다. 구간 요청이 오면 처음부터 다시 만들어 그 구간만 보낸다(디스크에 저장 안 함).

## Capabilities

### New Capabilities

(없음)

### Modified Capabilities

- `local-library`: 소리만 보내는 곡도 구간 요청에 답한다.

## Impact

- `server/src/local.ts`(`streamLocalAudio`), `server/src/i18n.ts`
