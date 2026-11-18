# Tasks

- [x] 1.1 서버: `hidden.ts`(곡·뿌리 숨김 목록, `data/hidden.json` 임시 파일→바꿔 넣기, 한 번에 하나씩 쓰기) — 확인: `pnpm --filter ./server test` 35개 통과(`test/hidden.test.ts`: 저장·다시 읽기·겹친 쓰기·깨진 파일·요청 모양·목록 거르기)
- [x] 1.2 서버: 뿌리·앨범·곡 목록과 `/api/local` 찾기에서 숨긴 것 빼기, `?hidden=1`이면 `hidden: true`로 같이; `GET/POST/DELETE /api/local/hidden` — 확인: 4193 시험 서버 curl. RIDE ON TIME(LVSupmNJqbx3wLG03tSSa) 숨기면 앨범 61→60, 찾기 2→1, `hidden=1`에 `hidden: true`; 카시오페아 뿌리 숨기면 roots에서 빠지고 `hidden=1`에 `hidden: true`, 「mint jams」 찾기 0건; DELETE로 돌아옴. 빈 몸 400, 유튜브 번호 400, 없는 폴더 404(한국어 메시지)
- [x] 1.3 숨긴 곡은 재생목록에 그대로, 그대로 재생 — 확인: 「숨김 시험」 재생목록에 그 곡이 `unavailable` 없이 남음, `/api/stream/<id>/video` 206, `/audio` 200(40MB 받음), 브라우저에서 재생목록의 숨긴 곡을 틀어 진행 막대 14초까지 감
- [x] 1.4 웹: 곡 메뉴·앨범 카드 메뉴 「숨기기」, 뿌리 줄 메뉴 「폴더 통째로 숨기기」, 「숨긴 것 보기」 전환(흐리게 「숨김」, 「숨기기 해제」), 알림 「되돌리기」, 검색 「내 음악」 묶음에서 빠짐 — 확인: headless Chromium 390px(앨범 카드 숨기기 → 사라짐 → 전환 → 흐리게 → 해제 → 돌아옴, 되돌리기로 원래대로)와 1280px(폴더 숨기기·해제, 검색의 곡 메뉴 숨기기로 「내 음악」 2→1곡). 그림 `/tmp/local-hide-shots/`
- [x] 1.5 TV: 숨긴 것 안 보이고 전환·메뉴 없음 — 확인: `?tv=1`에서 야마시타 타츠로 앨범 60개, 전환 단추 0, 숨기기 메뉴 0
- [x] 1.6 문서: `AGENTS.md` API 표, `~/.hermes/skills/media/musike/SKILL.md` Calls에 숨기기 — 확인: `pnpm typecheck`, `pnpm build`, `openspec validate local-hide --strict` 통과
