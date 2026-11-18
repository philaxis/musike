# Tasks

- [x] 1.1 서버 `works.ts`: 덩어리(`units`, 악장 있는 곡 둘 이상), 덩어리 줄 `unitRow`·`unitRows`, 작품 화면 곡의 `work` — 확인: `server/test/workUnits.test.ts`
- [x] 1.2 서버 라디오(덩어리 씨앗·후보·아티스트 제한), 자동 재생목록(대표로 바꾸기, 들은 횟수), 장르·소리 묶음·지도 곡 — 확인: 같은 테스트
- [x] 1.3 서버 재생목록·즐겨찾기에 덩어리 줄 → 악장(`storedBodies`)
- [x] 2.1 웹 플레이어: 덩어리 줄 펼치기, 작품 화면 악장 이어 붙이기(`joinMovements`), 라디오 1악장부터·재생 중 악장부터, 대기열 끝 라디오
- [x] 2.2 웹 목록: 덩어리 줄(「N악장」 표·펼치기·악장 제목·통째 메뉴), 대기열 「N악장」, 지도, 섞어 재생(`shuffledWorks`), 재생목록·즐겨찾기 넣기
- [x] 2.3 i18n(ko·en·pt), AGENTS.md API 표
- [x] 3.1 확인: `pnpm typecheck`, `pnpm --filter ./server test`, `pnpm build`, 시험 서버(운영 데이터·분석 사본) Playwright 파이어폭스 PC·폰 스크린샷
