## Why
곡 상자에 치워 둔 곡이 261곡(한국에서 막힘 260, 나이 제한 1)이다. 대부분은 유튜브 뮤직이 자동으로 만든 「Topic」 곡인데, 유통사가 바뀌면서 옛 영상 번호가 세계 어디서도 안 나오게 됐을 뿐 곡 자체는 새 번호로 그대로 있다. 유튜브 뮤직은 옛 번호를 새 번호로 넘겨 주고, 그 답은 자바스크립트 없이 읽힌다(링크 풀이 `navigation/resolve_url`, 보는 쪽 페이지의 `INITIAL_ENDPOINT`; yt-dlp issue #14066). 미리 재 보니 261곡 중 224곡이 다른 번호로 넘어가고 그중 220곡이 한국에서 나온다.
또 "This video is only available to Music Premium members"(프리미엄 전용)는 지금 「yt-dlp를 업데이트하세요」 오류로 잘못 보인다.
사용자 결정: 대신 틀 수 있는 것이 있으면 못 트는 곡으로 남겨 두지 않는다.

## What Changes
- 못 트는 유튜브 곡(막힘·사라짐·비공개·나이 제한·프리미엄 전용)마다 대신 틀 판을 이 순서로 찾아 **저절로 바꿔 넣는다**:
  1. 유튜브 뮤직이 옮긴 번호(같은 곡일 때만: 제목이 비슷하거나, 아티스트가 같고 길이가 ±5초 안)
  2. 「다른 판 찾기」 후보 중 가장 나은 것(같은 제목+길이 ±3초 → 같은 제목+같은 아티스트 → 같은 곡 이름(괄호 메모·아티스트 이름을 뺀 제목이 양쪽으로 0.8 이상)이고 길이 15% 안 또는 같은 아티스트). 실제로 yt-dlp로 틀 수 있는 것만. 다른 곡이 들어가느니 치워 두는 편이 낫다.
  3. 둘 다 없을 때만 「치워 둔 곡」에 남는다.
- 바꿔 넣기는 지금 「다른 판 찾기」로 고르는 것과 같은 방법(곡 상자·재생목록·즐겨찾기·묶음의 같은 자리, 출처에 `was`)이고, 곡 상자 항목에 어떻게 바꿨는지(`replaced.by`: `redirect`·`alternative`·`manual`)와 원래 곡(`replaced.was`)을 남긴다.
- 언제: 재생하려다 못 튼다고 나올 때(`/api/prepare`), 곡 상자 확인 뒤(구글 동기화), 서버가 뜰 때. 치워 둔 곡은 하루에 한 번만 다시 찾는다(`standInAt`). 배포 뒤 첫 시작에 지금의 261곡이 모두 한 번 찾아진다.
- 재생: 대기열의 못 트는 곡 차례가 오면 건너뛰지 않고 서버가 바꿔 넣은 곡을 튼다(「새 판으로 바꿔 틀었어요」). 서버가 치워 둔 곡도 이 세션에서 한 번은 서버에 물어본다.
- 곡 상자에 「바꿔 넣은 곡」 칩: 원래 곡 → 새 곡, 어떻게 바꿨는지, 「되돌리기」(원래 곡으로 돌리고 다시 치워 둠, 저절로 다시 바꾸지 않음), 「다른 판 고르기」. 검색으로 바꾼 곡이 먼저.
- 「다른 판 찾기」 후보 맨 앞에 유튜브 뮤직이 옮긴 판(같은 곡 조건을 못 넘은 것도)을 보인다.
- yt-dlp의 프리미엄 전용 답을 못 트는 이유 `premium`(「유튜브 프리미엄 전용」)으로 나눈다. 구글 계정 확인은 이것을 모르므로 그 표시를 지우지 않는다.
- API: `POST /api/box/:id/restore`, `GET /api/box?filter=replaced`, `/api/box/sources`의 `replaced` 수, `/api/prepare`의 `replaced`, 후보의 `redirect`.

## Impact
- 서버: `server/src/ytMusic.ts`(새), `server/src/standIn.ts`(새), `box.ts`, `boxRoutes.ts`, `app.ts`(`/api/prepare`, 시작), `google.ts`(`checkBox` 뒤), `ytdlp.ts`(`toHttpError`), `types.ts`, `i18n.ts`; 영상 기록(`ledger.ts`)에 바꿔 넣음·되돌림을 남겨 별칭으로 들은 기록·취향·라디오·지도가 새 곡을 따라감(video-ledger 2.3)
- 웹: `player/player.ts`, `views/SongBox.tsx`, `components/Alternatives.tsx`, `lib/{server,apiTypes,types}.ts`, `i18n/{ko,en,pt}.ts`
- 데이터: `box.json` 항목에 `replaced`·`standInAt`·`keepAside`가 더해진다(옛 파일은 그대로 읽힘)
- 문서: `AGENTS.md` API 표
