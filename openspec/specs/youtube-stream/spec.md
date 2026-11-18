# youtube-stream Specification

## Purpose
TBD - created by archiving change fix-googlevideo-range. Update Purpose after archive.

## Requirements

### Requirement: 막 받은 유튜브 주소가 열릴 때까지 기다린다
서버는 유튜브 소리·영상을 중계할 때 googlevideo가 403을 주면, 주소를 새로 받기 전에 같은 주소로 0.5초 간격, 최대 8초까지 다시 요청해야 한다(MUST). 그래도 403이나 410이면 주소를 한 번 새로 받아 같은 방식으로 다시 시도하고, 그래도 안 되면 지금처럼 502와 "yt-dlp 업데이트" 안내로 답한다. 브라우저가 연결을 끊으면 기다리기를 멈춘다.

#### Scenario: 처음 트는 곡
- **WHEN** 한 번도 튼 적 없는 유튜브 곡의 소리를 `Range: bytes=0-`으로 요청한다
- **THEN** 서버는 몇 초 안에 206으로 답하고 소리 파일 전체가 온다

#### Scenario: 중간으로 건너뛰기
- **WHEN** 같은 곡을 `Range: bytes=1000000-1099999`로 요청한다
- **THEN** 서버는 206과 정확히 100000바이트를 보낸다

#### Scenario: 정말로 막힌 곡
- **WHEN** 8초 동안 403이 이어지고 새로 받은 주소도 8초 동안 403이다
- **THEN** 서버는 502와 yt-dlp 업데이트 안내로 답한다
