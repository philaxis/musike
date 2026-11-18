## ADDED Requirements

### Requirement: 합친 앨범 파일은 적어 둔 구간대로 곡이 된다
서버 데이터 폴더의 `segments.json`에 곡 목록(`{ no, start, end, title }`, 초 단위, 시간 순, 겹치지 않음)이 적힌 파일은, 새 파일을 만들지 않고 그 구간마다 곡 하나(가상 곡)가 되어야 한다(MUST). 가상 곡의 번호는 `L`과 `sha256("<뿌리>/<경로>#<no>")` 20자로, 구간이나 제목을 고쳐도 `no`가 같으면 그대로다. 가상 곡은 `kind: "song"`, 길이는 `end − start`, 제목은 목록의 것이고 가수·연도·표지는 파일의 것, 앨범 이름은 파일 제목이다. 통째 파일의 곡은 색인에 남아 재생목록·즐겨찾기·최근 재생에 든 것은 그대로 재생되어야 하지만(MUST), 「내 음악」 앨범·곡 목록, `/api/local` 찾기, 곡 상자에는 가상 곡들만 보인다(SHALL). 통째 파일을 숨겼으면 그 가상 곡들도 숨긴 것으로 다룬다.

#### Scenario: 앨범이 곡으로 보인다
- **WHEN** `segments.json`에 「[1980.09.21] RIDE ON TIME (Lossless).mp4」의 곡 9개가 있는 서버에서 「내 음악 › 야마시타 타츠로 › RIDE ON TIME」을 연다
- **THEN** 「いつか」부터 「おやすみ」까지 9곡이 제목·길이와 앨범 표지로 보이고, 통째 파일 줄은 보이지 않는다

#### Scenario: 통째 파일이 든 재생목록
- **WHEN** 나누기 전에 통째 「RIDE ON TIME」을 넣어 둔 재생목록을 연다
- **THEN** 그 줄은 「파일 없음」이 아니고, 틀면 43분짜리 파일이 처음부터 재생된다

#### Scenario: 찾기
- **WHEN** 「screamer」로 찾는다
- **THEN** 「내 음악」 묶음에 「Silent Screamer」 한 곡이 나온다

### Requirement: 가상 곡은 그 구간만 소리로 재생된다
가상 곡은 소리 모드로만 재생되며, 서버는 파일에서 `start + t`부터 `end`까지의 소리만 그 자리에서 떼어(재인코딩 없이) 보내야 한다(MUST). `prepare`는 `audioMode: "offset"`, `hasSdVideo: false`를 돌려주고, 영상 요청은 400이다. 되감기는 곡 안의 위치(`?t=`)로 다시 떼어 보내고, 곡 길이 이상이면 마지막 1초만 보낸다. 곡이 끝나면 다음 곡으로 넘어간다.

#### Scenario: 곡 처음과 끝
- **WHEN** RIDE ON TIME의 3번 곡 「Silent Screamer」를 튼다
- **THEN** 소리가 앞 곡이 끝난 조용한 틈의 끝 1초 안에서 시작하고, 다음 곡 시작 지점에서 끝나 4번 곡이 이어서 나온다

#### Scenario: 곡 안에서 되감기
- **WHEN** 3번 곡을 듣다가 진행 막대를 2:00으로 보낸다
- **THEN** 2초 안에 곡의 2:00부터 소리가 나오고 위치·길이는 곡 기준(길이 5:29 근처)으로 보인다

### Requirement: 곡 구간은 API로 읽고 고친다
`GET /api/local/segments?root=`는 그 뿌리에서 나눈 파일(`path`, 곡 수)을, `GET /api/local/segments?root=&path=`는 파일의 곡 번호와 곡 목록(가상 곡 번호 `id` 포함)과 파일 길이를 돌려주어야 한다(MUST). `PUT /api/local/segments?root=&path=` `{ segments }`는 그 파일의 곡 목록을 통째로 바꾸고 `segments.json`에 임시 파일→바꿔 넣기로 저장한다(SHALL). 빈 목록은 나눔을 없애 통째 파일로 돌린다. 번호 중복, `start ≥ end`, 겹침, 파일보다 긴 끝, 빈 제목은 400이다. `POST /api/local/rescan`은 `segments.json`을 다시 읽는다.

#### Scenario: 경계 고치기
- **WHEN** 헤르메스가 2번 곡의 `end`와 3번 곡의 `start`를 1초 늦춰 `PUT`한다
- **THEN** 곧바로 앨범의 2·3번 곡 길이가 바뀌고 곡 번호는 그대로라 재생목록의 그 곡들이 그대로 재생된다

#### Scenario: 잘못된 목록
- **WHEN** 겹치는 두 곡이나 파일 길이보다 긴 곡을 `PUT`한다
- **THEN** 400과 무엇이 틀렸는지 알려 주는 말이 오고 저장된 목록은 그대로다
