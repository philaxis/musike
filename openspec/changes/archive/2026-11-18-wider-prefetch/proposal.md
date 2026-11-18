## Why
사용자는 지금 곡의 앞뒤 여러 곡이 바로 나오길 원한다. 지금은 다음 2곡·이전 1곡 주소만 미리 받고, 막 받은 주소는 googlevideo가 1~2초 거절해 처음 틀 때 그만큼 늦는다.

## What Changes
- 미리 주소를 받는 곡을 다음 3곡·이전 2곡으로 늘린다(소리를 미리 받는 곡은 여전히 다음 1곡뿐 — 폰 데이터).
- `/api/prepare`가 주소를 받은 뒤 googlevideo 주소가 열릴 때까지 기다려 둔다.

## Impact
- `web/src/player/player.ts` (`runAhead`, `neighbors`), `server/src/app.ts` (`/api/prepare`), `server/src/stream.ts` (`warmStream`)
