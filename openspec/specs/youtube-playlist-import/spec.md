# youtube-playlist-import Specification

## Purpose
TBD - created by archiving change server-library. Update Purpose after archive.

## Requirements

### Requirement: 유튜브 재생목록 링크를 재생목록으로 가져온다
서버는 유튜브·유튜브 뮤직 재생목록 링크(`playlist?list=`, `watch?v=…&list=`, 앨범 `OLAK5uy_…`)를 받아 같은 이름의 Musike 재생목록을 만들어야 한다(MUST). 곡은 저장하지 않고 번호·제목·가수·길이·표지만 담으며, 들을 때 서버가 받아 넘긴다(광고 없음). 같은 이름의 재생목록이 이미 있으면 빠진 곡만 뒤에 더하고, 비공개·삭제된 항목은 건너뛰고 그 수를 알려 준다. 로그인이 필요한 목록(좋아요, 나중에 볼 동영상)은 "로그인이 필요한 목록은 못 가져와요"로 답한다.

#### Scenario: 검색창에 링크 붙여 넣기
- **WHEN** 검색창에 공개 재생목록 링크를 붙여 넣는다
- **THEN** 결과 맨 위에 「재생목록으로 가져오기 (N곡)」 칸이 뜨고, 누르면 그 이름의 재생목록이 왼쪽 목록에 생기며 바로 틀 수 있다

#### Scenario: 다시 가져오기
- **WHEN** 유튜브에서 두 곡이 더해진 같은 재생목록을 다시 가져온다
- **THEN** Musike 재생목록에 그 두 곡만 뒤에 더해지고 기존 곡 순서는 그대로다

#### Scenario: API로 가져오기
- **WHEN** AI가 `POST /api/import/youtube`에 재생목록 링크를 보낸다
- **THEN** 응답에 재생목록 번호, 더한 곡 수, 건너뛴 곡 수가 온다
