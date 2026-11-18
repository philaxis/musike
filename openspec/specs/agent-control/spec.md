# agent-control Specification

## Purpose
TBD - created by archiving change server-library. Update Purpose after archive.

## Requirements

### Requirement: 헤르메스(텔레그램)로 재생목록과 곡을 정리한다
헤르메스 기술 파일 `~/.hermes/skills/media/musike/SKILL.md`가 있어, 사용자가 텔레그램에서 말로 시키면 헤르메스가 서버 API로 로컬 곡 찾기(`GET /api/local?q=`), 재생목록 만들기·이름 바꾸기·지우기, 곡 넣기·빼기, 순서 통째로 바꾸기(`PUT /api/playlists/:pid/tracks`), 유튜브 재생목록 가져오기, 받아 두기를 해야 한다(MUST). 답장은 무엇을 했는지 한두 줄과 「▶ 열기」 링크(Tailscale HTTPS 주소의 `/list/<번호>` 또는 `/play/<번호>`)로 끝난다. 재생목록을 지울 때는 한 번 되묻는다. 레포 `AGENTS.md`에도 같은 API 표와 curl 예시를 둔다.

#### Scenario: 말로 재생목록 만들기
- **WHEN** 사용자가 텔레그램에서 헤르메스에게 "카시오페아 라이브 앨범만 모아서 '카시오페아 라이브' 만들어 줘"라고 보낸다
- **THEN** 헤르메스가 라이브 앨범들이 연도순으로 든 재생목록을 만들고, 곡 목록과 「▶ 열기」 링크를 답한다. 폰에서 링크를 누르면 그 재생목록이 처음부터 재생된다

#### Scenario: 유튜브 재생목록 링크 보내기
- **WHEN** 사용자가 헤르메스에게 유튜브 재생목록 링크만 보낸다
- **THEN** 헤르메스가 그 재생목록을 가져오고 "「여름 밤」 31곡 가져왔어요(비공개 2곡 건너뜀)"와 열기 링크를 답한다

#### Scenario: 순서 바꾸기 검사
- **WHEN** `PUT /api/playlists/:pid/tracks`에 기존 곡 번호를 다른 순서로 보낸다
- **THEN** 재생목록이 그 순서가 되고, 목록에 없는 번호가 섞이면 400으로 거절한다

### Requirement: 재생은 그 기기에서만 다룬다
헤르메스와 서버 API는 기기의 재생(멈춤, 다음 곡, 볼륨, 기기 사이 옮기기)을 원격으로 조작하지 않아야 한다(MUST). 기기마다 재생 상태는 그 기기의 것이고, 서버는 재생목록·즐겨찾기·받아 둔 곡만 같이 쓴다.

#### Scenario: 원격 조작 요청
- **WHEN** 사용자가 헤르메스에게 "다음 곡"이라고 보낸다
- **THEN** 헤르메스는 "재생은 듣고 있는 기기에서 넘겨 주세요"라고 답하고 아무 기기도 바꾸지 않는다

### Requirement: 링크 하나로 곡이나 재생목록을 바로 연다
웹 경로 `/play/<곡 번호>`는 그 곡을, `/list/<재생목록 번호>`는 그 재생목록을 링크를 연 기기에서 처음부터 재생해야 한다(MUST). 브라우저가 자동 재생을 막으면 큰 재생 단추를 보여 준다.

#### Scenario: yt-bulk 알림 링크
- **WHEN** yt-bulk가 받기를 끝내고 텔레그램으로 보낸 Musike 링크를 폰에서 누른다
- **THEN** Musike가 열리고 그 영상이 재생된다(또는 재생 단추 하나만 누르면 된다)
