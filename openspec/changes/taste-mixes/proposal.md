# Proposal: 장르 묶음과 자동 재생목록

## Why

사용자 11-18(#26): 따로 돌던 「음악지도」 분석(곡마다 장르·분위기·소리 벡터)을 Musike 안에서 쓰고 싶다. 곡 상자 3천여 곡을 장르·소리 묶음으로 둘러보고, 들은 기록과 취향으로 재생목록이 저절로 만들어지기를 원한다. 사용자가 고른 기준: 두 곡의 닮음은 소리와 설명 반반, AI 호출 없이 서버가 바로 계산.

## What Changes

- 서버가 분석 결과 폴더(`MUSIKE_ANALYSIS_DIR`, 기본 `~/.local/share/musike/analysis`)의 `taste.json`·`audio.f32`·`text.f32`를 읽어 메모리에 둔다. 파일이 바뀌면 다시 읽고, 없거나 깨지면 취향 기능만 빈다.
- 보관함에 「장르」 칸: 큰 갈래 → 갈래 안 소리 묶음 카드 → 묶음 곡 목록.
- 보관함에 「자동 재생목록」 칸: 데일리 믹스 3~5개, 요즘 반복, 잊고 있던 애창곡, 새로 들어온 곡 중 내 취향, 신나는 곡, 잔잔한 곡. 누르면 곡 목록(전체 재생·고르기·재생목록에 저장).
- 곡 메뉴·지금 재생의 「이 곡으로 라디오」: 분석된 곡이면 닮은 곡 라디오(다양성 MMR, 같은 아티스트 2곡까지, 25곡), 아니면 예전처럼 유튜브 라디오.
- 「한 번 들음」 규칙과 들은 기록 읽기는 `plays.ts`(`isListen`, `loadPlays`) 한곳에, 분석 폴더 읽기는 `taste.ts` 한곳에 둔다. 「내 기록」(stats.ts)도 이것을 쓴다(장르는 `loadTaste`로).

## Capabilities

### New Capabilities

- `taste-mixes`: 분석 결과 읽기, 장르 묶음 보기, 자동 재생목록, 닮은 곡 라디오.

## Impact

- 서버: `server/src/taste.ts`(새, 읽기·닮음·라디오), `server/src/mixes.ts`(새, 자동 재생목록), `server/src/tasteRoutes.ts`(새, API), `server/src/plays.ts`(`isListen`·`loadPlays`를 stats.ts에서 옮김), `server/src/stats.ts`(자기 로그·taste.json 읽기 대신 위 둘, `dayLikeIds`), `server/src/config.ts`(`analysisDir`), `server/src/app.ts`.
- 웹: `web/src/views/TasteGenres.tsx`·`TasteGroup.tsx`·`Mixes.tsx`(새), `web/src/views/Library.tsx`, `web/src/lib/server.ts`, `web/src/lib/routes.ts`, `web/src/App.tsx`, `web/src/player/player.ts`(라디오), `web/src/components/TrackMenu.tsx`, i18n 세 곳.
- 데이터: 읽기만(`analysis/`, `data/plays.jsonl`, `data/daylikes.json`, `box.json`). 새로 쓰는 파일 없음.
- API: `GET /api/taste/genres`, `/api/taste/genres/:genre`, `/api/taste/groups/:gid`, `/api/taste/radio/:id`, `/api/taste/mixes`, `/api/taste/mixes/:mid`.
