# Proposal: 내 기록(들은 기록 통계)과 「오늘 좋음 ☀」

## Why

사용자 11-18(#26): 들은 기록(`plays.jsonl`)이 쌓이기 시작했으니 무엇을 얼마나 듣는지 보고 싶다. 고른 방향은 「보관함 안 내 기록 한 칸」과 「♥는 그대로 두고 지금 재생 칸에만 오늘 좋음 ☀」. 곡 줄마다 숫자를 붙이면 난잡하니, 곡 하나의 숫자는 곡 메뉴의 「이 곡 기록」에서만 본다.

## What Changes

- 보관함에 「내 기록」 타일, 페이지 `/library/stats`: 기간(4주·6개월·전체), 들은 시간·「한 번 들음」 횟수·새로 알게 된 곡·건너뜀 비율, 날짜 달력(누르면 그날 들은 곡과 그날 ☀ 곡), 듣는 시간대(0~23시), 많이 들은 곡 10·아티스트 10·장르(분석 결과가 있을 때)·「요즘 반복」·「잊고 있던 애창곡」.
- 지금 재생 칸(PC 아래 막대, 지금 재생 패널·폰 전체 화면)에 「오늘 좋음 ☀」 단추: 누르면 그날(서울 날짜) 목록에 넣고 다시 누르면 뺀다. ♥ 즐겨찾기와 따로.
- 곡 메뉴에 「이 곡 기록」: 들은 횟수, 처음·마지막으로 들은 날, 건너뛴 횟수.
- 계산은 서버가 한다. 「한 번 들음」·「건너뜀」 규칙은 계약(`#26`) 그대로.

## Capabilities

### New Capabilities

- `listening-stats`: 들은 기록 통계, 오늘 좋음, 곡 하나의 기록.

## Impact

- 서버: `server/src/stats.ts`(새: 통계 계산, 오늘 좋음 저장, 분석 결과의 장르 읽기), `server/src/app.ts`
- 웹: `web/src/views/Stats.tsx`(새), `web/src/components/TrackStats.tsx`(새), `web/src/stores/dayLikes.ts`(새), `Controls.tsx`·`PlayerBar.tsx`·`NowPlaying.tsx`·`TrackMenu.tsx`·`Library.tsx`·`App.tsx`·`lib/server.ts`·`lib/routes.ts`·`stores/ui.ts`, i18n 세 곳
- 데이터: `data/daylikes.json`(새, 작음). 분석 결과 폴더(`MUSIKE_ANALYSIS_DIR`, 기본 `~/.local/share/musike/analysis`)의 `taste.json`은 읽기만.
- 헤르메스 기술 문서의 API 표: `AGENTS.md` API 표에 더함.
