# music-map Specification

## Purpose
TBD - created by archiving change map-page. Update Purpose after archive.

## Requirements

### Requirement: 서버가 지도 폴더를 내준다
서버는 분석 폴더(`MUSIKE_ANALYSIS_DIR`)의 `map/` 파일을 `/api/map/` 아래로 내주어야 한다(MUST). 요청 경로가 `map/` 밖을 가리키면(`..`, 인코딩한 `%2e%2e`, 밖을 가리키는 심볼릭 링크) 파일을 주지 않고 404여야 한다(MUST). `map/`이 없으면 404와 「지도가 아직 없다」는 안내여야 하고, `GET /api/taste/map`은 `ready: false`여야 한다(MUST). 글 파일(HTML·JS·JSON·CSS)은 브라우저가 받으면 gzip으로 주고, 바뀌지 않은 파일은 304로 답해야 한다(MUST).

#### Scenario: 경로 탈출
- **WHEN** `/api/map/..%2ftaste.json`을 요청한다
- **THEN** 404이고 분석 폴더의 taste.json 내용은 오지 않는다

#### Scenario: 분석 전
- **WHEN** 분석 폴더에 `map/`이 없다
- **THEN** `/api/map/`은 404와 안내 문구, `/api/taste/map`은 `{ ready: false }`

#### Scenario: 두 번째 열기
- **WHEN** 폰이 지난번 받은 index.html의 ETag로 다시 요청한다
- **THEN** 서버는 304만 보낸다

### Requirement: 보관함에 「음악 지도」 화면이 있다
지도가 있으면 보관함에 「음악 지도」 칸이 보여야 하고(MUST, TV 모드 제외), 누르면 `/library/map`에서 3D 지도와 검색(글자·의미·소리)을 Musike 화면 안에서 써야 한다(MUST). 지도가 없으면 그 화면은 분석기가 매일 만든다는 안내를 보여야 한다(MUST). 폰에서도 한 손가락 회전·두 손가락 확대가 되고 검색 결과는 목록으로 보여야 한다(MUST).

#### Scenario: 보관함에서 열기
- **WHEN** 지도가 있는 서버에서 보관함의 「음악 지도」를 누른다
- **THEN** 4천여 곡의 점이 있는 3D 지도와 검색창이 Musike 화면 안에 열린다

#### Scenario: 지도 페이지를 직접 열기
- **WHEN** `/api/map/`을 브라우저 주소창으로 연다
- **THEN** `/library/map`으로 옮겨 Musike 화면 안에서 열린다

### Requirement: 지도에서 고른 곡은 Musike 플레이어로 듣는다
지도에서 곡을 재생하면 유튜브 임베드가 아니라 Musike 플레이어로 재생해야 한다(MUST): 점·정보 패널의 ▶는 그 곡부터 닮은 곡 라디오를 대기열로, 검색 결과의 ▶는 결과 목록을 그 곡부터 재생한다. 「⋯」는 Musike 곡 메뉴(다음에 재생·대기열에 추가·재생목록에 추가 등)를 열어야 하고, 검색 결과 전체(상위 100곡)에도 같은 메뉴가 있어야 한다(MUST). 곡 정보는 곡 상자·내 음악에서 오고, 지워진 영상처럼 지금 들을 수 없는 곡은 빠진다. 내 파일 곡(`L` 번호) 점도 표지(`/api/local/<id>/cover`)와 재생이 되어야 한다(MUST). 지금 Musike가 재생 중인 곡은 지도에 재생 중으로 보여야 한다(MUST). 지도의 ♥ 표시·「♥ 즐겨찾기만」 조건은 Musike 즐겨찾기를 따른다. 지도 고유의 개인 기록(따로 저장하던 ♥·내 평점·메모)은 옮기지 않는다.

#### Scenario: 타츠로 곡 재생
- **WHEN** 지도에서 야마시타 타츠로 「Sparkle」 점을 골라 ▶를 누른다
- **THEN** 정보 패널에 앨범 표지가 보이고, Musike 아래 재생 막대에 그 곡이 나오며 대기열에 닮은 곡이 이어진다

#### Scenario: 검색 결과를 대기열에
- **WHEN** 지도에서 「비 오는 날 재즈」를 검색하고 결과 머리의 「⋯」에서 「대기열에 추가」를 누른다
- **THEN** 결과 곡들이 Musike 대기열 끝에 들어간다

#### Scenario: 재생 중 표시
- **WHEN** 다른 화면에서 재생을 시작한 뒤 지도를 연다
- **THEN** 그 곡 점에 재생 표시가 있고 정보 패널 버튼은 「일시정지」다

### Requirement: 지도 페이지만 다시 만든다
분석기는 `python -m musike_analysis map`으로 벡터·UMAP 계산 없이 지금 `map/map_points.json`에서 지도 페이지(`index.html`과 웹 파일)만 다시 써야 한다(MUST). `map_points.json`이 없으면 아무것도 쓰지 않고 실패로 끝나야 한다(MUST).

#### Scenario: 웹 파일만 고친 뒤
- **WHEN** 지도 템플릿을 고치고 `MUSIKE_ANALYSIS_DIR=/tmp/시험 python -m musike_analysis map`을 돌린다
- **THEN** `/tmp/시험/map/index.html`이 새 템플릿과 그 폴더의 지점 자료로 다시 써지고 운영 분석 폴더는 그대로다
