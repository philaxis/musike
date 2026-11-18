# Proposal: 음악지도를 Musike 「지도」 화면으로 (map-page)

## Why

#26 남은 조각. 분석기가 `~/.local/share/musike/analysis/map/`에 3D 지도(index.html·검색 자산)를 만들지만, 지금은 따로 떠 있는 음악지도 서버(`music-map-serve.service`, :5066)로만 볼 수 있다. 그 페이지의 플레이어는 유튜브 임베드 전용이라 내 파일(타츠로·카시오페아, `L` 번호) 점은 썸네일도 재생도 안 되고, 고른 곡을 Musike 대기열·재생목록에 넣을 수도 없다. 보이는 앱은 Musike 하나로 하기로 했다.

## What Changes

- 서버가 분석 폴더의 `map/`을 `/api/map/`으로 내준다(폴더 밖으로 나가는 경로는 막고, gzip·ETag). 지도가 있는지와 곡 수는 `GET /api/taste/map`.
- 웹에 보관함 타일 「음악 지도」 → `/library/map` 화면. 지도 페이지를 같은 주소(origin)의 iframe으로 보여 주고, 지도와 Musike는 메시지로만 주고받는다.
  - 지도에서 ▶ = Musike 플레이어로 그 곡부터 닮은 곡 라디오(대기열 포함). 검색 결과의 ▶ = 결과 목록을 그 곡부터 재생.
  - 「⋯」 = Musike 곡 메뉴(재생·다음에 재생·대기열에 추가·재생목록에 추가 …), 검색 결과 전체도 한 번에.
  - 지금 재생 중인 곡을 지도에 표시하고, 지도 안 Space·N(다음 곡)은 Musike 플레이어를 움직인다. 밝기 테마는 Musike를 따른다.
  - 지도가 아직 없으면 안내.
- 분석기 지도 페이지(`analysis/musike_analysis/web`)를 Musike 안에서 쓰게 고친다: 유튜브 임베드 미니 플레이어를 Musike 다리(`player.js`)로 바꾸고, 내 파일 점 썸네일은 `/api/local/<id>/cover`, 개인 기록(`user.js`·`user.css`: 따로 저장하던 ♥·내 평점·메모·serve API)은 뺀다. 지도의 ♥는 Musike 즐겨찾기를 보여 준다. 지도 페이지를 직접 열면 `/library/map`으로 간다.
- `python -m musike_analysis map`: 계산 없이 지금 `map_points.json`으로 지도 페이지만 다시 쓴다(웹 파일만 바뀌었을 때, 시험 출력 폴더 확인용).

## Capabilities

### New Capabilities

- `music-map`: Musike 안 「음악 지도」 화면과 지도 파일 내주기.

## Impact

- 서버: 새 `server/src/mapRoutes.ts`(지도 파일, `POST /api/taste/map/tracks`), `app.ts`에 등록 한 줄, `tasteRoutes.ts`의 `lookup` 내보내기, i18n 문구, 시험 `server/test/map.test.ts`.
- 웹: 새 `views/MusicMap.tsx`, 보관함 타일, 경로, `lib/server.ts` 한 줄, i18n ko·en·pt.
- 분석기: `mapbuild.py`(계산과 페이지 쓰기 나눔), `__main__.py`(`map` 명령), `web/` 템플릿·`player.js`·`search.js`, `user.js`·`user.css` 삭제. 시험 `analysis/tests/test_mapbuild.py`.
- 운영: 합친 뒤 통합 담당이 `music-map-serve.service`(:5066)를 끈다. 지도 페이지는 다음 분석(또는 `map` 명령) 때 새 판으로 바뀐다.
