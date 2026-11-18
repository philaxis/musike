# Tasks

- [x] 1.1 서버 `mapRoutes.ts`: `/api/map/*` 정적(경로 탈출 막기, gzip, ETag), `/api/taste/map`, `POST /api/taste/map/tracks`(곡 상자·내 음악에서 한 번에, `tasteRoutes.lookup`) — 확인: `server/test/map.test.ts`(`..`·`%2e%2e`·심볼릭 링크, 폴더 없음, 지워진 영상 빠짐)
- [x] 2.1 분석기 `mapbuild.render` + `python -m musike_analysis map` — 확인: `analysis/tests/test_mapbuild.py`
- [x] 2.2 분석기 지도 페이지: Musike 다리 `player.js`(♥ = Musike 즐겨찾기), 내 파일 썸네일, 검색 결과 ▶·⋯, 개인 기록(`user.js`·`user.css`) 빼기, 직접 열면 `/library/map`
- [x] 3.1 웹 `/library/map` 화면(iframe, 메시지, 곡 메뉴, 지금 곡, 테마, 안내), 보관함 타일, i18n ko·en·pt
- [x] 3.2 AGENTS.md API·웹 경로 표
- [x] 4.1 확인: `pnpm typecheck`, `pnpm -C server test`, `pnpm build`, `analysis` pytest, 시험 출력 폴더에 `map` 명령, 시험 서버 + Playwright 파이어폭스 PC·폰 스크린샷
