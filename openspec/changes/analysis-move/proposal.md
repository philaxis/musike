# Proposal: 음악지도 분석을 Musike 안으로 (analysis-move)

## Why

사용자 11-18(#26): 듣기 통계·「오늘 좋음」·장르 묶음·자동 재생목록을 원하고, 따로 돌던 「음악지도」(유튜브 시트 → 곡 카드 → 소리/글 벡터 → 3D 지도)를 Musike에 합치기로 했다(보이는 앱은 Musike 하나, 분석은 Musike 레포 안 별도 파이썬 작업자). 음악지도는 구글 시트만 보고 내 파일(타츠로·카시오페아)은 몰랐다. Musike 곡 상자가 이제 유튜브 곡과 내 파일 곡을 다 가지고 있으니 분석도 곡 상자에서 시작해야 한다.

## What Changes

- 레포에 `analysis/` 파이썬 패키지(uv, Python 3.12)를 둔다: `python -m musike_analysis update`.
- 곡 후보 = Musike 곡 상자 전체(`GET /api/box` 페이지 넘기기, 숨긴 곡 제외). 서버 코드는 바꾸지 않는다(필요한 API가 이미 있다).
- 곡 카드(Gemini): 유튜브 곡은 음악지도 카드 캐시를 그대로 쓰고 새 곡만 부른다. 내 파일 곡도 제목·아티스트·앨범·연도로 카드. 한 번 실행에 비용 상한(기본 $1).
- 글 벡터: 카드 글을 multilingual-e5-small(로컬, 브라우저 검색과 같은 ONNX q8 모델)로.
- 소리 벡터: MuQ-MuLan(RTX 3070). 유튜브 곡은 기존 벡터를 쓰고 빠진 곡만 30초 조각을 받는다. 내 파일 곡은 Musike 소리 주소(가상 분할 곡·영상 파일은 `?t=` 오프셋)에서 곡 가운데 30초.
- 큰 갈래 + 소리 묶음(갈래 안 k-means, 번호·이름 유지), 작곡가·작품·앨범·악장·연주(판본) 정규화.
- 결과는 #26 취향 데이터 계약 모양 그대로 `~/.local/share/musike/analysis/`(taste.json, audio.f32, text.f32)에 원자적으로, 3D 지도·소리 검색 색인은 그 아래 `map/`에.
- 큰 원본(조각·카드·parquet)은 하드 `/mnt/backup8t/orca-data/musike/analysis/`에만. 음악지도의 30초 조각(593MB)은 하드로 옮기고 SSD 쪽은 지웠다.
- 매일 06:50(06:30 곡 상자 동기화 뒤) systemd user 타이머 `musike-analysis.timer`(초안 `deploy/systemd/`, 설치 스크립트).
- 옮기지 않는 것: 구글 시트 들여오기, xlsx 감시, 개인 기록 serve API, publish.

## Capabilities

### New Capabilities

- `taste-analysis`: 곡 상자 → 곡 카드·소리/글 벡터·소리 묶음·작품 정규화 → 취향 데이터와 지도.

## Impact

- `analysis/`(새 파이썬 패키지, 시험 `analysis/tests`), `deploy/systemd/`(새), `.gitignore`.
- 서버·웹 코드는 바꾸지 않는다. 운영 서버는 읽기만 한다(곡 상자, 소리 주소).
- 데이터: 결과 약 15MB + 지도 약 30MB(SSD), 원본 약 0.7GB(하드).
- 음악지도 유닛(`music-map-watch.timer`, `music-map-serve.service`)은 이 변경에서 끄지 않는다(통합 때 끈다).
