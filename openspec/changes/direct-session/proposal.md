# Proposal: 유튜브 직접 질문이 막히지 않게 (direct-session)

## Why

#26 fast-first-play를 올린 뒤 운영에서 처음 누른 곡이 다시 5초쯤 걸렸다. 프리미엄 찾기가 곡 상자 3,389곡을 4곡씩 빠르게 물었더니, 유튜브가 그 세션에 400–1,000번째 질문부터 틀 수 있는 곡도 「이 콘텐츠는 이용할 수 없습니다. 나중에 다시 시도해 주세요」로 막았다(같은 IP의 새 세션은 바로 됨). 재생도 같은 세션을 써서 직접 질문이 막히고 yt-dlp(5초)로 넘어갔다. 또 세션이 한국어라 「Music Premium members」라는 영어 문구로 프리미엄을 알아보지 못했다.

## What Changes

- 소리 주소 직접 질문은 영어 세션으로 한다(이유 문구를 영어로 맞춰 알아봄). 화면용 한국어 세션과도 나뉜다.
- 직접 질문이 프리미엄 말고 다른 이유로 거절하면, 공용 세션을 새로 만들어 한 번 더 묻고 그래도 안 되면 yt-dlp로 간다. 막힌 세션이 스스로 풀린다.
- 프리미엄 찾기는 자기 세션을 따로 쓰고 150곡마다 새로 만들며, 한 곡씩 0.25초 쉬어 가며 묻는다(전체 15–20분).

## Capabilities

### Modified Capabilities

- `youtube-stream`: 직접 질문은 영어 세션, 거절되면 새 세션으로 한 번 더.
- `song-box`: 프리미엄 찾기는 따로 세션, 천천히.

## Impact

- 서버: `search.ts`(`ownSession`, `dropSession`), `directAudio.ts`(`PREMIUM_ONLY`, 새 세션으로 다시 묻기, `session` 인자), `ytdlp.ts`(영어, `premiumOnly(id, session)`), `standIn.ts`(`findPremiumOnly` 천천히).
