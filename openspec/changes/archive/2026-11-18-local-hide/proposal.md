# Proposal: 내 음악 숨기기·숨기기 해제

## Why

이슈 #8(사용자 11-18): 통째로 합친 앨범 mp4(한 파일 = 앨범 하나)가 있는 폴더에 곡마다 나눈 앨범을 더 넣으면, 「내 음악」에 같은 앨범이 두 번 보인다. 합친 파일은 지우지 않고 그대로 두되 목록에서는 안 보이게 하고 싶고, 마음이 바뀌면 다시 보이게 할 수 있어야 한다.

## What Changes

- 곡(파일) 하나 또는 뿌리 폴더 통째로 숨길 수 있다. 숨긴 목록은 서버 데이터 폴더의 `hidden.json`에 둔다(임시 파일에 쓰고 바꿔 넣기). 음악 폴더는 건드리지 않는다.
- 숨긴 것은 「내 음악」 뿌리·앨범·곡 목록, `/api/local?q=` 찾기, 웹 검색의 「내 음악」 묶음에서 빠진다. `?hidden=1`을 붙이면 함께 오고 `hidden: true`가 붙는다.
- 재생목록·즐겨찾기·최근 재생·대기열의 숨긴 곡은 그대로 있고 그대로 재생된다(「파일 없음」으로 보지 않는다).
- API: `GET /api/local/hidden` → `{ ids, roots }`, `POST`·`DELETE /api/local/hidden` `{ ids?, root? }`.
- 웹(폰·노트북): 곡 메뉴와 앨범 카드 메뉴에 「숨기기」, 뿌리 줄 메뉴에 「폴더 통째로 숨기기」, 「내 음악」에 「숨긴 것 보기」 전환. 켜면 숨긴 것이 흐리게 보이고 「숨기기 해제」가 된다. 숨긴 뒤 알림에 「되돌리기」.
- TV: 숨긴 것은 보이지 않고 전환·메뉴도 없다.

## Capabilities

### New Capabilities

(없음)

### Modified Capabilities

- `local-library`: 숨기기·숨기기 해제 요구를 더한다.

## Impact

- 서버: `server/src/hidden.ts`(새), `local.ts`, `serverRoutes.ts`, `types.ts`, `i18n.ts`, `test/hidden.test.ts`(새)
- 웹: `components/HideControls.tsx`(새), `LocalRoots.tsx`, `LocalResults.tsx`, `TrackList.tsx`, `TrackMenu.tsx`, `views/LocalRoot.tsx`, `views/LocalAlbum.tsx`, `stores/local.ts`, `lib/server.ts`, `lib/types.ts`, `i18n/{ko,en,pt}.ts`
- 문서: `AGENTS.md` API 표, 헤르메스 기술 `~/.hermes/skills/media/musike/SKILL.md`
