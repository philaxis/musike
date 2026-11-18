## MODIFIED Requirements

### Requirement: 보관함에 「음악 지도」 화면이 있다
지도가 있으면 보관함 맨 아래에 「음악 지도」 작은 링크가 보여야 하고(MUST, TV 모드 제외), 누르면 `/library/map`에서 3D 지도와 검색(글자·의미·소리)을 Musike 화면 안에서 써야 한다(MUST). 지도가 없으면 그 화면은 분석기가 매일 만든다는 안내를 보여야 한다(MUST). 폰에서도 한 손가락 회전·두 손가락 확대가 되고 검색 결과는 목록으로 보여야 한다(MUST).

#### Scenario: 보관함에서 열기
- **WHEN** 지도가 있는 서버에서 보관함 맨 아래의 「음악 지도」를 누른다
- **THEN** 4천여 곡의 점이 있는 3D 지도와 검색창이 Musike 화면 안에 열린다

#### Scenario: 지도 페이지를 직접 열기
- **WHEN** `/api/map/`을 브라우저 주소창으로 연다
- **THEN** `/library/map`으로 옮겨 Musike 화면 안에서 열린다
