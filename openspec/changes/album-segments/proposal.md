# Proposal: 합친 앨범 파일을 곡으로 나눠 보기(가상 나눔)

## Why

사용자 11-18: 야마시타 타츠로 폴더의 앨범 mp4 61개는 파일 하나가 앨범 하나라서, 곡 하나만 골라 듣거나 재생목록에 곡 단위로 넣을 수 없다. 곡으로 나누고 싶다. 판정: 새 소리 파일을 만들지 않는 「가상 나눔」 — 파일마다 곡 구간만 적어 두고 Musike가 그 구간을 튼다(음악 폴더는 읽기 전용, 디스크 늘지 않음).

영상 아래쪽에 지금 곡 제목(「01. いつか」)과 곡마다 한 칸씩인 진행 막대가 박혀 있어, 구간과 제목은 그림에서 읽어 낼 수 있다(작업 도구는 레포 밖 `~/scratch/tatsuro-split`).

## What Changes

- 데이터 폴더의 `segments.json`(있을 때만): 뿌리 이름 → 뿌리 안 경로 → 곡 목록 `{ no, start, end, title }`.
- 곡 목록이 있는 파일은 곡 N개(가상 곡)로 보인다. 곡 번호는 `L` + `sha256("<뿌리>/<경로>#<no>")` 20자, `kind: "song"`, 길이 = end − start, 제목은 목록의 것, 가수·연도·표지는 파일의 것, 앨범 이름은 파일 제목.
- 파일 자체의 곡(통째)은 그대로 색인에 남아 재생목록·즐겨찾기에 든 것은 그대로 재생되지만, 앨범 목록·찾기·곡 상자에는 곡들만 보인다. 통째 파일을 숨겨 두었으면 그 곡들도 숨는다.
- 가상 곡 재생: 소리 모드만, 그 자리에서 떼어 보내기(`audioMode: "offset"`)로 `start + t`부터 `end`까지. `prepare`는 `hasSdVideo: false`. 영상 모드 요청은 400.
- 웹 플레이어: 서버 파일을 처음 틀 때 `prepare`로 구간 요청 방식을 먼저 묻는다(가상 곡은 `kind: "song"`이라 곡 모양만으로는 알 수 없다).
- API: `GET /api/local/segments?root=`(나눈 파일 목록), `GET /api/local/segments?root=&path=`(파일의 곡과 곡 번호), `PUT /api/local/segments?root=&path=` `{ segments }`(통째로 바꾸기, 빈 목록이면 다시 통째 파일). 헤르메스가 경계·제목을 고친다. 「내 음악 다시 읽기」(`POST /api/local/rescan`)는 `segments.json`도 다시 읽는다.

## Capabilities

### New Capabilities

(없음)

### Modified Capabilities

- `local-library`: 합친 앨범 파일의 가상 나눔 요구를 더한다.

## Impact

- 서버: `server/src/segments.ts`(새), `local.ts`, `serverRoutes.ts`, `i18n.ts`, `test/segments.test.ts`(새)
- 웹: `player/player.ts`(첫 재생 전에 `prepare`)
- 데이터: `~/.local/share/musike/data/segments.json`(새, 61개 파일 곡 목록)
- 문서: `AGENTS.md` API 표, 헤르메스 기술 `~/.hermes/skills/media/musike/SKILL.md`
- 하지 않는 것: 새 파일 만들기·자르기, 영상 모드로 곡 구간 보기, 화면에서 경계 고치기(헤르메스가 API로)
