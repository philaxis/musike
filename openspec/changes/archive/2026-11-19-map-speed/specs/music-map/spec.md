## MODIFIED Requirements

### Requirement: 서버가 지도 폴더를 내준다
서버는 분석 폴더(`MUSIKE_ANALYSIS_DIR`)의 `map/` 파일을 `/api/map/` 아래로 내주어야 한다(MUST). 요청 경로가 `map/` 밖을 가리키면(`..`, 인코딩한 `%2e%2e`, 밖을 가리키는 심볼릭 링크) 파일을 주지 않고 404여야 한다(MUST). `map/`이 없으면 404와 「지도가 아직 없다」는 안내여야 하고, `GET /api/taste/map`은 `ready: false`여야 한다(MUST). 글 파일(HTML·JS·JSON·CSS)과 `.bin`은 브라우저가 받으면 brotli(만들어 둔 뒤) 또는 gzip으로 주고, 바뀌지 않은 파일은 304로 답해야 한다(MUST). 이름에 내용 해시가 있는 파일(`points.<12자리 16진수>.json` 꼴)은 `Cache-Control: public, max-age=31536000, immutable`로, 그 밖의 파일(`index.html` 등)은 `no-cache`로 주어야 한다(MUST).

#### Scenario: 경로 탈출
- **WHEN** `/api/map/..%2ftaste.json`을 요청한다
- **THEN** 404이고 분석 폴더의 taste.json 내용은 오지 않는다

#### Scenario: 분석 전
- **WHEN** 분석 폴더에 `map/`이 없다
- **THEN** `/api/map/`은 404와 안내 문구, `/api/taste/map`은 `{ ready: false }`

#### Scenario: 두 번째 열기
- **WHEN** 폰이 지난번 받은 index.html의 ETag로 다시 요청한다
- **THEN** 서버는 304만 보낸다

#### Scenario: 해시 이름 파일
- **WHEN** 보관함이 `/api/taste/map`을 물은 뒤 브라우저가 `Accept-Encoding: gzip, br`로 `points.<해시>.json`을 받는다
- **THEN** brotli로 오고 `immutable`이라 다음부터는 서버에 묻지도 않는다

### Requirement: 지도 페이지만 다시 만든다
분석기는 `python -m musike_analysis map`으로 벡터·UMAP 계산 없이 지금 `map/map_points.json`에서 지도 페이지만 다시 써야 한다(MUST). 지도 페이지는 작은 `index.html`과 내용 해시를 이름에 단 파일들이다(MUST): 첫 화면 자료 `points.<해시>.json`(설명 글·이웃 빼고), 설명 글·이웃 `detail.<해시>.json`, 웹 파일, 있으면 검색 자료(`vectors_e5.bin`·소리 개념 자료)의 사본. 그 이름표는 `files.json`과 `index.html`에 있어야 하고(MUST), 내용이 같으면 이름도 같아야 하며(MUST), 이번과 지난번 이름표에 없는 해시 이름 파일은 지워야 한다(MUST). `map_points.json`이 없으면 아무것도 쓰지 않고 실패로 끝나야 한다(MUST).

#### Scenario: 웹 파일만 고친 뒤
- **WHEN** 지도 템플릿을 고치고 `MUSIKE_ANALYSIS_DIR=/tmp/시험 python -m musike_analysis map`을 돌린다
- **THEN** `/tmp/시험/map/index.html`과 해시 이름 파일이 새 템플릿과 그 폴더의 지점 자료로 다시 써지고 운영 분석 폴더는 그대로다

#### Scenario: 자료가 바뀐 다음 날
- **WHEN** 분석이 새 지점 자료로 지도를 다시 쓴다
- **THEN** `points.<새 해시>.json`이 생기고 그제 것은 지워지며, 어제 것은 이미 열려 있는 지도를 위해 한 번 더 남는다

## ADDED Requirements

### Requirement: 지도 화면에 다시 들어오면 그대로다
「음악 지도」 화면은 한 번 열면 앱이 도는 동안 살아 있어야 한다(MUST): 다른 화면으로 가면 숨기고 지도는 그리기를 멈추며, 돌아오면 아무것도 다시 받거나 처음부터 그리지 않고 고른 곡·검색어·시점이 그대로여야 한다(MUST). 숨은 동안에도 지금 곡·테마·♥는 지도에 전해져야 한다(MUST). `#v=<곡 번호>` 링크로 돌아오면 그 곡을 골라야 한다(MUST).

#### Scenario: 보관함에 갔다가 돌아오기
- **WHEN** 지도에서 「Sparkle」을 검색한 뒤 보관함에 갔다가, 설정에서 테마를 바꾸고, 다시 「음악 지도」를 누른다
- **THEN** 지도가 바로 보이고 `/api/map/` 요청은 하나도 없으며 검색어는 그대로, 테마는 새 테마다

### Requirement: 첫 화면에 필요한 것만 먼저 받는다
지도 페이지는 첫 화면에 필요한 지점 자료와 three.js만으로 그려야 하고(MUST), 설명 글·이웃은 첫 화면을 그린 뒤 받아야 한다(MUST). 검색 자료는 처음 검색할 때만 받아야 한다(MUST): 글자 검색은 지도 점으로 바로 되고, 의미 검색 곡 벡터는 의미 검색을 처음 할 때, 소리 개념 자료는 소리 검색을 처음 할 때 받는다. 「음악 지도」 화면은 첫 화면이 그려질 때까지 불러오는 중 표시를 보이고, 지도 자료를 받지 못하면 다시 하기를 보여야 한다(MUST).

#### Scenario: 처음 들어가기
- **WHEN** 캐시가 빈 브라우저로 처음 「음악 지도」에 들어간다
- **THEN** 「지도를 그리는 중…」이 보이다가 지도가 그려지고, 그때까지 받은 지도 파일은 `index.html`·`points.<해시>.json`·스크립트뿐이며 검색 자료는 검색창을 쓰기 전엔 받지 않는다
