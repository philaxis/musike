## 1. 서버
- [x] 1.1 `ytMusic.ts`: 유튜브 뮤직이 옮긴 번호(`resolve_url`, 안 되면 보는 쪽 페이지 `INITIAL_ENDPOINT`), 10초 제한, 하루 기억
- [x] 1.2 `toHttpError`: 프리미엄 전용 → `premium`, 계정 확인이 그 표시를 지우지 않음
- [x] 1.3 `box.ts`: `replaced`·`standInAt`·`keepAside`, 같은 곡 판정(`redirectFits`), 후보 순서(`standInOrder`), 되돌리기(`restoreEntry`), `filter=replaced`, `sources.replaced`
- [x] 1.4 `standIn.ts`: 대신 틀 판 고르기(옮긴 번호 → 후보), 바꿔 넣기 한 곳(`replaceEverywhere`), 되돌리기, 재생 때(`standInFor`), 확인 뒤·시작 때(`fixAside`)
- [x] 1.5 `/api/prepare`: 대신 넣은 판을 준비하고 `replaced`로 알림, 하루 안에 찾아본 치워 둔 곡은 곧바로 답함
- [x] 1.6 `/api/box/:id/restore`, `/api/box/:id/alternatives` 맨 앞에 옮긴 판

## 2. 웹
- [x] 2.1 플레이어: 서버가 치워 둔 곡도 한 번 묻고, 대신 넣은 판으로 대기열을 바꿔 틀기(「새 판으로 바꿔 틀었어요」)
- [x] 2.2 곡 상자 「바꿔 넣은 곡」 칩: 원래 곡 → 새 곡, 「되돌리기」, 「다른 판 고르기」
- [x] 2.3 「유튜브 프리미엄 전용」, 「유튜브 뮤직이 옮긴 판」 (ko/en/pt)

## 3. 확인
- [x] 3.1 단위 시험: 페이지·링크 풀이 읽기, 같은 곡 판정(맞음/틀림), 후보 순서, 되돌리기, 프리미엄 분류
- [x] 3.2 운영 데이터 사본으로 시험 서버(4260): 바뀐 수·남은 수, 바뀐 곡 5곡 스트림 206, 재생목록 옛 번호 → 새 번호
- [x] 3.3 Firefox: 옛 번호가 낀 대기열에서 「다음」 → 대신 넣은 판 재생, 「치워 둔 곡」·「바꿔 넣은 곡」 화면 찍기
- [x] 3.4 `AGENTS.md` API 표
