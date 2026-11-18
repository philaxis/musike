# Design: 내 기록과 오늘 좋음

## 규칙 (계약 #26 그대로)

- 「한 번 들음」 = `heard ≥ 30` 그리고 (`heard ≥ duration/2` 또는 `heard ≥ 240`). 길이를 모르는 곡(`duration` 0)은 30초 넘게 들으면 한 번.
- 「건너뜀」 = `end == "skipped"` 그리고 `heard < 30`.
- 날짜·시간대는 서울 시각(UTC+9, 서머타임 없음)으로 나눈다. 「오늘 좋음」의 「오늘」도 서버가 정하는 서울 날짜.

## 기간

| 기간 | 시작 |
|---|---|
| `4w` | 오늘 포함 28일(오늘−27일 0시) |
| `6m` | 오늘 포함 182일 |
| `all` | 처음부터 |

## 숫자와 목록

- 들은 시간: 기간 안 모든 줄의 `heard` 합.
- 들음: 기간 안 「한 번 들음」 수.
- 새로 알게 된 곡: 처음으로 「한 번 들음」이 된 때가 기간 안인 곡 수.
- 건너뜀 비율: 기간 안 건너뜀 줄 수 / 기간 안 줄 수.
- 달력: 날마다 들은 초와 들음 수(들은 날만 보냄). 웹이 시작일~오늘을 칸으로 그린다. `all`은 첫 기록 날부터, 화면에는 최근 53주까지.
- 시간대: 시작 시각(서울)의 시간별 들은 초 24칸.
- 많이 들은 곡·아티스트: 기간 안 들음 수 순(같으면 들은 초 순), 10개.
- 장르: 분석 결과 `taste.json`의 `songs[].genre`로 기간 안 들음을 묶음. 파일이 없거나 깨졌거나 맞는 곡이 없으면 `null` → 웹은 그 칸을 숨김.
- 요즘 반복: 최근 28일 두 번 넘게(≥2) 들은 곡, 10개. 기간이 4주면 「많이 들은 곡」과 거의 같으므로 웹은 숨긴다.
- 잊고 있던 애창곡: 전체에서 3번 이상 들었는데 마지막으로 들은 지 60일 넘은 곡, 들음 수 순 10개.

곡은 곡 상자·내 음악·보관함에서 찾고, 없으면 기록 줄(제목·아티스트·앨범)과 출처로 표지 주소를 만들어 보인다.

## 메모

`plays.jsonl`은 한 줄씩 스트림으로 읽어 (mtime, 크기)가 같으면 다시 읽지 않는다. 결과는 (mtime, 크기, 기간, 서울 날짜, taste.json mtime) 열쇠로 기억한다. `taste.json`도 mtime이 같으면 다시 읽지 않는다.

## API

| 메서드 | 경로 | 돌려줌 |
|---|---|---|
| GET | `/api/stats?period=4w\|6m\|all` | `{period, from, to, total, summary:{seconds, listens, newTracks, skipRate, lines}, days:[{date, seconds, listens}], hours:[24], topTracks, topArtists:[{name, listens, thumb}], genres:[{genre, listens}]\|null, onRepeat, forgotten}` |
| GET | `/api/stats/day/:date` | `{date, seconds, listens, tracks, liked}` (그날 「한 번 들음」 곡, 처음 들은 순; 그날 ☀ 곡) |
| GET | `/api/stats/track/:id` | `{listens, skips, lines, seconds, first, last}` (묶음은 부분 곡을 합침) |
| GET | `/api/daylikes?date=` | `{date, tracks}` (날짜 없으면 오늘) |
| PUT | `/api/daylikes/:id` body 곡 | 오늘 목록에 넣음 → `{date, tracks}` |
| DELETE | `/api/daylikes/:id?date=` | 그날(없으면 오늘) 목록에서 뺌 → `{date, tracks}` |

`data/daylikes.json`: `{"2026-11-18": [{곡, "at": ms}]}`. 곡은 보관함과 같은 모양(`sanitizeTrack`)이라 그날 목록에서 바로 재생된다. 쓰기는 임시 파일 뒤 이름 바꾸기, 한 번에 하나.

## 웹

- `stores/dayLikes.ts`: 오늘 날짜와 ☀ 곡 번호. 앱 시작과 창이 다시 보일 때 읽는다(자정을 넘긴 경우).
- ☀ 단추는 ♥ 옆, PC 아래 막대와 지금 재생(패널·폰 전체 화면)에만. 서버판에서만(안드로이드 앱 없음).
- 「이 곡 기록」은 곡 메뉴의 작은 창(`Modal`).
- 내 기록 페이지는 기존 `PageHeader`·`TrackList`·`EmptyState`를 쓴다. 곡 줄에 숫자를 붙이지 않는다.
