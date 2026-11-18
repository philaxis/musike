# Tasks

## 1. 스펙
- [x] 1.1 proposal·design·스펙 — 확인: `openspec validate smooth-next --strict`. 사용자 11-18 "치워 두기" 요구 반영

## 2. 서버
- [x] 2.1 못 트는 이유: `ytdlp.ts` 오류를 이유별로, 오류 응답에 `reason` — 확인: 시험 서버 `/api/prepare/X2KMDkyt-SM` → `code: "unplayable", reason: "region"`, 단위 시험
- [x] 2.2 `google.ts` `unplayable()`·`checkVideos()`, sync 뒤 확인, 처음 한 번 — 확인: 단위 시험(allowed/blocked, rejected, private, 없는 항목, 나이 제한), 시험 서버가 뜰 때 한 번 확인해 region 260·age 1(앞서 따로 잰 결과와 같음)
- [x] 2.3 `box.ts` `gone` → `blocked`, 치워 두기(목록·출처·꼬리표·검색·taste·stats에서 빠짐), `applyChecks`, `replaceEntry`, `was`로 다시 안 들어옴 — 확인: 단위 시험
- [x] 2.4 다른 판 후보·바꾸기 API, `library.replaceTrack` — 확인: 단위 시험(출처·꼬리표·재생목록 자리·즐겨찾기·묶음 유지), 시험 서버 후보 5개

## 3. 웹
- [x] 3.1 미리 갖고 있기 — 확인: 파이어폭스 넘김 시간(유튜브 다음 260→54ms, 곡 끝 416→70ms, 내 파일 다음 601→42ms, 곡 끝 436→53ms), 페이드 4초에서 미리 받은 덱으로 4초 겹침
- [x] 3.2 못 트는 곡 건너뛰기·조용한 알림·직접 고르면 이유 — 확인: 표시 없는 X2KMDkyt-SM이 낀 대기열에서 미리 확보가 「못 틀음」을 달고, 앞 곡이 끝나면 오류 창 없이 다음 곡 + 「한국에서 막힌 곡 1개를 건너뛰었어요」, 대기열에서 누르면 이유 + 「다른 판 찾기」(PC·폰 `/tmp/smooth-shots/`)
- [x] 3.3 곡 상자 「치워 둔 곡」 칩·목록, 재생목록·대기열 줄 표시, 곡 메뉴 「다른 판 찾기」 창
- [x] 3.4 i18n ko/en/pt

## 4. 마무리
- [x] 4.1 `pnpm typecheck`, `pnpm -C server test`(93), `pnpm build`
- [x] 4.2 막힌 260곡 중 표본 50곡 다른 판 — PR 본문
- [x] 4.3 AGENTS.md API 표, PR(합치지 않음). 헤르메스 기술 `SKILL.md`의 `gone` → `blocked`, `filter=blocked`는 배포 때
