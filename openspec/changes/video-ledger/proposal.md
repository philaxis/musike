# Proposal: 영상 기록(바뀐 것을 잃지 않기)

## Why

사용자 11-18(#26): 곡 상자 유튜브 곡은 Musike가 모르는 사이에 바뀐다. 올린 사람이 제목을 바꾸고, 영상을 지우거나 비공개로 돌리고, 한국에서 막히고, 프리미엄 전용이 된다. 지금 서버는 그때그때 「못 틂」 표시만 덮어쓰므로 언제 무엇이 어떻게 바뀌었는지 남지 않는다. 다른 판으로 바꿔 넣으면 곡 번호가 달라져 그 곡의 들은 기록·「오늘 좋음」·취향 분석·음악 지도 점이 옛 번호에 남아 끊긴다. 사용자는 Musike가 아는 모든 유튜브 영상의 이력을 스스로 갖고, 아무것도 조용히 사라지거나 바뀌지 않기를 원한다.

## What Changes

- 서버에 영상 기록(`ledger.ts`, 쓰는 곳은 이것 하나): 데이터 폴더의 `videos.json`(영상마다 유튜브 제목·채널·길이·상태·처음 안 때·마지막 확인)과 덧붙이기만 하는 `video-events.jsonl`(바뀐 것 한 줄씩: 제목, 채널, 상태, 바꿔 넣음, 되돌림), 그리고 바꿔 넣은 곡의 옛 번호 → 지금 번호 `video-aliases.json`.
- 이미 있는 곡 상자 확인(계정 동기화 뒤·처음 뜰 때)이 YouTube Data API `videos.list`를 `snippet,status,contentDetails`로 50곡씩 읽어(같은 할당량) 제목·채널 바뀜, 지워짐(답에 없음), 비공개, 막힘(서버 나라)을 기록에 남긴다. 재생 때 yt-dlp가 알려 준 이유(프리미엄 전용·나이 제한 등)는 API가 「틀 수 있음」이라고 해도 남겨 두고, 그 곡이 실제로 틀어지면 지운다. `POST /api/videos/check`로 확인만 따로 돌릴 수 있다.
- 바꿔 넣기(손으로 고른 다른 판, 그리고 자동 바꿔 넣기 #ytm-redirect의 새 번호·대체곡)와 되돌리기를 기록하고, 거기서 별칭(옛 번호 → 지금 번호, a→b→c 사슬 따라감)을 만든다. 별칭으로: 들은 기록·「오늘 좋음」·「이 곡 기록」은 옛 번호 것도 새 곡 것으로 세고, 취향 분석(장르·묶음·라디오·자동 재생목록)과 음악 지도 점은 새 곡을 가리키며, 분석 작업자는 옛 번호의 카드·벡터·묶음을 새 번호로 옮겨 다시 분석하지 않는다.
- 처음 한 번은 곡 상자 그대로 기록을 만든다(바뀜 없이, 상태는 이미 있는 「못 틂」 표시). 첫 확인은 유튜브 제목을 조용히 받아 적는다.
- 웹: 곡 상자 「변경 기록」 칩(바뀐 것 최신순, 쉬운 말), 「이 곡 기록」 안에 그 곡의 바뀐 것. 앱이 보여 주는 제목은 곡 상자 제목 그대로다(기록은 유튜브 제목을 적기만 하고 고치지 않는다).

## Capabilities

### New Capabilities

- `video-ledger`: 유튜브 영상 기록, 바뀐 것 알아내기, 바꿔 넣은 곡 따라가기, 「변경 기록」 화면.

## Impact

- 서버: `server/src/ledger.ts`·`ledgerRoutes.ts`(새), `google.ts`(확인이 snippet까지 읽고 기록에 넘김, `checkBox` 내보냄), `box.ts`(`youtubeIds` → `youtubeEntries`), `boxRoutes.ts`·자동 바꿔 넣기(바꿔 넣음 기록), `app.ts`(재생 실패·성공 기록, 처음 기록), `plays.ts`(`loadPlays`가 별칭 따라감), `stats.ts`(「오늘 좋음」), `taste.ts`(`aliasSongs`), `tasteRoutes.ts`(라디오), `mapRoutes.ts`(지도 점).
- 분석: `analysis/musike_analysis/aliases.py`(새), `config.py`(`MUSIKE_DATA_DIR`), `update.py`.
- 웹: `web/src/components/VideoChanges.tsx`(새), `views/SongBox.tsx`, `components/TrackRecord.tsx`, `lib/server.ts`, i18n 세 곳.
- 데이터: 새 파일 `data/videos.json`, `data/video-events.jsonl`, `data/video-aliases.json`. 다른 파일은 그대로(들은 기록·곡 상자 제목을 고쳐 쓰지 않음).
- API: `GET /api/videos/events`, `GET /api/videos/:id`, `POST /api/videos/check`.
