## ADDED Requirements

### Requirement: 소리 주소는 유튜브 API에 직접 먼저 묻는다
서버는 유튜브 곡의 소리를 준비하거나 중계할 때 주소를 유튜브 API에 직접(설정된 클라이언트, 기본 VISIONOS) 먼저 물어야 한다(MUST). 직접 질문이 소리 주소를 주지 않거나 실패하면 yt-dlp로 받고, yt-dlp가 못 트는 까닭을 정한다. 직접 질문이 「Music Premium members」라고 답하면 곧바로 프리미엄 전용으로 못 트는 곡이다. 영상 주소와 채널 이름은 yt-dlp로 받는다.

#### Scenario: 처음 누른 곡
- **WHEN** 준비한 적 없는 유튜브 곡을 `/api/prepare`로 묻는다
- **THEN** 서버는 yt-dlp를 띄우지 않고 1초 안에 답한다

#### Scenario: 프리미엄 전용 곡
- **WHEN** 직접 질문이 프리미엄 전용이라고 답하는 곡을 준비한다
- **THEN** 서버는 yt-dlp를 기다리지 않고 그 곡을 프리미엄 전용으로 표시하고 대신 틀 판을 찾는다
