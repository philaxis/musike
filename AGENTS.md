# philaxis/musike (서버판 Musike)

[Ernani1234/musike](https://github.com/Ernani1234/musike)(MIT)를 포크해 리눅스 서버에서 혼자 쓰는 판. 원작 동기화는 `upstream` 리모트. 서버판 변경은 새 파일 위주로 두고 원작 파일은 짧게 고친다.

## 스펙
- OpenSpec: `openspec/`. 서버판 전체 그림은 `openspec/changes/server-library/design.md`(archive 뒤에는 `openspec/specs/*`).
- 역할: 서버 = 곡·재생목록 원본, 헤르메스(텔레그램) = 말로 정리만, 폰·노트북·TV = 각자 재생. 어떤 기기도 다른 기기를 조종하지 않는다. TV는 틀기만(정리 기능 숨김).

## 운영
- 서비스: `systemctl --user {status,restart} musike` (`~/.config/systemd/user/musike.service`, `pnpm start`, :4180, 0.0.0.0).
- 주소: Tailscale `https://philaxis-b760m-aorus-elite.taildeaa80.ts.net:4443`(PWA, `tailscale serve --https=4443`), 집 안 `http://192.168.0.43:4180`(TV, `?tv=1`).
- 데이터: `~/.local/share/musike/data`(`library.json`, `local-index.json`, `backups/`). 캐시·받아 둔 곡: `/mnt/backup8t/orca-data/musike/{cache,keep}`(HDD).
- 내 음악 폴더(`MUSIKE_LOCAL_DIRS`, 읽기 전용, 절대 쓰지 않음): `/mnt/backup8t/gdrive/current/MUSICS/{야마시타 타츠로,카시오페아}`(구글 드라이브 사본), `~/보관함/유튜브`(yt-bulk).
- yt-dlp: `uv tool`로 설치, `yt-dlp-update.timer`가 매일 업데이트.
- 헤르메스 기술: `~/.hermes/skills/media/musike/SKILL.md`(API 표와 답장 모양). API를 바꾸면 같이 고친다.

## 개발
- `pnpm install`, `pnpm typecheck`, `pnpm --filter ./server test`, `pnpm build`(웹), 시험 서버는 `PORT=4190 HOST=127.0.0.1 MUSIKE_DATA_DIR=/tmp/… pnpm start`.

## API (서버판에서 더한 것)
| 메서드 | 경로 | 하는 일 |
|---|---|---|
| GET | `/api/local/roots` | 내 음악 뿌리와 곡 수, 읽을 수 있는지 (숨긴 뿌리 빠짐, `?hidden=1`이면 `hidden: true`로 같이) |
| GET | `/api/local/albums?root=` · `/api/local/album?root=&key=` | 앨범 목록 · 앨범 곡 (숨긴 곡 빠짐, `&hidden=1`이면 같이) |
| GET | `/api/local?q=&root=&limit=` | 내 음악에서 찾기 (숨긴 곡 빠짐, `&hidden=1`이면 같이) |
| GET/POST/DELETE | `/api/local/hidden` · `{ids?, root?}` | 숨긴 것 `{ids, roots}` · 곡/뿌리 숨기기 · 숨기기 해제 (`data/hidden.json`, 파일은 그대로, 재생목록 곡은 그대로 재생) |
| POST | `/api/local/rescan` | 폴더 다시 읽기 |
| GET | `/api/local/:id/cover` | 표지 |
| GET | `/api/track/:id` | 곡 하나(로컬·유튜브) |
| PUT | `/api/playlists/:pid/tracks` `{ids}` | 순서 통째로 바꾸기(지금 곡 번호의 순열만) |
| GET/POST | `/api/import/youtube/preview?url=` · `/api/import/youtube {url,name?}` | 유튜브 재생목록 미리 보기 · 가져오기 |
| GET/POST/DELETE | `/api/keep` · `/api/keep/:id` | 유튜브 곡 서버에 받아 두기 |

원작 API(검색, 재생목록 만들기·넣기·빼기, 즐겨찾기, 스트림)는 README의 API 표.
웹 경로: `/play/:id`(곡 바로 재생), `/list/:pid`(재생목록 처음부터).
