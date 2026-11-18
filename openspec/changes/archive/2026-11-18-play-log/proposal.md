# Proposal: 들은 기록 쌓기

## Why

사용자 11-18(#26): 앞으로 앱에서 많이 들을 테니 통계·그날의 좋아요·자동 재생목록을 원한다. 어떤 화면을 고르든 들은 기록이 먼저 쌓여 있어야 하고, 지나간 날의 기록은 나중에 만들 수 없다. 그래서 화면 없이 기록만 먼저 켠다.

## What Changes

- 곡이 지금 곡에서 벗어날 때(끝남·넘김·창 닫힘) 기기마다 한 줄을 서버의 `plays.jsonl`에 덧붙인다: 시작·끝 시각, 곡 정보, 길이, 실제로 들은 초(건너뛴 구간·멈춘 시간 제외), 끝난 이유, 기기(폰/PC/TV).
- 「한 번 들음」 같은 판단은 읽을 때 한다(Last.fm 규칙 등). 2초 미만은 남기지 않는다.

## Capabilities

### New Capabilities

- `listening-log`: 들은 기록.

## Impact

- `server/src/plays.ts`(새), `server/src/app.ts`, `web/src/player/playLog.ts`(새), `web/src/main.tsx`
- 데이터: `~/.local/share/musike/data/plays.jsonl` (한 줄 약 250바이트, 하루 100곡이면 1년 약 9MB)
