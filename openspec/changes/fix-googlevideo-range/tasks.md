# Tasks

- [x] 1.1 `proxyStream`이 403이면 같은 주소로 0.5초 간격, 최대 8초 다시 묻기 — 확인: `pnpm typecheck` 통과
- [x] 1.2 처음 트는 곡 3개가 서버에서 206으로 오고 소리 파일로 읽힘, 중간 구간 길이가 맞음 — 확인: curl + ffprobe. 고친 서버: fJ9rUzIMcZQ·hTWKbfoikeg·9bZkp7q19f0 모두 206, 길이 359·278초로 읽힘, `bytes=1000000-1099999`는 206·100000바이트. 고치기 전 서버는 처음 트는 kJQP7kiw5Fk에 502
- [x] 1.3 브라우저에서 유튜브 곡이 실제로 재생됨 — 확인: 검색 → 재생 단추, 재생 시간 0:02로 움직이고 `/api/stream/O7qx1HrztTM/audio` 206
