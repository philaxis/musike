# Proposal: 유튜브 곡 표지가 회색 「…」로 나오는 문제 고치기

## Why

사용자 11-18(화면 그림): 「최근 재생」과 「재생 중」 칸에서 유튜브 곡 표지가 회색 「…」 그림으로 나오는 일이 많다. 큰 표지(`hq720.jpg`)는 오래된 영상에 없고, 유튜브는 이때 오류(404)와 함께 120×90 회색 그림을 보낸다. 브라우저는 그 그림을 정상으로 그려 오류 처리(`onError` → 작은 표지)가 돌지 않는다. 예: `r7jkrDBkMGI`는 hq720·maxresdefault·sddefault 404(120×90), hqdefault·mqdefault 200.

## What Changes

- 웹의 표지 그림(`Artwork`)이 120×90 유튜브 그림을 받으면 실패로 보고 대체 표지로 넘어간다. 대체 표지가 따로 없으면 같은 영상의 `mqdefault.jpg`(늘 있음)를 쓴다.

## Capabilities

### New Capabilities

- `youtube-thumbs`: 유튜브 곡 표지 고르기.

### Modified Capabilities

(없음)

## Impact

- `web/src/components/Artwork.tsx`
