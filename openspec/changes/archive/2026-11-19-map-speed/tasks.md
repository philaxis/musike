# Tasks

- [x] 1.1 분석기 `mapbuild.render`: `points`·`detail` 나눔, 해시 이름 파일(웹 파일·검색 자료 사본), `files.json`, 옛 해시 파일 지우기; `build`는 `vectors_e5.bin`만(`search_meta.json` 안 씀) — 확인: `analysis/tests/test_mapbuild.py`
- [x] 1.2 지도 페이지: 머리에서 첫 화면 자료를 바로 받기, 스크립트는 이름표로, 첫 그림 뒤 `mapready`·`detail`, 숨김(`visible`) 때 그리기 멈춤, 자료 실패 알림(`failed`), 글꼴 CSS가 그림을 막지 않게
- [x] 1.3 `search.js`: 검색 항목은 지도 점에서, 곡 벡터는 처음 의미 검색 때; `soundsearch.js`: 해시 이름
- [x] 2.1 서버 `mapRoutes.ts`: 해시 이름은 `immutable`, brotli(뒤에서 한 번)·gzip, `.bin` 압축, `/api/taste/map`이 압축을 미리 — 확인: `server/test/map.test.ts`
- [x] 3.1 웹 `MusicMap.tsx`: 처음 연 뒤 앱 틀에 살려 두기(숨김·보임 알림, `#v=` 링크), 불러오는 중·실패 표시, i18n ko·en·pt
- [x] 4.1 확인: `pnpm typecheck`, `pnpm --filter ./server test`, `pnpm build`, `analysis` pytest, 시험 출력 폴더에 `map` 명령, 시험 서버 + Playwright 파이어폭스(기능 PC·폰, 바이트·시간 전후 비교, 2 Mbit/s 프록시)
