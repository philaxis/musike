# Proposal: 두 장짜리 앨범이 「CD 1」「CD 2」로만 보이는 문제

## Why

11-18 「카시오페아 곡별」(D드라이브 백업의 곡별 앨범 폴더)을 내 음악에 넣자, 앨범 폴더 안에 `CD 1`, `CD 2` 폴더가 있는 앨범(Perfect, Live II · Asian Dreamer · Super Best)이 앨범 이름 없이 「CD 1」「CD 2」로 보였다.

## What Changes

- 앨범 폴더 이름이 `CD n`·`Disc n`·`Disk n`이면 그 위 폴더 이름을 앨범 이름으로 쓰고 뒤에 「(CD n)」을 붙인다. 연도도 위 폴더에서 읽는다.

## Capabilities

### New Capabilities

(없음)

### Modified Capabilities

- `local-library`: 디스크 폴더 이름 규칙.

## Impact

- `server/src/localNames.ts`(`albumFolderName`), `server/src/local.ts`
