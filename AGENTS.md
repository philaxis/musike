# philaxis/musike (서버판 Musike)

[Ernani1234/musike](https://github.com/Ernani1234/musike)(MIT)를 포크해 리눅스 서버에서 혼자 쓰는 판. 원작 동기화는 `upstream` 리모트. 서버판 변경은 새 파일 위주로 두고 원작 파일은 짧게 고친다.

## 스펙
- OpenSpec: `openspec/`. 서버판 전체 그림은 `openspec/changes/server-library/design.md`(archive 뒤에는 `openspec/specs/*`).
- 역할: 서버 = 곡·재생목록 원본, 헤르메스(텔레그램) = 말로 정리만, 폰·노트북·TV = 각자 재생. 어떤 기기도 다른 기기를 조종하지 않는다. TV는 틀기만(정리 기능 숨김).

## 운영
- 서비스: `systemctl --user {status,restart} musike` (`~/.config/systemd/user/musike.service`, `pnpm start`, :4180, 0.0.0.0).
- 주소: Tailscale `https://philaxis-b760m-aorus-elite.taildeaa80.ts.net:4443`(PWA, `tailscale serve --https=4443`), 집 안 `http://192.168.0.43:4180`(TV, `?tv=1`).
- 데이터: `~/.local/share/musike/data`(`library.json`, `local-index.json`, `backups/`, 영상 기록 `videos.json`·`video-events.jsonl`·`video-aliases.json`은 `server/src/ledger.ts`만 씀). 캐시·받아 둔 곡: `/mnt/backup8t/orca-data/musike/{cache,keep}`(HDD).
- 내 음악 폴더(`MUSIKE_LOCAL_DIRS`, 읽기 전용, 절대 쓰지 않음): `/mnt/backup8t/gdrive/current/MUSICS/{야마시타 타츠로,카시오페아}`(구글 드라이브 사본), `~/보관함/유튜브`(yt-bulk).
- yt-dlp: `uv tool`로 설치, `yt-dlp-update.timer`가 매일 업데이트.
- 취향 분석(#26, `analysis/` 파이썬, 설계 `openspec/changes/analysis-move/design.md`): `musike-analysis.timer`가 매일 06:50 `uv run python -m musike_analysis update`(곡 상자 → 카드·소리/글 벡터·소리 묶음 → `~/.local/share/musike/analysis/{taste.json,audio.f32,text.f32,map/}`). 원본(조각·카드·parquet)은 `/mnt/backup8t/orca-data/musike/analysis/`. 마지막 결과 `python -m musike_analysis status`. 지도 웹 파일(`analysis/musike_analysis/web/`)만 고쳤으면 `python -m musike_analysis map`(계산 없이 `map/index.html`만 다시, 시험은 `MUSIKE_ANALYSIS_DIR=/tmp/…`). 시험: `cd analysis && uv run --group dev pytest`.
- 헤르메스 기술: `~/.hermes/skills/media/musike/SKILL.md`(API 표와 답장 모양). API를 바꾸면 같이 고친다.

## 개발
- `pnpm install`, `pnpm typecheck`, `pnpm --filter ./server test`, `pnpm build`(웹), 시험 서버는 `PORT=4190 HOST=127.0.0.1 MUSIKE_DATA_DIR=/tmp/… pnpm start`.

## API (서버판에서 더한 것)
| 메서드 | 경로 | 하는 일 |
|---|---|---|
| GET | `/api/local/roots` | 내 음악 뿌리와 곡 수, 읽을 수 있는지 (숨긴 뿌리 빠짐, `?hidden=1`이면 `hidden: true`로 같이) |
| GET | `/api/local/albums?root=` · `/api/local/album?root=&key=` | 앨범 목록 · 앨범 곡 (숨긴 곡 빠짐, `&hidden=1`이면 같이) |
| GET | `/api/local?q=&root=&limit=` | 내 음악에서 찾기 (숨긴 곡 빠짐, `&hidden=1`이면 같이) |
| GET/POST/DELETE | `/api/local/hidden` · `{ids?, root?}` | 숨긴 것 `{ids, roots}` · 곡/뿌리 숨기기 · 숨기기 해제 (`data/hidden.json`, 파일은 그대로, 재생목록 곡은 그대로 재생) |
| GET/PUT | `/api/local/segments?root=&path=` · `PUT {segments: [{no, start, end, title}]}` | 합친 앨범 파일의 곡 구간(가상 나눔, `data/segments.json`). `path` 없으면 나눈 파일 목록. 곡 번호는 `no`로 정해져 경계·제목을 고쳐도 그대로, 빈 목록이면 통째 파일로. 곡은 소리만, 통째 파일은 재생목록에서 그대로 재생 |
| POST | `/api/local/rescan` | 폴더 다시 읽기 (`data/segments.json`도) |
| GET | `/api/local/:id/cover` | 표지 |
| GET | `/api/track/:id` | 곡 하나(로컬·유튜브) |
| PUT | `/api/playlists/:pid/tracks` `{ids}` | 순서 통째로 바꾸기(지금 곡 번호의 순열만, 두 번 든 곡은 두 번) |
| POST/DELETE | `/api/playlists/:pid/tracks` `{tracks, duplicates?}` · `DELETE {at, ids}` | 넣기(이미 있는 곡은 빼고, `duplicates: true`면 모두, 5000곡까지) · 자리로 빼기(`ids[k]`가 `at[k]` 곡이어야, 아니면 409) |
| GET/POST | `/api/import/youtube/preview?url=` · `/api/import/youtube {url,name?}` | 유튜브 재생목록 미리 보기 · 가져오기 |
| GET/POST/DELETE | `/api/keep` · `/api/keep/:id` | 유튜브 곡 서버에 받아 두기 |
| GET/POST | `/api/box?filter=all\|untagged\|blocked\|replaced&source=&tag=&q=&cursor=` · `/api/box/sources` · `POST /api/box {tracks, source}` | 곡 상자(아는 곡 전부 + 출처, 200줄씩; 여기서 못 트는 곡은 치워 두어 빠지고 `filter=blocked`만 그것들, 항목 `blocked: {reason: region\|gone\|private\|age\|premium, at}`; `filter=replaced`는 못 트는 곡 대신 넣은 곡, 항목 `replaced: {by: redirect\|alternative\|manual, was: 원래 곡, reason, at}`, 검색으로 바꾼 것부터) · 출처 목록(+ `aside` 이유별 치워 둔 수, `replaced` 방법별 바꿔 넣은 수) · 곡 넣기(같은 곡이면 출처만 더함) |
| GET/POST | `/api/box/:id/alternatives` · `POST /api/box/:id/replace {track}` · `POST /api/box/:id/restore` | 못 트는 곡의 다른 판 후보(맨 앞에 유튜브 뮤직이 옮긴 판 `redirect: true`, 이어서 길이 비슷한 순 5개, 못 트는 것 빼고; 바꿔 넣은 곡이면 원래 곡의 후보) · 그 곡으로 바꾸기(곡 상자·재생목록·즐겨찾기·묶음 같은 자리, 출처에 `was: 원래 번호`, `replaced.by: manual`) · 되돌리기(원래 곡을 같은 자리로, 다시 치워 두고 저절로 바꾸지 않음). 못 트는 곡은 서버가 저절로 바꿔 넣는다: 유튜브 뮤직이 옮긴 번호(같은 곡일 때) → 후보 중 같은 제목·길이 ±3초 → 같은 제목·아티스트 → 길이 가까운 것; 재생 때(`/api/prepare`가 `replaced: 새 곡`으로 답함)·확인 뒤·서버 시작 때, 치워 둔 곡은 하루 한 번. 바꿔 넣기·되돌리기는 모두 영상 기록에 `replaced`·`restored`(옛 번호 들은 기록·취향·지도가 새 곡을 따라감) |
| POST | `/api/import/youtube/box {url}` | 붙여 넣은 유튜브 재생목록을 곡 상자로(재생목록 안 만듦) |
| GET/POST/DELETE | `/api/tags` · `{ids, tags}` | 꼬리표 목록(개수) · 붙이기 · 떼기. 관례: `작품:` `판본:` `편곡:` `작곡:` `연주:` `분위기:` `장르:` |
| GET | `/api/tracks/:id/versions` | 같은 `작품:` 꼬리표 곡들(원곡 · 편곡) |
| GET/POST/PATCH/DELETE | `/api/bundles/:id` · `POST /api/bundles {title, artist?, ids}` | 묶음(여러 곡을 한 곡처럼, id `B`+20자). 재생목록엔 묶음 줄로 넣음 |
| GET/DELETE | `/api/google/login` · `/api/google/status` · `DELETE /api/google` | 유튜브 계정 연결(읽기 전용, 토큰 `~/.config/musike/google.json`) |
| GET/PUT/POST | `/api/google/playlists` · `PUT /api/google/excluded {ids}` · `POST /api/google/sync` | 내 유튜브 재생목록(체크 끈 것 `excluded`) · 들여오지 않을 목록 · 새 곡을 곡 상자로, 뒤이어 곡 상자 전부의 재생 가능 여부 확인과 영상 기록(`blocked`: 새로 못 트게 된 수; 409 `google_login`이면 다시 연결). 서버가 처음 뜰 때 확인 기록이 없으면 한 번 확인 |
| GET/POST | `/api/videos/events?cursor=&limit=` · `/api/videos/:id` · `POST /api/videos/check` | 영상 기록(설계 `openspec/changes/video-ledger/design.md`): 유튜브에서 바뀐 것 최신순 100개씩(`kind: title\|channel\|status\|replaced\|restored`, 곡마다 `track` = 지금 곡(곡 상자 제목)·`video` = 그 영상의 유튜브 제목·바꿈은 `other`, `summary`: 지켜보는 수·상태별 수·마지막 확인) · 곡 하나의 기록(`video`, `current` = 지금 번호, 옛 번호 것까지 `events`) · 확인만 지금(`{checked, blocked, changes}`). 바꿔 넣은 곡의 옛 번호는 들은 기록·「오늘 좋음」·취향·지도에서 지금 곡으로 셈 |
| GET | `/api/stats?period=4w\|6m\|all` · `/api/stats/day/:date` · `/api/stats/track/:id` | 내 기록(들은 시간·「한 번 들음」·새로 알게 된 곡·건너뜀 비율, 날짜별, 시간대, 많이 들은 곡·아티스트·장르, 요즘 반복, 잊고 있던 애창곡) · 그날 들은 곡과 그날 ☀ · 곡 하나의 기록. `plays.jsonl`에서 계산, 날짜는 서울. 장르는 분석 결과 `taste.json`이 있을 때만 |
| GET/PUT/DELETE | `/api/daylikes?date=` · `PUT /api/daylikes/:id {곡}` · `DELETE /api/daylikes/:id?date=` | 「오늘 좋음 ☀」(♥와 따로, `data/daylikes.json` 날짜별). 넣기는 늘 오늘(서울) |
| GET | `/api/taste/genres` · `/api/taste/genres/:genre` · `/api/taste/groups/:gid` | 취향 분석(`MUSIKE_ANALYSIS_DIR`, 기본 `~/.local/share/musike/analysis`)의 장르(곡 수·묶음 수) · 장르 안 소리 묶음(이름 같은 묶음은 `tell` 아티스트로 구분, 분석 없는 곡은 `none:<장르>`) · 묶음 곡(대표적인 곡부터). 분석이 없으면 `ready: false` |
| GET | `/api/taste/radio/:id` | 닮은 곡 라디오 25곡(그 곡 먼저, 소리·설명 반반 닮음 + MMR, 아티스트 2곡까지). 분석에 없는 곡은 `analyzed: false` |
| GET | `/api/taste/mixes` · `/api/taste/mixes/:mid` | 오늘의 자동 재생목록(`daily-1`~`daily-5`, `on-repeat`, `new-for-you`, `forgotten`, `upbeat`, `calm`; 서울 날짜로 하루 동안 같음) |
| GET | `/api/works/track/:id` · `/api/works/album?key=` · `/api/works/instance?key=` · `/api/works/composers?genre=` · `/api/works/composer?name=` | 분석의 앨범·작곡가·연주(`instance`)로 내 곡만 묶기: 곡 하나가 이어지는 곳(없으면 null, 내 파일은 `album.local` = 내 음악 앨범) · 앨범의 내 곡(흔한 이름에 아티스트마다 1곡이면 아티스트별 따로, 키 `이름\t아티스트`) · 한 연주 악장 순(번호 없는 곡은 뒤에 제목 순, 다른 연주 안 섞음) · 작곡가 목록(곡 수 순) · 작곡가의 작품 → 연주 → 곡. 앨범·연주·작곡가 응답의 `titles`는 악장 있는 곡의 줄 제목(`II. Adagio`, 여러 작품 앨범은 `· 작품`), 곡 자체 제목은 그대로 |
| GET | `/api/taste/map` · `/api/map/<파일>` · `POST /api/taste/map/tracks {ids}` | 3D 음악 지도: 있는지·곡 수 · 분석 폴더 `map/` 정적 파일(밖으로 나가는 경로 404, gzip·ETag, 없으면 404 안내) · 지도 점 곡 번호 → 지금 들을 수 있는 곡(순서대로, 모르는 곡·지워진 영상 빠짐) |

원작 API(검색, 재생목록 만들기·넣기·빼기, 즐겨찾기, 스트림)는 README의 API 표.
웹 경로: `/play/:id`(곡·묶음 바로 재생), `/list/:pid`(재생목록 처음부터), `/library/box`(곡 상자, `?filter=untagged`·`?filter=blocked`(치워 둔 곡)·`?filter=changes`(변경 기록)·`?source=kind:ref`·`?tag=`), `/library/stats`(내 기록, `?period=4w|6m|all`·`&day=YYYY-MM-DD`), `/library/genres`(장르 → 소리 묶음), `/library/mixes`(자동 재생목록), `/library/radio/:id`(닮은 곡 라디오 목록), `/library/albums/:key`(내 곡 앨범), `/library/performances/:key`(한 연주), `/library/composers?genre=`(작곡가 목록, 장르 화면 「작곡가별」) · `/library/composers/:name`, `/library/map`(3D 음악 지도, `#v=<곡 번호>`로 그 곡 고르기), `/settings`(설정 열기, 구글 로그인 뒤 `?google=connected|error`로 돌아오는 곳).
