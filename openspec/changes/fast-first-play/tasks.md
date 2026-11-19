## 1. 소리 주소 직접 먼저
- [x] 1.1 `ytdlp.ts` `resolveAudio`: 직접 질문 먼저, 프리미엄은 바로 못 틈, 그 밖은 yt-dlp
- [x] 1.2 `stream.ts`·`app.ts` 소리는 `resolveAudio`
## 2. 프리미엄 미리 찾기
- [x] 2.1 `directAudio.ts` `premiumOnly`, `standIn.ts` `findPremiumOnly`(네 곡씩), `box.ts` `premiumCheckedAt`
- [x] 2.2 시작 때(하루 한 번)·`checkBox` 뒤 실행, 그다음 `fixAside`
## 3. 확인
- [x] 3.1 시험, 운영 자료 사본으로 처음 누른 곡 시간·프리미엄 찾기 결과
