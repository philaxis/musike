# Proposal: 음악 지도 빨리 열기 (map-speed)

## Why

#26 「음악 지도」에 들어갈 때마다 느리다. 지금 지도 페이지 `index.html`은 4천여 곡 자료를 통째로 품어 5.98 MB(gzip 1.67 MB)이고, 열 때마다 검색 자료 `search_meta.json`(2.4 MB, gzip 0.52 MB)과 압축하지 않은 `vectors_e5.bin`(1.69 MB)까지 받는다. 화면을 떠났다 돌아오면 iframe을 새로 만들어 이 큰 페이지를 다시 읽고(304라도 왕복과 6 MB 해석) 3D 지도를 처음부터 다시 그린다. 집 와이파이가 느려서 바이트가 곧 기다림이다.

## What Changes

- 다시 들어오기: 한 번 연 지도 화면은 앱이 도는 동안 살려 둔다(앱 틀에 붙여 두고 다른 화면에선 숨김). 숨은 동안 지도는 그리기를 멈춘다(GPU·배터리). 돌아오면 받을 것도 다시 그릴 것도 없이 그대로다(고른 곡·검색어·시점).
- 처음 들어갈 때 바이트:
  - 분석기가 지도 자료를 페이지 밖 파일로 뺀다: 첫 화면에 필요한 지점 자료 `points.<해시>.json`, 설명 글·이웃 `detail.<해시>.json`(첫 화면을 그린 뒤 받음). 스크립트·검색 자료도 내용 해시를 이름에 단 사본으로 쓰고, 이름표는 `files.json`과 작은 `index.html`에 둔다. 지난번과 이번 것이 아닌 해시 파일은 지운다.
  - 서버는 해시 이름 파일을 `Cache-Control: public, max-age=31536000, immutable`로 내준다(이름이 바뀌면 새 파일). `index.html`은 그대로 `no-cache` + ETag(304).
  - 서버는 글 파일과 `.bin`을 brotli(가장 작게, 뒤에서 한 번 만들어 둠, 그 전엔 gzip)·gzip으로 준다. 보관함이 지도 상태를 물을 때 그날 파일 압축을 미리 시작한다.
  - 검색 자료는 처음 검색할 때만: 글자 검색 항목은 지도 점으로 만들어 따로 받지 않고(`search_meta.json`을 더는 받지 않음), 의미 검색 곡 벡터 `vectors_e5.bin`은 의미 검색을 처음 할 때, 소리 개념 자료는 소리 검색을 처음 할 때 받는다.
  - 글꼴 CSS(Pretendard CDN)가 첫 그림을 막지 않게 한다.
- 「음악 지도」 화면은 첫 화면이 그려질 때까지 가벼운 불러오는 중 표시(반짝이는 바탕 + 「지도를 그리는 중…」)를 보이고, 지도 자료를 못 받으면 다시 하기 버튼을 보인다.

## Capabilities

### Modified Capabilities

- `music-map`: 지도 파일 내주기(해시 이름 오래 캐시, brotli), 지도 페이지 쓰기(해시 이름 파일과 이름표), 다시 들어오기, 첫 화면 먼저·검색 자료는 검색할 때.

## Impact

- 분석기: `mapbuild.py`(`render`가 해시 이름 파일·`files.json`을 쓰고 옛 것을 지움, `vectors_e5.bin`만 쓰고 `search_meta.json`은 안 씀), `soundsearch.py`(`int8_bytes` 나눔), `web/` 템플릿·`search.js`·`soundsearch.js`·`player.js`. 시험 `analysis/tests/test_mapbuild.py`.
- 서버: `mapRoutes.ts`(캐시 머리, brotli, `.bin` 압축, `warmMap`). 시험 `server/test/map.test.ts`.
- 웹: `views/MusicMap.tsx`(살려 두기, 숨김·보임 알림, 불러오는 중·실패), `App.tsx`(화면을 경로 옆에 붙임), i18n ko·en·pt 두 줄.
- 운영: 다음 분석(또는 `python -m musike_analysis map`) 때 새 판이 써진다. 옛 `search_meta.json` 등 원래 이름 파일은 남아도 된다.
