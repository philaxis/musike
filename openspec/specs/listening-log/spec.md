# listening-log Specification

## Purpose
TBD - created by archiving change play-log. Update Purpose after archive.

## Requirements

### Requirement: 들은 기록을 한 줄씩 남긴다
곡이 지금 곡에서 벗어나면(끝까지 들음, 다음 곡으로 넘김, 창을 닫음) 그 기기는 서버에 한 줄을 남겨야 한다(MUST): 시작·끝 시각, 곡 번호·제목·아티스트·앨범, 출처(내 파일/유튜브), 길이, 실제로 들은 초, 끝난 이유(finished/skipped/left), 기기(phone/pc/tv). 들은 초는 재생 중인 동안만 세고 위치를 건너뛴 구간은 세지 않아야 하며(MUST), 2초 미만은 남기지 않는다. 크로스페이드로 끝 몇 초 전에 넘어간 곡은 끝까지 들은 것으로 친다.

#### Scenario: 듣다가 넘김
- **WHEN** 「Circus Town」을 8초 듣고 다음 곡을 누른다
- **THEN** `plays.jsonl`에 `"id":"…","heard":8,"end":"skipped"` 줄이 생긴다

#### Scenario: 끝 근처로 옮겨 끝까지 들음
- **WHEN** 곡을 4초 듣고 재생 위치를 끝 6초 전으로 옮겨 끝까지 듣는다
- **THEN** 들은 초는 약 10초이고 `"end":"finished"`로 남는다

#### Scenario: 이상한 시각
- **WHEN** 기기 시계가 틀려 끝 시각이 한 시간 뒤인 줄이 온다
- **THEN** 그 줄은 버린다
