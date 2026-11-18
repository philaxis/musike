# Design: 영상 기록

## 파일 (데이터 폴더, 쓰는 곳은 `server/src/ledger.ts` 하나)

`videos.json` — 영상마다 지금 상태:

```json
{ "version": 1, "videos": { "X2KMDkyt-SM": {
  "title": "유튜브가 마지막으로 알려 준 제목", "channel": "CASIOPEA - Topic", "duration": 330,
  "status": "ok|region|gone|private|premium|age", "firstSeen": 1763400000000, "lastChecked": 1763450000000,
  "byPlay": true } } }
```

- `firstSeen`: Musike가 처음 안 때(곡 상자에 들어온 때).
- `lastChecked`: 마지막으로 유튜브에 물은 때. 0이면 아직 물은 적 없음(처음 기록·바꿔 넣으며 적은 새 곡).
- `byPlay`: 상태를 재생 실패(yt-dlp)가 정했음. Data API가 볼 수 없는 이유(프리미엄 전용, 저작권 막힘 일부)라서 API가 「틀 수 있음」이라 해도 그대로 둔다. 그 곡이 실제로 틀어지면(`/api/prepare` 성공) `ok`로 돌리고 지운다.

`video-events.jsonl` — 바뀐 것 한 줄씩, 덧붙이기만:

| kind | 필드 | 뜻 |
|---|---|---|
| `title` | `from`, `to` | 유튜브 제목이 바뀜 |
| `channel` | `from`, `to` | 채널 이름이 바뀜 |
| `status` | `from`, `to` | 상태가 바뀜(`to`가 `gone`이면 지워짐, `ok`면 다시 들을 수 있음) |
| `replaced` | `to`, `by: redirect\|alternative\|manual` | `id`를 `to`로 바꿔 넣음(새 번호 / 대체곡 / 손으로 고른 다른 판) |
| `restored` | `from` | 바꿔 넣기를 되돌려 `id`가 `from` 자리로 돌아옴 |

모든 줄에 `at`(ms)과 `id`.

`video-aliases.json` — `{옛 번호: 지금 번호}`(사슬을 끝까지 따라간 값). 분석 작업자가 읽는다. 바꿔 넣음·되돌림 때마다 다시 쓴다.

쓰기는 한 번에 하나(약속 사슬), `videos.json`·`video-aliases.json`은 임시 파일 뒤 이름 바꾸기, 사건은 `appendFile`.

## 바뀐 것 알아내기 (`observe`, 순수 함수)

확인 한 번 = 곡 상자 유튜브 곡 전부를 `videos.list?part=snippet,status,contentDetails` 50곡씩(호출당 할당량 1, 3천여 곡이면 70 안쪽). 곡마다:

1. 상태 = 기존 판정(`unplayable`): 답에 없음·`uploadStatus` 거절/삭제/실패 → `gone`, `private`, 서버 나라(`MUSIKE_LOCATION`, 운영 KR) 막힘 → `region`, `ytAgeRestricted` → `age`, 아니면 `ok`.
2. 기록에 없던 곡: 바뀜 없이 적는다(`firstSeen` = 곡 상자에 들어온 때).
3. `lastChecked`가 0인 곡(처음 기록·바꿔 넣으며 적음): 유튜브 제목·채널을 조용히 받아 적는다. 상태가 다르면 상태 바뀜만 남긴다.
4. 그 밖: 제목·채널이 다르면 바뀜. 답에 없거나 제목이 `Private video`·`Deleted video`·빈 것이면 제목은 그대로 둔다(유튜브의 자리표시 제목을 「바뀜」으로 치지 않음).
5. 상태가 다르면 상태 바뀜(`byPlay` 곡이 `ok`로 오면 그대로).

곡 상자 `blocked` 표시는 지금처럼 `applyChecks`가 따로 고친다(같은 응답에서). 곡 상자 제목은 고치지 않는다.

## 처음 기록

`videos.json`이 없을 때 서버가 뜨면 곡 상자 그대로 적는다: 제목·채널(아티스트)·길이, 상태는 곡 상자 `blocked` 이유(없으면 `ok`), `firstSeen` = `addedAt`, `lastChecked` = 0. 사건은 없다. 이어지는 첫 확인이 3번 규칙으로 유튜브 제목을 받아 적는다.

## 별칭

`aliasMap(사건)`: 순서대로 `replaced`면 `id → to`를 넣고 `to`의 별칭은 지운다(a→b 뒤 b→a면 a가 지금 곡), `restored`면 `id`의 별칭을 지운다. `resolveAlias`는 사슬을 따라가되 한 번 본 번호에서 멈춘다(고리 방지).

따라가는 곳:

| 곳 | 하는 일 |
|---|---|
| `plays.ts` `loadPlays` | 줄의 `id`를 지금 번호로(파일은 그대로). 열쇠에 별칭 판 번호를 붙여 바뀌면 다시 계산 → 「내 기록」·「이 곡 기록」·요즘 반복·자동 재생목록이 따라감 |
| `stats.ts` 「오늘 좋음」 | `dayLikeIds`는 지금 번호, 그날 목록은 지금 곡으로 보이고 같은 곡으로 넣기·빼기 |
| `taste.ts` `aliasSongs` | 분석의 옛 번호 곡을 새 번호 곡으로(새 번호가 이미 분석돼 있으면 그대로). 장르·묶음·라디오·자동 재생목록·앨범/작곡가가 따라감 |
| `tasteRoutes.ts` 라디오 | 옛 번호로 와도 지금 곡의 라디오 |
| `mapRoutes.ts` 지도 점 | 지도(정적 페이지, 다음 분석 때 다시 그림)의 옛 번호 점이 지금 곡을 튼다 |
| 분석 `aliases.carry_over` | 매 실행 처음에, 후보에 있는 지금 번호에 카드·글 벡터·소리 벡터(parquet 줄)·묶음 배정이 없고 옛 번호에 있으면 복사. 옛 번호에도 없으면 평소처럼 새로 분석 |

## 바꿔 넣기와 되돌리기

바꿔 넣기 한 곳(자동 바꿔 넣기 #ytm-redirect의 `standIn.replaceEverywhere(oldId, track, by)`, 그 전에는 `POST /api/box/:id/replace`)이 끝나면 `recordReplaced(old, track, by)`, 되돌리기(`standIn.restore`)는 `recordRestored(old, from)`. 새 곡은 곡 상자 제목으로 적어 두고(`lastChecked` 0) 다음 확인이 유튜브 제목을 받아 적는다.

## API

| 메서드 | 경로 | 돌려줌 |
|---|---|---|
| GET | `/api/videos/events?cursor=&limit=` | `{events, total, next, summary: {videos, status: {ok, region, …}, checkedAt}}`. 사건은 최신순 100개씩, 각각 `track`(그 영상을 지금 대신하는 곡, 곡 상자 제목), `video`(사건의 영상, 유튜브 제목), 바꿔 넣음·되돌림은 `other` |
| GET | `/api/videos/:id` | `{video: 기록\|null, current: 지금 번호, events}`. 사건은 그 곡과 그 곡이 대신하는 옛 번호들 것 전부 |
| POST | `/api/videos/check` | 확인만 지금: `{checked, blocked, changes}` (계정 필요) |

## 웹

- 곡 상자 칩 「변경 기록」(`/library/box?filter=changes`): 위에 「N곡 지켜보는 중 · 마지막 확인 날짜」, 못 트는 상태별 수, 설명. 아래 사건 줄(표지·곡 상자 제목·바뀐 것 쉬운 말·아티스트·날짜), 100개씩 「더 보기」. 줄을 누르면 그 곡의 「이 곡 기록」.
- 쉬운 말: 「제목이 바뀜: A → B」, 「채널 이름이 바뀜: A → B」, 「지워짐」, 「비공개로 바뀜」, 「한국에서 막힘」, 「프리미엄 전용」, 「나이 제한」, 「다시 들을 수 있음」, 「새 번호로 바꿈: A → B」, 「대체곡으로 바꿈: A → B」, 「다른 판으로 바꿈: A → B」, 「원래 곡으로 되돌림: B → A」. 못 트게 된 것은 빨강, 다시 됨·바꿈은 강조색.
- 「이 곡 기록」(유튜브 곡): 들은 기록 아래 「유튜브에서 바뀐 것」 — 유튜브 제목이 곡 상자 제목과 다르면 「유튜브 제목: …」, 사건 목록(없으면 「유튜브에서 바뀐 것 없음」). 기록에 없는 곡은 칸을 숨긴다.
