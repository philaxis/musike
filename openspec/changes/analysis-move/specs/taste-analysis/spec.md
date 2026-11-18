## ADDED Requirements

### Requirement: 곡 상자 전체를 분석 후보로 삼는다
분석 작업자는 Musike 서버의 곡 상자(`GET /api/box`, 모든 페이지)를 읽어 유튜브 곡과 내 파일 곡(가상으로 나눈 앨범 곡 포함)을 후보로 삼아야 한다(MUST). 숨긴 곡, 묶음 줄, 지워진 영상 제목(`Deleted video`·`Private video`)은 빼야 한다(MUST). 서버에 닿지 않으면 결과 파일을 건드리지 않고 실패로 끝나야 한다(MUST).

#### Scenario: 타츠로 앨범 파일을 나눈 곡
- **WHEN** 곡 상자에 「야마시타 타츠로」 폴더의 가상 분할 곡 511곡과 카시오페아 곡별 476곡이 있다
- **THEN** 분석 결과 taste.json에 그 곡들이 `L`로 시작하는 곡 번호로 들어 있다

#### Scenario: 서버가 꺼져 있음
- **WHEN** :4180 서버가 응답하지 않는 때에 분석이 돈다
- **THEN** 분석은 실패로 끝나고 taste.json은 지난 판 그대로다

### Requirement: 새 곡만 카드를 만들고 비용 상한을 지킨다
곡 카드는 곡 번호별로 캐시하고 카드가 없거나 최소 카드인 곡만 Gemini를 불러야 한다(MUST). 한 번 실행의 Gemini 비용이 상한(기본 $1)에 닿으면 더 부르지 않아야 하고(MUST), 재생목록·내 폴더 곡 중 카드를 못 만든 곡은 제목·아티스트로 만든 최소 카드로 결과에 넣고 다음 실행에서 다시 시도해야 한다(MUST). Gemini 키는 `~/.config/book-db/gemini.key` 파일에서만 읽고 출력하지 않는다.

#### Scenario: 매일 실행
- **WHEN** 어제 이후 곡 상자에 유튜브 곡 3곡이 새로 들어왔다
- **THEN** Gemini는 그 3곡에 대해서만 불리고 나머지 곡 카드는 그대로다

#### Scenario: 상한 도달
- **WHEN** 상한이 $0.01인데 카드가 필요한 곡이 1,000곡이다
- **THEN** 상한에 닿은 뒤로는 부르지 않고, 남은 곡은 최소 카드로 들어가며 실행은 끝까지 간다

### Requirement: 소리 벡터는 빠진 곡만, 원본은 하드에
소리 벡터(MuQ-MuLan, 30초)는 벡터도 조각도 없는 곡만 새로 만들어야 한다(MUST). 유튜브 곡은 30초 구간을 받고, 내 파일 곡은 Musike 소리 주소에서 곡 가운데 30초를 잘라야 한다(가상 분할 곡·영상 파일은 `?t=` 오프셋)(MUST). 조각·카드·벡터 캐시는 `/mnt/backup8t/orca-data/musike/analysis/` 아래에만 두고, 그 자리의 부모 폴더가 없으면(하드가 안 붙음) 아무것도 쓰지 않고 멈춰야 한다(MUST). 다시 안 될 사유(삭제·비공개·저작권 등)로 실패한 곡은 다시 받지 않는다.

#### Scenario: 나눈 곡의 가운데
- **WHEN** 앨범 파일을 나눈 곡 「Wendy」(153초)를 분석한다
- **THEN** 서버 `/api/stream/<번호>/audio?t=61.5`에서 30초를 받아 조각을 만든다

#### Scenario: 하드가 빠짐
- **WHEN** `/mnt/backup8t`가 붙어 있지 않을 때 분석이 돈다
- **THEN** "작업 폴더 자리가 없습니다" 오류로 멈추고 SSD에 조각을 쓰지 않는다

### Requirement: 큰 갈래와 소리 묶음은 다음 실행에서도 유지된다
큰 갈래는 카드 장르이고 25곡 미만 장르는 `기타`여야 한다(MUST). 소리 묶음은 갈래 안에서 소리 벡터로 나누고, 소리 벡터가 없는 곡은 글 벡터가 가장 가까운 묶음에 넣으며, 25곡 미만 묶음은 `<갈래>·etc`(이름 「그 밖의 <갈래>」)로 모아야 한다(MUST). 묶음 이름은 하위장르 상위 2개이고 겹치면 대표 아티스트로 구분한다. 한 번 정한 묶음 번호·이름과 곡 배정은 다음 실행에서 유지하고, 새 곡만 가장 가까운 묶음에 넣어야 한다(MUST).

#### Scenario: 새 재즈 곡
- **WHEN** 어제 「재즈·3 재즈퓨전 · 모던재즈」였던 곡들이 있고 재즈 곡 하나가 새로 들어온다
- **THEN** 기존 곡의 묶음 번호·이름은 그대로이고 새 곡은 소리가 가장 가까운 재즈 묶음에 들어간다

#### Scenario: 같은 이름
- **WHEN** 재즈 묶음 둘이 모두 하위장르 상위가 「모던재즈 · 보사노바」다
- **THEN** 두 이름은 「모던재즈 · 보사노바 (Bill Evans)」처럼 대표 아티스트로 갈린다

### Requirement: 작곡가·작품·앨범·악장·연주를 정규화한다
곡마다 정규화한 작곡가, 작품(클래식만), 앨범, 악장 번호·이름(제목에서), 연주(판본) 문자열을 결과에 넣어야 한다(MUST). 같은 사람·같은 작품의 다른 표기('Brahms'/'Johannes Brahms', 'Op.78'/'Op. 78')는 한 표기로 모아야 하고(MUST), 같은 작곡가·작품·주 연주자(·앨범)의 곡들은 같은 연주 문자열을 가져야 한다(MUST). 다른 사람을 하나로 모으지 않는다(이름이 다르면 따로).

#### Scenario: 소나타 세 악장
- **WHEN** 「Brahms: Violin Sonata No. 1, Op. 78: I. Vivace ma non troppo」와 작곡가가 'Johannes Brahms'·작품이 'Violin Sonata No.1 Op.78'로 적힌 「II. Adagio」가 같은 연주자·앨범이다
- **THEN** 둘 다 composer 'Johannes Brahms', work 'Violin Sonata No. 1, Op. 78', 같은 instance이고 movement는 1과 2다

#### Scenario: 클래식이 아닌 곡
- **WHEN** 타츠로 「RIDE ON TIME」을 분석한다
- **THEN** work·movement·instance는 null이고 album은 'RIDE ON TIME'이다

### Requirement: 결과는 계약 모양으로 원자적으로 쓴다
결과는 `$MUSIKE_ANALYSIS_DIR`(기본 `~/.local/share/musike/analysis/`)에 #26 취향 데이터 계약 모양(taste.json, audio.f32, text.f32: little-endian float32, 행마다 L2 정규화, 행 번호는 곡의 `a`·`t`)으로 써야 한다(MUST). 세 파일은 임시 파일에 먼저 쓰고 rename 해야 하며, taste.json을 마지막에 바꿔야 한다(MUST). 3D 지도와 소리 검색 색인은 그 아래 `map/`에 쓴다.

#### Scenario: 읽는 도중
- **WHEN** Musike 서버가 taste.json을 읽는 순간에 분석이 끝난다
- **THEN** 서버는 지난 판 전체나 새 판 전체를 읽고, 반쯤 쓴 파일은 보지 않는다

### Requirement: 매일 새벽 새 곡만 분석한다
systemd user 타이머가 매일 06:50(곡 상자 동기화 06:30 뒤)에 분석을 돌려야 한다(MUST). 이미 돌고 있으면 두 번째 실행은 아무것도 하지 않고 끝나야 한다(MUST).

#### Scenario: 겹친 실행
- **WHEN** 손으로 돌린 분석이 끝나기 전에 타이머가 분석을 다시 부른다
- **THEN** 두 번째 실행은 "다른 분석이 실행 중" 으로 바로 끝난다(종료 코드 75)
