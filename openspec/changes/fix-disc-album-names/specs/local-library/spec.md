## ADDED Requirements

### Requirement: 디스크 폴더는 앨범 이름과 디스크 번호로 보인다
앨범 폴더 이름이 `CD n`, `Disc n`, `Disk n`이면 그 위 폴더 이름(날짜·음질 표시 뺀 것)에 「(CD n)」을 붙여 앨범 이름으로 쓰고, 연도는 위 폴더에서 읽어야 한다(MUST).

#### Scenario: 두 장짜리 라이브
- **WHEN** `카시오페아 곡별/[1987.xx.xx] Perfect, Live II (192 Kbps)/CD 2/` 안의 곡들을 읽는다
- **THEN** 내 음악에 「Perfect, Live II (CD 2)」, 1987로 보인다
