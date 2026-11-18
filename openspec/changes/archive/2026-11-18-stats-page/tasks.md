# Tasks

- [x] 1.1 서버 `server/src/stats.ts`: 규칙(한 번 들음·건너뜀·기간·서울 날짜), `plays.jsonl` 스트림 읽기와 메모, `GET /api/stats`, `/api/stats/day/:date`, `/api/stats/track/:id` — 확인: `server/test/stats.test.ts`(정확히 30초, 길이 0, 29·30초 넘김, 4주 경계, 새로 알게 된 곡, 잊고 있던 애창곡, 장르, 하루·곡 하나)
- [x] 1.2 분석 결과 `taste.json` 장르 읽기(없으면 `null`) — 확인: 테스트, 시험 서버에서 폴더 있을 때(장르 칸 보임)·없을 때(`MUSIKE_ANALYSIS_DIR` 빈 곳, 장르 칸 없음)
- [x] 1.3 오늘 좋음 `data/daylikes.json`, `GET/PUT/DELETE /api/daylikes` — 확인: 시험 서버 curl(넣기·그날 목록·빼기·번호 다르면 400)
- [x] 2.1 웹 ☀ 단추(PC 막대, 지금 재생 패널·폰 화면, 영상 크게 보기) — 확인: Playwright 화면, 누른 뒤 서버 오늘 목록에 들어감
- [x] 2.2 보관함 「내 기록」 타일과 `/library/stats` 페이지(기간, 숫자, 달력, 날짜 누르기, 시간대, 목록, 빈 상태, 기록 적음 안내) — 확인: Playwright PC·폰 화면(4주·전체·날짜 누른 뒤·빈 상태)
- [x] 2.3 곡 메뉴 「이 곡 기록」 창 — 확인: Playwright 화면
- [x] 3.1 i18n 세 곳, `AGENTS.md` API 표
