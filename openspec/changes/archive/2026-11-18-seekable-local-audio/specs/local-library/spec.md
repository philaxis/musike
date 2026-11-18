## ADDED Requirements

### Requirement: 소리만 떼어 보내는 곡도 구간 요청에 답한다
앨범 영상의 소리나 나눈 곡을 보낼 때 서버는 전체 길이(`Content-Length`)와 `Accept-Ranges: bytes`를 알리고, `Range` 요청에는 206과 그 구간의 바이트를 보내야 한다(MUST). 같은 곡·같은 시작 지점은 매번 같은 바이트여서 이어 받은 소리가 앞부분과 맞는다. 디스크에는 저장하지 않는다.

#### Scenario: 이어 받기
- **WHEN** 브라우저가 「Help Me Rhonda」를 받다가 멈춘 뒤 `Range: bytes=1000000-`로 다시 요청한다
- **THEN** 서버는 206과 `bytes 1000000-(전체-1)/전체`를 답하고, 그 바이트는 처음 받은 파일의 1,000,000번째부터와 같다
