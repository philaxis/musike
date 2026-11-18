# Proposal: 열어 둔 탭도 새 버전으로

## Why

사용자 11-18: 기능을 올렸는데 PC 파이어폭스에서 "아직 안 되는 것 같다". 서버 기록상 그 탭은 새 화면 파일을 받지 않았다. 앱 셸을 서비스 워커가 갖고 있어서 열어 둔 탭은 새로 고침하기 전까지 옛 화면을 쓴다.

## What Changes

- 열어 둔 탭이 앞으로 돌아올 때와 30분마다 새 버전을 확인한다. 재생 중이 아니면 바로 바꾸고, 재생 중이면 「Musike 새 버전이 나왔어요 · 새로 고침」 알림을 띄워 곡을 끊지 않는다.

## Capabilities

### New Capabilities

(없음)

### Modified Capabilities

- `player-basics`: 새 버전 받기.

## Impact

- `web/vite.config.ts`(registerType prompt), `web/src/main.tsx`, i18n
