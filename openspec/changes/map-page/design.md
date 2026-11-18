# Design: map-page

## iframe인가 React로 옮기나

지도 페이지는 three.js 3D 장면·조건 버블·명령 팔레트·글자/의미/소리 검색까지 2천 줄이 넘는 한 페이지다. React로 옮기면 같은 기능을 두 벌 갖게 되거나 오래 걸린다. 그래서 분석기가 만든 페이지를 그대로 쓰고 **같은 origin의 iframe**에 띄운다. 재생·메뉴·재생목록은 Musike 쪽 것만 쓰고(두 번째 플레이어 없음), 지도는 고른 곡 번호만 Musike에 보낸다.

## 주소

- `/api/map/<파일>`: 분석 폴더 `map/` 정적 파일. `/api/` 아래라서 PWA 서비스 워커의 navigate fallback(앱 index.html로 바꿔치기)과 웹 앱 404 처리에 걸리지 않고, vite 개발 서버 프록시도 그대로 된다.
- 경로는 `path.resolve` 뒤 `map/` 안인지 보고, 실제 경로(`realpath`)로 한 번 더 본다(심볼릭 링크로 밖으로 나가기 막기). 아니면 404.
- `index.html`(약 6MB, 데이터 인라인)과 JSON 자산은 gzip(파일 크기·mtime이 같으면 메모리에 둔 것 재사용), `ETag`+`Cache-Control: no-cache`로 폰에서 두 번째부터는 304.
- `GET /api/taste/map`: `{ ready, songs, generatedAt }`(map/index.html이 있는지, `map/api/status.json`). 보관함 타일과 화면 안내에 쓴다.

## 지도 ↔ Musike 메시지

모두 `window.postMessage`, origin이 같은 것만 받는다. 지도 → Musike(`{ musikeMap: 1, type, … }`):

| type | 내용 | Musike가 하는 일 |
|---|---|---|
| `ready` | 지도가 다 떴다 | 지금 곡·상태·테마를 보낸다 |
| `radio` | `id` | 그 곡으로 닮은 곡 라디오(`startRadio`, 분석 결과 `/api/taste/radio`) |
| `play` | `ids`, `start` | 그 목록을 `start`번째부터 재생(검색 결과) |
| `menu` | `ids`, `x`, `y`, `title?` | 한 곡이면 곡 메뉴, 여럿이면 묶음 메뉴(고를 때 곡 정보를 받는다). 좌표는 iframe 안 좌표 → 바깥으로 옮긴다 |
| `toggle` · `next` · `prev` | | 플레이어 |

Musike → 지도: `{ musikeMap: 1, type: "player", id, state }`, `{ type: "theme", theme }`.

곡 번호 → Musike 곡 정보는 `/api/track/:id`(이미 있음)로 받고, 화면에 있는 동안 메모해 둔다. 받지 못한 곡(지워진 영상 등)은 목록에서 빠진다.

## 분석기 쪽

- `player.js`를 Musike 다리로 바꾼다. `window.musicPlayer`(지도 템플릿이 부르는 모양: `play`·`toggle`·`next`·`current`·`playing` …)는 그대로 두고 속을 메시지로. 미니 플레이어(`#mini`)·연속 재생 설정은 Musike 쪽에 있으므로 뺀다.
- 지도 페이지를 iframe 밖에서 열면 `/library/map`+해시로 옮긴다(:5066을 끈 뒤 남은 북마크도 Musike로).
- 개인 기록(`user.js`)은 옮기지 않는다: 내 평점 변수·조건, 「내 것」 명령, 메모를 템플릿에서 뺀다. 지도의 ♥(분홍 테두리, ♥ 색·크기, 「♥ 즐겨찾기만」)는 남기고 Musike 즐겨찾기를 받아 쓴다(`favorites` 메시지) — ♥를 두 군데 따로 두지 않는다. 최근 검색은 search.js가 브라우저 localStorage에 둔다(원래 user.js가 없을 때의 동작).
- 곡 정보: `/api/track/:id`는 유튜브 곡을 유튜브에 물어 100곡에 1분이 걸렸다. 그래서 `POST /api/taste/map/tracks {ids}`가 취향 API와 같은 `lookup`(곡 상자 → 내 음악, 지워진 영상 빼기)으로 한 번에 돌려준다(100곡 수십 ms).
- `mapbuild.build`를 계산과 `render(data)`로 나누고, `python -m musike_analysis map`은 `map_points.json`을 읽어 `render`만 한다. 시험 출력은 `MUSIKE_ANALYSIS_DIR`을 다른 폴더로.
