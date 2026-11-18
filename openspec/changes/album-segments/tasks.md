# Tasks

## 1. 구간 찾기(레포 밖 `~/scratch/tatsuro-split`)
- [x] 1.1 진행 막대 칸 → 경계 어림, 자막이 바뀌는 프레임으로 맞추기, 조용한 틈과 대조 — 확인: 61개 파일 모두 막대 칸 수 = 곡 수(합 511곡), 경계 450개 모두 자막 바뀜으로 찾음(막대 어림과 차이 최대 약 8초, 1/30초까지 맞춤). 조용한 틈이 없는 경계는 라이브·이어 붙인 판(IT'S A POPPIN' TIME, COME ALONG 1·2·3, JOY)뿐이고 나머지는 모두 틈 안
- [x] 1.2 곡마다 자막(곡 시작 + 5초)을 모은 그림에서 제목 읽기, 칸 수와 곡 수 대조 — 확인: 61개 파일 제목 수 = 곡 수, 자막 번호 = 줄 번호. 자막 자체가 틀린 7곡은 고침(Sincearly→Sincerely, あまく危な香り→あまく危険な香り 등), 끝이 잘린 자막 1곡(LOVE CAN GO THE DISTANCE(ALBUM RE)은 그대로 둠

## 2. 서버
- [x] 2.1 `segments.ts`(곡 목록 읽기·검사·저장, 가상 곡 번호), `local.ts`(앨범·찾기에 가상 곡, 통째 파일은 색인에만, 숨기기 따라감) — 확인: `test/segments.test.ts` 9개(번호·검사·저장·목록 규칙·숨기기·API), 전체 58개 통과
- [x] 2.2 가상 곡 재생(소리만, `start + t`부터 `end`까지), `prepare` `offset`·영상 없음 — 확인: 4197 시험 서버. RIDE ON TIME 3번 「Silent Screamer」 받은 소리 329.3초, 첫 소리가 파일의 619.648초와 파형이 맞음(경계 619.647, 조용한 틈 614.0–619.6 끝), 소리 시작 0.32초. `?t=120` 209.3초, `?t=9999` 1.0초, 영상 400, `prepare` `{"hasSdVideo":false,"audioMode":"offset"}`
- [x] 2.3 `GET/PUT /api/local/segments`, 다시 읽기에서 `segments.json`도 — 확인: 시험 서버 curl. PUT으로 9곡 → 앨범 9곡, 파일보다 긴 곡 400, `segments.json` 넣고 `POST /api/local/rescan` → 61파일 511곡

## 3. 웹
- [x] 3.1 서버 파일 첫 재생 전에 `prepare` 묻기 — 확인: headless Chromium. 앨범에서 3번 곡 → `prepare` 뒤 스트림, 0.14초 만에 재생, 진행 막대 2:00 클릭 → `?t=120`로 0.4초 안에 2:02부터, 5:22로 보내자 곡 끝에서 4번 「Ride On Time」 스트림으로 넘어감. 나누기 전에 만든 「통째 RIDE ON TIME」 재생목록 → 통째 파일(43:11) 재생, 「파일 없음」 아님
- [x] 3.2 화면 확인 — 확인: 390(위·아래)·1280·TV 960×540 찍기 `/tmp/album-segments-shots/`

## 4. 문서·운영
- [x] 4.1 `AGENTS.md` API 표 — 확인: `pnpm typecheck`, `pnpm --filter ./server test`(58), `pnpm build`, `openspec validate album-segments --strict` 통과
- [ ] 4.2 운영 설치: `~/scratch/tatsuro-split/segments.json`을 `~/.local/share/musike/data/`에 두고 `POST /api/local/rescan`(또는 서비스 재시작), 헤르메스 기술에 구간 API
