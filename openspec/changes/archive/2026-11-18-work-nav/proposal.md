# Proposal: 곡에서 앨범·작곡가로, 작품의 이 연주 전체 넣기

## Why

사용자 11-18(#26): "곡에서 앨범으로 간다던지, 곡에서 작곡가로 간다던지, 이 악장이 포함된 곡 인스턴스(판본 다른 거 고려해서) 전체/앨범 전체를 큐/재생목록에". 분석기가 이제 곡마다 작곡가·작품·앨범·악장·연주(instance)를 적어 주므로, 한 곡에서 그 곡이 속한 묶음으로 바로 가거나 묶음을 통째로 넣을 수 있어야 한다. 판본(연주)이 다른 곡은 섞지 않는다.

## What Changes

- 서버가 분석 결과의 `composer`·`work`·`album`·`movement`·`instance`로 내 곡(곡 상자·내 파일)을 묶는다: 한 연주의 곡(악장 순), 한 앨범의 내 곡, 한 작곡가의 작품 → 연주 → 곡, 작곡가 목록(곡 수 순).
- 곡 메뉴(모든 곡 목록·지금 재생·대기열이 같은 메뉴)에 분석에 정보가 있을 때만 「앨범으로 가기」·「작곡가로 가기」·「이 작품 전체 (이 연주)」·「앨범 전체」. 뒤의 둘은 누르면 기존 앨범·재생목록 통째 메뉴(전체 재생·섞어 재생·다음에 재생·대기열에 추가·재생목록에 추가)로 바뀐다. 연주가 1곡뿐이면 「이 작품 전체」, 앨범이 1곡뿐이면 「앨범 전체」를 숨긴다.
- 「앨범으로 가기」: 내 파일은 기존 내 음악 앨범 화면, 유튜브 곡은 내 곡으로 만든 앨범 화면(「유튜브에서 찾기」 단추로 기존 유튜브 앨범 검색).
- 「작곡가로 가기」: 작곡가 화면 = 작품별 묶음, 작품 안에 연주(연주자·앨범·곡 수) 줄, 연주를 누르면 악장 목록. 연주마다 ⋯/길게 누르기로 통째 메뉴.
- 장르 화면에서 작품 정보가 있는 장르(지금은 클래식)에 「작곡가별」 단추 → 그 장르 작곡가 목록.

## Capabilities

### New Capabilities

- `work-navigation`: 곡에서 앨범·작곡가·연주로 가기, 연주·앨범 통째 넣기, 작곡가 목록과 화면.

## Impact

- 서버: `server/src/works.ts`(새, 묶기·정렬), `server/src/workRoutes.ts`(새, API), `server/src/tasteRoutes.ts`(곡 찾기 `catalog`를 내보냄), `server/src/local.ts`(곡의 앨범 `albumOf`), `server/src/app.ts`.
- 웹: `web/src/components/TrackMenu.tsx`·`menus.ts`, `web/src/views/Composer.tsx`·`Composers.tsx`(새), `web/src/views/TasteTracks.tsx`(연주·앨범 목록), `web/src/views/TasteGenre.tsx`, `web/src/lib/server.ts`·`routes.ts`, `web/src/App.tsx`, i18n 세 곳.
- 데이터: 읽기만(`analysis/taste.json`, `box.json`, 내 음악 색인). 새로 쓰는 파일 없음. 분석기는 고치지 않는다.
- API: `GET /api/works/track/:id`, `/api/works/album?key=`, `/api/works/instance?key=`, `/api/works/composers?genre=`, `/api/works/composer?name=` (앨범·연주 열쇠가 길어 경로 대신 query).
