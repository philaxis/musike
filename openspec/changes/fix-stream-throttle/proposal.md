## Why
YouTube(googlevideo)가 끝을 정하지 않은 요청(`Range: bytes=N-`)을 곡 속도의 두 배쯤(소리 약 32 KB/s)으로 묶기 시작했다. 브라우저 재생기는 늘 그렇게 요청하므로, 건너뛰거나 미리 받기와 겹치면 소리가 끊기고 멈춘다(18분짜리 곡이 4:21에서 멈춤). 끝을 정한 요청은 제 속도(수십 MB/s)로 온다.

## What Changes
- 서버가 유튜브 소리·영상을 중계할 때 브라우저가 청한 범위를 2 MB씩 끝을 정한 요청으로 나눠 차례로 받아 한 응답으로 보낸다.
- 응답 머리(`content-length`, `content-range`)는 서버가 전체 크기로 직접 계산한다.
- 중간 조각에서 주소가 만료되면 주소를 새로 받아 그 자리부터 이어 받는다.

## Impact
- `server/src/stream.ts` (`proxyStream`)
