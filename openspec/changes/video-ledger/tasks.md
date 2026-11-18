# Tasks

## 1. 스펙
- [x] 1.1 proposal·design·스펙 — 확인: `openspec validate video-ledger --strict`

## 2. 서버
- [x] 2.1 `ledger.ts`: 기록·사건 파일, `observe`(바뀐 것), 처음 기록, 재생 실패·성공, 바꿔 넣음·되돌림, 별칭(`aliasMap`·`resolveAlias`, `video-aliases.json`) — 확인: `server/test/ledger.test.ts`(제목 바뀜, 답에 없음 = 지워짐, 비공개, 막힘, 처음 기록 조용히, 재생 실패 상태 유지, a→b→c, 되돌림, 고리)
- [x] 2.2 확인이 snippet까지 읽어 기록에 넘김(`google.ts` `checkBox`), `POST /api/videos/check`, 재생 실패·성공(`app.ts`), 손으로 바꿔 넣기(`boxRoutes.ts`)
- [ ] 2.3 자동 바꿔 넣기·되돌리기(`standIn.ts`, #ytm-redirect 합친 뒤)에 기록 붙이기
- [x] 2.4 별칭 따라가기: 들은 기록(`loadPlays`)·「오늘 좋음」·취향 분석(`aliasSongs`)·라디오·지도 점 — 확인: 단위 시험(옛 번호 들음이 새 곡으로, 분석 옮김)
- [x] 2.5 API `GET /api/videos/events`·`/api/videos/:id`, AGENTS.md 표

## 3. 분석
- [x] 3.1 `aliases.carry_over`: 카드·글/소리 벡터·묶음을 새 번호로 — 확인: `analysis/tests/test_aliases.py`

## 4. 웹
- [x] 4.1 곡 상자 「변경 기록」 칩, 「이 곡 기록」 안 바뀐 것, i18n 세 곳

## 5. 확인
- [x] 5.1 운영 데이터 사본 시험 서버(:4270)에서 확인 한 번 — 확인(11-19): 처음 기록 3,418곡(바뀜 0), 확인 15초 3,418곡: 들을 수 있음 3,157 · 한국에서 막힘 260 · 나이 제한 1, 유튜브 제목이 곡 상자 제목과 다른 곡 0(채널도 0, 곡 상자는 11-18에 들여옴). 손으로 바꿔 넣기 `5rNil_8ZYV0 → dQw4w9WgXcQ`: 별칭 파일, 새 곡 「이 곡 기록」 3줄(옛 번호 것), 옛 번호 라디오·지도 점이 새 곡. 사본 기록을 옛 값으로 고쳐 다시 확인 → 제목 바뀜 2·채널 1·한국에서 막힘 2·지워짐 1 그대로 잡음
- [x] 5.2 Playwright 파이어폭스 390px·1280px 「변경 기록」·「이 곡 기록」 스크린샷 — 확인: 가로 넘침 0px, 7줄
- [x] 5.3 `pnpm typecheck`, `pnpm --filter ./server test`(123), 분석 pytest(17), `pnpm build`
