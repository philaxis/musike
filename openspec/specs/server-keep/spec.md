# server-keep Specification

## Purpose
TBD - created by archiving change server-library. Update Purpose after archive.

## Requirements

### Requirement: 유튜브 곡을 서버에 받아 둘 수 있다
유튜브 곡의 메뉴에 「서버에 받아 두기」가 있어야 한다(MUST). 누르면 서버가 소리(m4a, 재인코딩 없음)를 `/mnt/backup8t/orca-data/musike/keep`에 받고, 받는 동안과 받은 뒤를 곡 줄에 표시한다. 받아 둔 곡은 같은 곡 번호 그대로 유튜브 대신 그 파일로 재생되고, 「받아 둔 곡」 뿌리 아래 내 음악에도 보인다. 「받아 둔 파일 지우기」로 파일을 지우면 다시 유튜브에서 받아 넘긴다.

#### Scenario: 받아 둔 뒤 유튜브에서 사라짐
- **WHEN** 곡을 받아 둔 뒤 유튜브에서 그 영상이 지워진다
- **THEN** 재생목록에서 그 곡이 그대로 재생된다

#### Scenario: SSD를 쓰지 않음
- **WHEN** 곡 10개를 받아 둔다
- **THEN** 파일은 모두 `/mnt/backup8t/orca-data/musike/keep` 아래에 있고 홈 폴더와 `/tmp`에는 남지 않는다
