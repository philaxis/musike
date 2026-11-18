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

### Requirement: 유튜브 소리는 조각으로 나눠 제 속도로 받는다
서버는 유튜브 소리·영상을 중계할 때 브라우저가 청한 범위를 googlevideo에 끝을 정한 2 MB 이하 요청으로 나눠 차례로 받아 한 응답으로 이어 보내야 한다(MUST). 끝을 정하지 않은 요청은 YouTube가 느리게 묶기 때문이다. 응답의 `content-length`와 `content-range`는 첫 조각에서 알게 된 전체 크기로 계산하고, 중간 조각에서 주소가 거절되면 주소를 새로 받아 그 자리부터 이어 받는다.

#### Scenario: 긴 곡을 처음부터 튼다
- **WHEN** 18분짜리 유튜브 곡의 소리를 `Range: bytes=0-`으로 요청한다
- **THEN** 서버는 206, 전체 크기의 `content-range`로 답하고 10초 안에 1 MB를 훨씬 넘게 보낸다

#### Scenario: 중간으로 건너뛴다
- **WHEN** 같은 곡을 `Range: bytes=4000000-`으로 요청한다
- **THEN** 서버는 `bytes 4000000-(전체-1)/(전체)`로 답하고 곡 끝까지 제 속도로 보낸다
