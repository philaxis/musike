# Tasks

## 1. 스펙
- [x] 1.1 proposal·design·스펙 — 확인: `openspec validate analysis-move --strict`

## 2. 옮기기(데이터)
- [x] 2.1 기존 결과 백업 `/tmp/analysis-before/` — 확인: taste.json·audio.f32·text.f32 3개
- [x] 2.2 음악지도 30초 조각 3,100개(593MB) 하드 `/mnt/backup8t/orca-data/musike/analysis/clips/`로 복사 → sha256 3,100줄 모두 같음 → SSD 쪽 지우고 링크(음악지도 유닛이 아직 돌아서) — 확인: `du -sh ~/.local/share/music-map` 253M
- [x] 2.3 카드 4,014장(`videoId`→`id`), 소리 벡터 2,578곡, 실패 목록 369개, 비용 기록을 작업 폴더로 — 한 번 옮기기 스크립트(레포에 안 남김)

## 3. 분석 패키지 `analysis/`
- [x] 3.1 곡 후보(`/api/box` 페이지 넘기기), 카드(Gemini, 상한·최소 카드), 글 벡터(e5-small ONNX q8) — 확인: 첫 판 text.f32와 코사인 0.996
- [x] 3.2 소리 조각(유튜브 yt-dlp, 내 파일 Musike 소리 주소 `?t=`)·MuQ-MuLan — 확인: 타츠로 나눈 곡(offset)·카시오페아(range)·유튜브 각 1곡 조각 30.0초
- [x] 3.3 큰 갈래·소리 묶음(유지), 작곡가·작품·앨범·악장·연주 정규화 — 확인: `uv run --group dev pytest`
- [x] 3.4 taste.json·f32 원자적 쓰기, 소리 검색 색인, 3D 지도(`map/`)
- [x] 3.5 systemd 유닛 초안·설치 스크립트 `deploy/systemd/`

## 4. 첫 전체 실행
- [x] 4.1 `uv run python -m musike_analysis update --max-cost 1` — 확인(11-18): 첫 실행 15분 46초, 곡 4,405(내 파일 987: 타츠로 511·카시오페아 곡별 476), 소리 벡터 4,109, 글 벡터 4,405, 묶음 30개, Gemini $0.1196(카드 1,022장). 곧바로 다시 실행: 67초, 새 카드 0, 묶음 번호·이름·배정 바뀐 곡 0, 소리 벡터 4,112(지웠던 조각 3개 다시)

## 5. 통합 때(이 PR 밖)
- [ ] 5.1 본 저장소 갱신 뒤 `deploy/systemd/install.sh`
- [ ] 5.2 음악지도 끄기: `systemctl --user disable --now music-map-watch.timer music-map-serve.service`, `rm ~/.local/share/music-map/audio`(링크)
