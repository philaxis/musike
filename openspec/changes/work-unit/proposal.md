# Proposal: 여러 악장 작품은 한 덩어리로

## Why

사용자 11-19(#26): 만든 목록·라디오에서 드보르자크 교향곡 7번(클리블랜드 관현악단·도흐나니)을 틀었더니 한 악장만 나오고 다음 곡이 엘가 「위풍당당 행진곡」이었다. 사용자의 규칙: 교향곡처럼 여러 악장으로 된 클래식 작품은 기본이 **한 덩어리**(이 연주의 작품 전체)이지 악장 하나가 아니다. 지금은 라디오·자동 재생목록·소리 묶음·지도가 악장을 곡 하나로 다뤄, 악장 하나만 뽑히거나 같은 연주의 두 악장이 따로 뽑힌다.

## What Changes

- 분석 결과에서 악장(`movement`)이 둘 이상 들을 수 있는 연주(`instance`)를 **작품 덩어리**로 친다(지금 자료로 150개, 모두 클래식). 악장이 하나만 알려진 연주, 악장 정보 없는 곡, 클래식 아닌 곡, 교향곡 전체가 한 영상인 유튜브 곡은 지금처럼 곡 하나다.
- Musike가 곡을 골라 보여 주는 곳(닮은 곡 라디오·「이 곡으로 라디오」, 자동 재생목록(「오늘 좋음」 바탕 포함), 장르 → 소리 묶음 목록, 지도의 점 ▶·지도 결과 목록·지도 메뉴)에서 악장 하나는 그 연주 전체를 뜻한다: 목록에 한 줄(「Dvořák: Symphony No. 7 in D minor, Op. 70」 · 연주자, 「4악장」 표, 전체 길이)로 나오고, 틀면 모든 악장이 순서대로 나온다. 줄의 펼치기로 악장 목록을 보고 한 악장부터 틀 수 있다.
- 닮음·고르기는 연주 단위: 라디오·자동 재생목록에서 한 연주는 한 번만 뽑히고, 아티스트 2곡 제한에 한 번으로 센다. 들은 횟수도 연주 단위(네 악장을 한 번 들은 것은 한 번).
- 라디오가 악장에서 시작하면 그 연주의 1악장부터 튼다. 다만 그 악장이 지금 재생 중이면 그 악장부터 잇는다.
- 사용자가 앨범·작곡가·연주 화면에서 악장을 직접 누르면 지금처럼 그 악장부터 틀고 뒤 악장이 이어진다. 이제 그 연주의 악장들은 대기열에서 한 줄(묶음처럼)로 보이고, 섞어 재생해도 악장 순서는 바뀌지 않는다.
- 작품 덩어리 줄을 재생목록·즐겨찾기에 넣으면 악장들이 들어간다(덩어리 줄은 저장하지 않는다).

## Capabilities

### New Capabilities

- `work-units`: 여러 악장 연주를 한 덩어리로 고르고·보여 주고·틀기.

## Impact

- 서버: `server/src/works.ts`(덩어리 `units`, 줄 `unitRow`·`unitRows`, 작품 화면 곡의 `work` 표시), `server/src/taste.ts`(라디오), `server/src/mixes.ts`(자동 재생목록), `server/src/tasteRoutes.ts`(장르·묶음·라디오·자동 재생목록, `loadWorks`), `server/src/mapRoutes.ts`(지도 곡), `server/src/workRoutes.ts`, `server/src/library.ts`·`app.ts`(덩어리 줄은 악장으로 저장), `server/src/types.ts`(`Track.work`).
- 웹: `web/src/lib/bundles.ts`·`types.ts`, `web/src/player/player.ts`(덩어리 줄·악장 이어 붙이기·라디오), `web/src/components/TrackList.tsx`·`Queue.tsx`·`menus.ts`·`TrackMenu.tsx`, `web/src/views/TasteTracks.tsx`·`MusicMap.tsx`, `web/src/stores/library.ts`, i18n 세 곳.
- API: 라디오·자동 재생목록·장르·소리 묶음·지도 곡 응답에 덩어리 줄(`kind: "bundle"`, id `W`+1악장 번호, `work: {key, title, parts, labels}`)이 들어간다. 장르·묶음의 곡 수는 줄 수(덩어리는 하나). 작품 화면(`/api/works/*`) 곡에 `work: {key, title}`. 재생목록·즐겨찾기에 덩어리 줄을 보내면 악장들이 들어간다.
- 데이터: 새로 쓰는 파일 없음. 분석기는 고치지 않는다.
