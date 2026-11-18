# Design: 다음 곡으로 끊김 없이 + 못 틀 곡 조용히 건너뛰기

## 1. 미리 갖고 있기 (웹 `player.ts`)

넘김이 늦는 까닭(유튜브 곡): 서버가 yt-dlp로 주소를 받는 데 몇 초, 막 받은 googlevideo 주소가 403을 주는 데우기 1~2초, 브라우저가 첫 소리를 받아 해독하는 시간. 지금은 `onStarted`에서 다음 곡 `prepare`만 해서 앞의 것만 줄어든다.

- **창**: 지금 곡이 재생되기 시작하고(`playing`) 4초 뒤 `runAhead()`가 돈다(지금 곡 시작을 늦추지 않게).
  - 주소: 다음 2곡(전체 반복이면 처음으로 돌아감, 못 트는 곡은 건너뛴 순서)과 이전 1곡에 `prepare`. 서버 `resolveStreams` 캐시가 주소를 만료 10분 전까지 들고 있으므로 이것이 「주소 유지」다. 웹은 같은 곡에 5분 안에 다시 묻지 않는다.
  - 소리: 바로 다음 1곡만, 쓰지 않는 덱(`decks` 중 지금 `audio`가 아닌 것)에 `src`를 넣고 재생하지 않고 둔다(`preload="auto"`). 파이어폭스는 재생 위치에서 60초(`media.cache_readahead_limit`)까지만 받아 두고 멈추며, 크롬은 몇 MB까지 받는다. 그래서 받는 양은 다음 곡의 앞 수십 초다.
  - 오프셋 오디오(동영상 파일·나눈 앨범 곡)는 `prepare`로 오프셋인지 먼저 알고, 처음부터(`t=0`) 미리 받는다.
  - 덱이 하나뿐(iOS 앱·iOS 브라우저·안드로이드 앱)이거나 영상 모드면 주소 확보만.
  - 크로스페이드 중(`outgoing` 있음)에는 예비 덱이 아직 울리므로 미루고, 겹치기가 끝나면(`stopOutgoing`) 다시 돈다.
- **다시 잡기**: 대기열·지금 자리·섞기·반복·영상 모드가 바뀌면 0.8초 뒤 `runAhead()`를 다시 돌린다. 미리 받은 곡이 새 다음 곡과 다르면 덮어쓴다.
- **쓰기**: `load()`에서 소리 모드이고 미리 받은 곡이 지금 틀 곡과 같으면(오프셋 곡은 처음부터 틀 때만) `src`를 다시 넣지 않는다.
  - 손으로 넘김·곡 끝(페이드 0): 지금 덱을 멈추고 비운 뒤 `audio`를 미리 받은 덱으로 바꾸고 `play()`. 이미 지나간 `loadedmetadata` 대신 길이·버퍼를 그 자리에서 읽는다. 믹서가 연결돼 있으면 새 덱 이득을 1로.
  - 크로스페이드: `startCrossfade`가 원래 예비 덱으로 넘어가므로 그 덱에 이미 다음 곡이 들어 있다. 이득 곡선은 그대로.
- 예비 덱에서 오류가 나면 미리 받은 것을 버린다(차례가 오면 평소처럼 받고 평소처럼 오류를 본다).

## 2. 못 틀 곡

- **이유**: `Unplayable = "region" | "gone" | "private" | "age"`.
  - 서버 yt-dlp 오류(`ytdlp.ts toHttpError`)를 이유로 나눈다: `blocked … in your country`·`claimed content`·`not made this video available in your country` → region, `Private video` → private, 연령 → age, 그 밖의 `Video unavailable`·`removed` → gone. `HttpError`에 `reason`을 달고 오류 응답이 `{ error, code: "unplayable", reason }`.
  - 곡 상자 판정(아래 3)은 `Track.blocked`(응답에만)로 실려 온다. `/api/library`·`/api/box`가 붙인다.
- **웹**: 플레이어 상태 `unplayable: Record<id, Unplayable>`(이 세션에서 알게 된 것). `prepare` 실패·스트림 실패가 `unplayable`이면 여기에 적고 미리 받기 창을 다시 잡는다(새 다음 곡).
  - `load()`에서 못 트는 곡(`track.blocked`, `unplayable[id]`, 받아 둔 파일이 있으면 예외)은 넘어가는 방향으로 건너뛰고, 1.2초 동안 건너뛴 것을 모아 조용한 알림 한 줄. 기존 `unavailable`(로컬 파일 없음) 건너뛰기와 같은 고리.
  - 직접 고름(`jumpTo`, 목록 줄 누름 = `playList(tracks, i)`의 `i`, `playTrack`)이면 재생하지 않고 이유 + 「다른 판 찾기」 알림.
  - 재생 중 스트림이 `unplayable`로 실패하면 오류 창·2.5초 대기 없이 바로 다음으로.
- 대기열 줄(지나간 곡 줄 포함)과 목록 줄(재생목록·즐겨찾기)은 흐리게, 작은 글 「못 틀음 · 이유」/이유.

## 3. 곡 상자에서 치워 두기 (서버)

- `box.json` 항목 `gone?: true` → `blocked?: { reason, at }`(읽을 때 옛 `gone`은 `{reason:"gone", at:0}`으로 바뀜). 상자 전체에 `checkedAt`.
- `google.ts unplayable(video, region)`: 순수 함수(시험). 판정 표는 스펙. 국가는 `config.location`(`MUSIKE_LOCATION`, 운영 KR).
- `checkBox()`: 상자의 유튜브 곡 번호 전부를 50개씩 `videos.list part=status,contentDetails`(요청당 할당 1, 3,418곡이면 69). 결과를 `box.applyChecks`로 저장(새로 못 트게 된 수를 돌려줌, 다시 틀 수 있게 된 곡은 표시 지움).
- `sync()`가 재생목록을 다 읽은 뒤 `checkBox()`. 옛 `itemGone` → `markGone` 길은 없앤다: 재생목록 자리표시(삭제·비공개)는 계속 `itemGone`으로 거르되(곡이 아니므로), 상자 곡의 사라짐 판정은 `checkBox` 하나로 한다. sync 결과 `gone` → `blocked`.
- 처음 한 번: 서버가 뜰 때 `checkedAt`이 없고 계정이 연결돼 있으면 뒤에서 `checkBox()`.
- 재생 때 yt-dlp가 못 튼다고 하면(`/api/prepare`) 그 곡이 상자에 있으면 바로 `blocked`로 적는다.
- 같은 곡이 살아 있는 재생목록으로 다시 들어오면 gone/private 표시는 지운다(region/age는 남김, 다음 확인이 정함).
- **치워 두기**(사용자 11-18): 응답의 곡에 `blocked: 이유`를 다는 곳은 `box.present` 하나(받아 둔 파일이 있으면 달지 않음). 이 표시가 있는 상자 항목은
  - `filterItems`가 기본으로 빼고 `filter=blocked`일 때만 준다 → 곡 상자 기본·정리 안 됨·출처별·꼬리표별, 「내 곡」 검색(`/api/box?q=`).
  - `boxSources`의 출처별 개수·`total`에서 빠지고 `aside`(이유별 개수)로만 센다. 꼬리표 개수·같은 작품 다른 버전(`tagged`)에서도 빠진다.
  - `tasteRoutes.lookup`이 빼서 장르·소리 묶음, 자동 재생목록, 닮은 곡 라디오에 나오지 않는다.
  - `stats` 순위(많이 들은 곡·자주 반복·잊은 곡)에서 빠진다. 하루 기록은 들은 그대로 둔다.
  - 재생목록·즐겨찾기·묶음(`/api/library`)은 그대로 두고 표시만 단다(웹이 흐리게, 재생 때 건너뜀).
- 「숨기기」(`hidden.ts`)를 쓰지 않는 까닭: 숨기기는 사람이 고른 내 음악 파일 목록(`hidden.json`, LOCAL_ID만)이고 손으로만 풀린다. 치워 두기는 확인 결과라 이유·시각이 있고 매일 다시 판정해 저절로 풀린다. 둘을 한 저장소에 두면 매일 확인이 사람이 숨긴 것을 풀어 버린다. 보이는 규칙은 같게 했다: 목록에서 빼고, 따로 모아 볼 때만 표시를 달아 보인다.
- 웹 곡 상자: 「치워 둔 곡 N」 칩(N > 0일 때) → `filter=blocked` 목록, 위에 「한국에서 막힘 260 · 나이 제한 1」과 설명, 줄마다 「다른 판 찾기」.

## 4. 다른 판 찾기

- `GET /api/box/:id/alternatives`: 원래 곡(상자·내 폴더·보관함에서 찾음)의 `제목 아티스트`로 `search()`를 노래·영상 두 번, 합쳐서 원래 곡·상자에서 막힌 곡을 빼고, 계정이 연결돼 있으면 후보를 `videos.list`로 한 번 더 보고 못 트는 것을 뺀다. 길이 차이 순(같으면 검색 순)으로 5개.
- `POST /api/box/:id/replace {track}`: 상자 항목의 곡을 바꾸고 출처마다 `was: 원래 번호`(이미 있으면 그대로), 막힘 표시 지움. 새 곡이 이미 상자에 있으면 그 항목에 출처·꼬리표를 합치고 원래 항목은 뺀다. `library.replaceTrack`이 재생목록·즐겨찾기·묶음 부분에서 같은 자리를 바꾼다(최근 재생은 기록이라 그대로).
- `mergeTracks`는 출처의 `was`로도 항목을 찾아, 동기화가 원래 번호를 다시 들여와도 새 항목을 만들지 않는다.
- 웹: 곡 메뉴(못 트는 유튜브 곡)와 건너뛰기 알림의 「다른 판 찾기」 → 창(후보 5개: 그림·제목·아티스트·길이와 차이). 고르면 바꾸고, 보관함을 다시 읽고, 대기열의 원래 곡도 새 곡으로 바꾼다. 곡 상자 화면은 바뀐 곡을 바로 보인다.
- 자동 일괄 교체는 하지 않는다.
