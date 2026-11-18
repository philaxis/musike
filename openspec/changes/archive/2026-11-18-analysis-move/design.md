# Design: 음악지도 분석을 Musike 안으로

## 원칙
Musike 서버는 분석을 모른다. 작업자는 서버 API로 곡을 읽고, 결과 폴더에 파일을 쓰기만 한다. 서버는 그 파일이 없거나 깨져도 그대로 돈다(계약). 작업자가 실패하면 결과 파일은 지난 판 그대로 남는다(쓰기는 맨 끝에, 원자적으로).

## 1. 곡 후보
- `GET /api/box?cursor=N`(200곡씩, `next`가 null이면 끝). 곡 상자는 내 폴더 곡을 `local` 출처로 함께 보여 주고(가상으로 나눈 앨범 곡 포함, 숨긴 곡·숨긴 뿌리 제외), 유튜브 곡은 재생목록·좋아요 출처를 가진다. 이것 하나로 후보가 다 모여서 서버에 새 API를 더하지 않았다.
- 뺀다: 묶음 줄, 번호 모양이 맞지 않는 줄, 제목이 `Deleted video`/`Private video`인 줄.
- 「음악으로 친다」 = 재생목록이나 내 폴더 출처가 있는 곡. 좋아요에만 있는 영상은 카드의 `is_music`이 판정한다.

## 2. 곡 카드
- 캐시 `<작업>/cards/<곡 번호>.json`. 음악지도 카드 4,014장을 옮기면서 열쇠 `videoId`를 `id`로 바꿨다(한 번 옮기기, 레포에 남기지 않음).
- 새 곡만 Gemini `gemini-3.5-flash-lite`, 20곡씩, 동시 4. 입력은 번호·종류(youtube/file)·제목·아티스트·앨범·연도·길이·재생목록/폴더 이름. 프롬프트는 "모르면 null".
- 한 번 실행 비용 상한(`--max-cost`, 기본 $1)을 넘거나 크레딧이 없으면(402) 멈추고, 음악으로 치는 곡은 제목·아티스트로 만든 최소 카드(`_minimal`, 장르 기타)를 둔다. 다음 실행에서 다시 시도한다. 누적 비용은 `<작업>/costs.json`.

## 3. 글 벡터
- 글 = `passage: ` + 카드 설명·장르·하위장르·시대·아티스트·작곡가·분위기(음악지도 검색 색인과 같은 글).
- 모델: `Xenova/multilingual-e5-small`의 `onnx/model_quantized.onnx`를 onnxruntime으로(평균 풀링 + L2 정규화). 브라우저(transformers.js q8)와 같은 파일이라 지도 검색 질의 벡터와 같은 공간이다. 첫 판 text.f32(int8 저장본)와 코사인 0.996.
- 캐시 `<작업>/text.parquet`(번호, 벡터, 글 해시). 글이 바뀐 곡만 다시.

## 4. 소리 벡터
- 30초 조각 `<작업>/clips/<번호>.opus`(24kHz 모노 48kbps). 음악지도 조각 3,100개(593MB)를 하드로 복사하고 sha256을 모두 맞춘 뒤 SSD 쪽을 지웠다. 음악지도 유닛이 아직 돌기 때문에 `~/.local/share/music-map/audio`는 하드 `clips/`를 가리키는 심볼릭 링크로 남겼다(유닛을 끌 때 지운다).
- 유튜브: yt-dlp(PATH, 매일 갱신되는 것)로 길이의 35% 지점 30초 구간만 받기 → 안 되면 전체를 받아 ffmpeg로 자르기. 요청 사이 1.5초, 동시 2.
- 내 파일: `POST /api/prepare/<번호>`로 길이와 `audioMode`를 묻고, `GET /api/stream/<번호>/audio`에서 곡 가운데 30초. `offset`(가상 분할 곡·영상 파일)은 서버가 `?t=`부터 잘라 주므로 `?t=<시작>`, `range`(보통 소리 파일)는 ffmpeg가 범위 요청으로 건너뛴다. 이 PC 서버라 동시 3. 원본 파일 경로는 몰라도 된다.
- 실패는 `<작업>/clips_failed.json`에 사유와 함께. 다시 안 될 사유(삭제·비공개·저작권·지역·멤버십·연령)는 다시 받지 않고, 그 밖은 7일 뒤 다시(`--retry-failed`로 모두 다시).
- 모델 `OpenMuQ/MuQ-MuLan-large`(GPU 있으면 GPU), 4곡씩. 캐시 `<작업>/audio.parquet`(음악지도 2,578곡 벡터를 그대로 옮김). CLAP 대체는 없앴다(계약이 MuQ-MuLan 하나).

## 5. 큰 갈래와 소리 묶음
- 큰 갈래 = 카드 장르, 25곡 미만 장르는 `기타`.
- 갈래마다 소리 벡터가 있는 곡을 k-means(정규화 벡터, k = round(소리 있는 곡/150), 1~8, seed 42). 소리 벡터 없는 곡은 글 벡터 중심이 가장 가까운 묶음에. 25곡 미만 묶음은 `<갈래>·etc`(「그 밖의 <갈래>」)로 모은다.
- 번호는 크기 순 `<갈래>·1…`. 이름 = 하위장르 상위 2개(띄어쓰기 없앤 글자로 셈) `재즈퓨전 · 모던재즈`, 하위장르가 없으면 갈래 이름. 이름이 겹치면 각 묶음의 대표 아티스트를 괄호로 붙인다.
- 유지: `<작업>/groups.json`에 묶음 목록(번호·갈래·이름)과 곡별 배정을 둔다. 다음 실행에서 배정이 있고 갈래가 같은 곡은 그대로, 새 곡(또는 갈래가 바뀐 곡)은 그 갈래 묶음 중 소리 중심(없으면 글 중심)이 가장 가까운 곳에. 이름도 그대로. 그 갈래에 배정된 곡이 하나도 없을 때(새 갈래)만 그 갈래를 새로 나눈다. `--regroup`은 전부 새로.

## 6. 작곡가·작품·앨범·악장·연주
곡에서 작곡가·앨범으로 가고, 「이 악장이 든 작품의 이 연주 전체」를 한 번에 고르기 위한 값(계약 `composer`·`work`·`album`·`movement`·`instance`). 전체 곡을 한꺼번에 보고 정한다.
- 작곡가: 같은 성에서 이름이 맞는 표기(약자·앞부분·거의 같은 철자: `J. Brahms`·`Johannes Brahms`, `Sergey Rachmaninov`·`Sergei Rachmaninoff`)를 묶고, 첫 이름을 다 쓴 가장 흔한 표기를 대표로. 성만 쓴 표기(`Brahms`)는 그 성의 사람이 하나뿐이고 2곡 이상일 때만 붙인다. 이름이 다르면(`Yugo Kanno`/`Yoko Kanno`, `C.P.E. Bach`/`J.S. Bach`) 따로 둔다. 여러 사람(`A & B`)은 그대로.
- 작품(클래식 곡만): `Op 78`·`Op.78` → `Op. 78`, `No 1` → `No. 1`, `B-Flat Major` → `B-flat major`, 앞의 `작곡가: `와 뒤에 붙은 악장(`: No. 1, …`)은 뗀다. 같은 작곡가에서 같은 작품 번호(Op./BWV/K./RV/HWV/D./L./CD/FP/M./S./T. …)이고 조성이 어긋나지 않으면 같은 작품, 번호 없는 짧은 표기(`Piano Concerto No. 2`)가 번호 있는 작품 하나로만 이어지면 그쪽으로. 대표는 가장 흔한(같으면 긴) 표기.
- 앨범: 내 파일은 파일 태그·폴더 앨범, 유튜브는 카드 앨범(없으면 null). 클래식이 아니어도 채운다.
- 악장(작품이 있을 때만): 제목 끝 `II. Adagio`, `: 2. …`, `: No. 4 …`, `: Variation 14`에서 번호·이름. 이름의 잘린 괄호와 `(Live …)`·`(Remastered …)` 꼬리는 뗀다.
- 연주 `instance` = `작곡가 | 작품 | 주 연주자(아티스트 첫 사람) | 앨범`. 앨범이 빠진 곡은 같은 작곡가·작품·연주자의 앨범이 하나뿐이면 그 앨범으로. 작품이 없으면 null.

## 7. 결과
- `taste.json`·`audio.f32`·`text.f32`: 계약 그대로. 곡 순서는 곡 상자 순서, 음악 아닌 곡·카드 없는 곡은 뺀다. 벡터는 L2 정규화. 셋을 임시 파일에 다 쓴 다음 audio → text → taste.json 순으로 rename(서버는 taste.json mtime으로 다시 읽음).
- `map/`: 큰 군집 = 큰 갈래, 세부 군집 = 소리 묶음. `index.html`(음악지도 템플릿 그대로, 데이터 인라인), `map_points.json`(점마다 `src`: youtube/local 추가), 브라우저 검색 `search_meta.json`·`vectors_e5.bin`(글 벡터 int8), 소리 검색 `sound_concepts_index.json`·`vectors_e5_concepts.bin`·`sound_concepts_meta.json`, `api/songs.json`·`neighbors.json`·`status.json`·`sound_concepts.json`. Musike 화면에 붙이는 일은 다음 단계.
- 실행 결과 요약 `<작업>/state.json`(`python -m musike_analysis status`).

## 8. 실행
- `analysis/`에서 `uv sync` 후 `uv run python -m musike_analysis update [--max-cost 1] [--no-audio] [--no-map] [--regroup] [--retry-failed] [--fetch-limit N]`.
- 설정은 환경 변수: `MUSIKE_URL`(기본 `http://127.0.0.1:4180`), `MUSIKE_ANALYSIS_DIR`(결과), `MUSIKE_ANALYSIS_WORK`(원본, 기본 하드). 작업 폴더의 부모가 없으면(하드가 안 붙음) 아무것도 쓰지 않고 멈춘다. Gemini 키는 `~/.config/book-db/gemini.key` 파일에서만.
- 동시 실행은 `<작업>/update.lock`(flock)이 막는다(종료 코드 75).
- systemd user: `musike-analysis.service`(oneshot, Nice 10, IO idle) + `musike-analysis.timer`(매일 06:50, Persistent). 설치 `deploy/systemd/install.sh`(유닛 복사, `uv sync`, 타이머 켜기). 첫 실행 뒤 매일 새 곡만이라 몇 분.
- 음악지도 끄기(통합 때): `systemctl --user disable --now music-map-watch.timer music-map-serve.service`, 그 뒤 `~/.local/share/music-map/audio` 링크 지우기.

## 위험
- 운영 서버에서 조각을 받는다 → 하루 새 곡 몇 개뿐, 첫 실행만 약 1,000곡(곡당 1초 안팎).
- Gemini 카드가 틀릴 수 있다(장르·작곡가) → 정규화는 표기만 묶고 새 사실을 만들지 않는다. 틀린 카드는 파일을 지우면 다음 실행에서 다시 만든다.
- 유튜브가 봇 확인을 걸면 조각이 실패한다 → 7일 뒤 다시, 그동안 그 곡은 글 벡터만으로 묶음에 들어간다.
