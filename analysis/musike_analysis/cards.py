"""곡 카드(Gemini, 20곡씩 한 번 호출). 곡 번호마다 캐시하고 새 곡만 부른다.

카드 캐시: <작업 폴더>/cards/<곡 번호>.json
입력(제목·아티스트·앨범·연도·출처)에 있는 사실만 쓰고 모르면 null 이라고 프롬프트에 적는다.
재생목록이나 내 폴더에 든 곡은 음악으로 친다. Gemini 를 못 쓰면(키 없음·크레딧 없음·상한) 그 곡은 제목·아티스트로 만든
최소 카드(`_minimal`)를 두고 다음 실행에서 다시 시도한다.
"""

from __future__ import annotations

import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import budget
from .config import CARD_DIR, read_key
from .util import atomic_write_json, clean, load_json, log, now_iso

MODEL = "gemini-3.5-flash-lite"
PRICE_INPUT_PER_M = 0.10
PRICE_OUTPUT_PER_M = 0.40
BATCH = 20
WORKERS = 4
GENRES = ["클래식", "재즈", "팝", "록", "일렉트로닉", "힙합/R&B", "월드/라틴", "게임/영화음악", "J-pop/시티팝", "K-pop", "기타"]
SCORE_KEYS = ("energy", "valence", "acoustic", "vocal")

INSTRUCTIONS = """너는 음악 사서(cataloger)다. 아래 곡 메타데이터로 곡 카드를 만든다.
곡은 유튜브 영상(kind=youtube, artist 는 올린 채널일 수 있음)이거나 내 음악 파일(kind=file, 폴더·태그에서 읽은 제목·아티스트·앨범)이다.

규칙:
- 입력(제목·아티스트·앨범·연도·재생목록/폴더 이름)에 있는 사실을 우선하고, 널리 알려진 곡·앨범이면 그 사실을 써도 된다. 모르는 값은 반드시 null 로 두고 지어내지 않는다.
- 채널 이름이 '… - Topic' 이면 '- Topic' 앞이 아티스트다.
- 재생목록이나 폴더에 없는 유튜브 영상은 음악이 아닐 수 있다. 제목·채널만 보고 is_music 을 판정한다.
- genre 는 다음 중 하나: 클래식, 재즈, 팝, 록, 일렉트로닉, 힙합/R&B, 월드/라틴, 게임/영화음악, J-pop/시티팝, K-pop, 기타
- era 는 '바로크', '낭만', '1970년대', '2010년대'처럼 시대를 짧게. year 는 발표/녹음 연도(4자리 정수, 모르면 null).
- scores 는 1~5 정수: energy(낮음1~높음5), valence(어두움1~밝음5), acoustic(전자1~어쿠스틱5), vocal(연주곡1~보컬5). 모르면 null.
- instruments·moods 는 짧은 한국어 단어 배열. moods 는 3~5개.
- card_text 는 한국어 2~4문장. 장르·시대·분위기·편성·누구의 무엇인지 설명한다. 없는 사실을 만들지 않는다.
- title 은 실제 곡명, artist 는 연주자/가수, composer 는 작곡가, work 는 클래식 작품명, album 은 앨범명.

응답은 아래 모양의 JSON 하나만:
{"cards":[{"id":"...", "is_music":true, "title":"...", "artist":"...", "composer":null, "work":null, "album":null, "year":1956, "genre":"재즈", "subgenre":"하드 밥", "era":"1950년대", "region":"미국", "instruments":["피아노","베이스","드럼"], "moods":["따뜻함","느긋함","스윙"], "scores":{"energy":3,"valence":4,"acoustic":4,"vocal":1}, "card_text":"..."}]}
"""


def _payload(song: dict) -> dict:
    return {
        "id": song["id"],
        "kind": "file" if song["source"] == "local" else "youtube",
        "title": song.get("title") or None,
        "artist": song.get("artist") or None,
        "album": song.get("album"),
        "year": song.get("year"),
        "durationSec": round(song.get("duration") or 0) or None,
        "playlists": song.get("playlists") or [],
        "liked": bool(song.get("liked")),
    }


def build_prompt(batch: list[dict]) -> str:
    return INSTRUCTIONS + "\n\n입력:\n" + json.dumps({"songs": [_payload(s) for s in batch]}, ensure_ascii=False)


def parse_cards(text: str) -> list[dict]:
    """모델 응답에서 카드 배열을 꺼낸다. 코드펜스·앞뒤 잡음 허용."""
    body = re.sub(r"\s*```$", "", re.sub(r"^```(?:json)?\s*", "", (text or "").strip()))
    candidates = [body]
    for opener, closer in (("[", "]"), ("{", "}")):
        start, end = body.find(opener), body.rfind(closer)
        if start >= 0 and end > start:
            candidates.append(body[start : end + 1])
    for candidate in candidates:
        try:
            obj = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, list):
            return [x for x in obj if isinstance(x, dict)]
        if isinstance(obj, dict):
            if isinstance(obj.get("cards"), list):
                return [x for x in obj["cards"] if isinstance(x, dict)]
            if obj.get("id"):
                return [obj]
    return []


def _text_or_none(value) -> str | None:
    return clean(value) or None


GENRE_ALIASES = {
    "classical": "클래식", "jazz": "재즈", "pop": "팝", "rock": "록", "metal": "록", "electronic": "일렉트로닉",
    "hip hop": "힙합/R&B", "hip-hop": "힙합/R&B", "r&b": "힙합/R&B", "world": "월드/라틴", "latin": "월드/라틴",
    "soundtrack": "게임/영화음악", "game": "게임/영화음악", "city pop": "J-pop/시티팝", "j-pop": "J-pop/시티팝", "k-pop": "K-pop",
}


def _genre(value) -> str:
    text = clean(value)
    if text in GENRES:
        return text
    low = text.lower()
    for genre in GENRES:
        if genre != "기타" and text and (genre.lower() in low or low in genre.lower()):
            return genre
    for key, val in GENRE_ALIASES.items():
        if key in low:
            return val
    return "기타"


def _year(value) -> int | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        year = int(value)
        return year if 1000 <= year <= 2030 else None
    match = re.search(r"(1[0-9]{3}|20[0-2][0-9])", clean(value))
    return int(match.group(1)) if match else None


def _score(value):
    try:
        return max(1, min(5, int(round(float(value)))))
    except (TypeError, ValueError):
        return None


def _list(value) -> list[str]:
    if isinstance(value, str):
        value = re.split(r"[,;/·]", value)
    if not isinstance(value, (list, tuple)):
        return []
    out: list[str] = []
    for item in value:
        text = clean(item)
        if text and text not in out:
            out.append(text)
    return out[:12]


def counts_as_music(song: dict) -> bool:
    """재생목록·내 폴더에 든 곡은 정의상 음악이다."""
    return bool(song.get("inPlaylist"))


def normalize_card(card: dict, song: dict) -> dict:
    scores = card.get("scores") if isinstance(card.get("scores"), dict) else {}
    is_music = bool(card.get("is_music")) if "is_music" in card else True
    return {
        "id": song["id"],
        "is_music": is_music or counts_as_music(song),
        "title": _text_or_none(card.get("title")),
        "artist": _text_or_none(card.get("artist")),
        "composer": _text_or_none(card.get("composer")),
        "work": _text_or_none(card.get("work")),
        "album": _text_or_none(card.get("album")),
        "year": _year(card.get("year")),
        "genre": _genre(card.get("genre")),
        "subgenre": _text_or_none(card.get("subgenre")),
        "era": _text_or_none(card.get("era")),
        "region": _text_or_none(card.get("region")),
        "instruments": _list(card.get("instruments")),
        "moods": _list(card.get("moods")),
        "scores": {key: _score(scores.get(key)) for key in SCORE_KEYS},
        "card_text": _text_or_none(card.get("card_text")) or "",
        "_generatedAt": now_iso(),
        "_model": MODEL,
    }


def minimal_card(song: dict) -> dict:
    """Gemini 없이 제목·아티스트만으로 만든 임시 카드. 다음 실행에서 다시 시도한다."""
    title = song.get("title") or "(제목 없음)"
    artist = re.sub(r"\s*-\s*Topic$", "", song.get("artist") or "", flags=re.IGNORECASE) or None
    text = f"{title} — {artist}" if artist else title
    if song.get("album"):
        text += f" (앨범: {song['album']})"
    return {
        "id": song["id"],
        "is_music": True,
        "title": title,
        "artist": artist,
        "composer": None,
        "work": None,
        "album": song.get("album"),
        "year": _year(song.get("year")),
        "genre": "기타",
        "subgenre": None,
        "era": None,
        "region": None,
        "instruments": [],
        "moods": [],
        "scores": {key: None for key in SCORE_KEYS},
        "card_text": text,
        "_generatedAt": now_iso(),
        "_model": "minimal",
        "_minimal": True,
    }


def card_path(song_id: str) -> Path:
    return CARD_DIR / f"{song_id}.json"


def load(song_id: str) -> dict | None:
    data = load_json(card_path(song_id))
    return data if isinstance(data, dict) and data.get("id") else None


def _client():
    key = read_key()
    if not key:
        return None
    from google import genai

    return genai.Client(api_key=key)


def _call(client, batch: list[dict]) -> list[dict]:
    from google.genai import types

    resp = client.models.generate_content(
        model=MODEL,
        contents=build_prompt(batch),
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.2),
    )
    usage = resp.usage_metadata
    budget.charge(
        int(getattr(usage, "prompt_token_count", 0) or 0),
        int(getattr(usage, "candidates_token_count", 0) or 0),
        PRICE_INPUT_PER_M,
        PRICE_OUTPUT_PER_M,
        "cards",
    )
    return parse_cards(resp.text or "")


def _no_credit(exc: Exception) -> bool:
    text = str(exc)
    return "RESOURCE_EXHAUSTED" in text or "prepayment credits" in text or " 402 " in f" {text} "


def _process(client, batch: list[dict], state: dict) -> int:
    """한 묶음 호출. 응답에 빠진 곡은 곡별로 한 번만 더 부른다(무한 재시도 없음). 저장한 곡 수."""
    by_id: dict[str, dict] = {}
    todo = [batch] + [[s] for s in batch]
    for i, part in enumerate(todo):
        if i and part[0]["id"] in by_id:
            continue
        if state.get("stop"):
            break
        budget.check()
        try:
            for card in _call(client, part):
                cid = clean(card.get("id"))
                if cid:
                    by_id[cid] = card
        except budget.BudgetExceeded:
            raise
        except Exception as exc:  # noqa: BLE001 - 실패는 이 곡들만 최소 카드로 남긴다
            if _no_credit(exc):
                state["stop"] = "Gemini 크레딧 없음(402)"
                log("Gemini 크레딧 없음(402) → 남은 곡은 부르지 않습니다")
            else:
                log(f"카드 호출 실패({type(exc).__name__}: {str(exc)[:200]})")
    saved = 0
    for song in batch:
        raw = by_id.get(song["id"])
        if raw:
            atomic_write_json(card_path(song["id"]), normalize_card(raw, song))
            saved += 1
    return saved


def run(songs: list[dict]) -> dict:
    """카드가 없거나 최소 카드인 곡만 Gemini 로. budget.start 로 건 상한을 따른다."""
    todo = [s for s in songs if (c := load(s["id"])) is None or c.get("_minimal")]
    stats = {"songs": len(songs), "cached": len(songs) - len(todo), "requested": len(todo), "saved": 0, "minimal": 0, "stopped": None}
    log(f"카드: 전체 {len(songs)}곡 · 캐시 {stats['cached']}곡 · 이번 {len(todo)}곡 ({MODEL}, {BATCH}곡/호출)")
    if todo:
        client = _client()
        if client is None:
            stats["stopped"] = "Gemini 키 없음"
        else:
            state: dict = {}
            batches = [todo[i : i + BATCH] for i in range(0, len(todo), BATCH)]
            lock = threading.Lock()
            try:
                with ThreadPoolExecutor(max_workers=WORKERS) as pool:
                    futures = [pool.submit(_process, client, b, state) for b in batches]
                    for done, fut in enumerate(as_completed(futures), 1):
                        with lock:
                            stats["saved"] += fut.result()
                        if done % 5 == 0 or done == len(batches):
                            log(f"카드 {done}/{len(batches)}묶음 · 저장 {stats['saved']}곡 · ${budget.spent():.3f}")
            except budget.BudgetExceeded as exc:
                log(f"비용 상한으로 카드 멈춤: {exc}")
                state["stop"] = str(exc)
            stats["stopped"] = state.get("stop")
        # 재생목록·내 폴더 곡은 최소 카드로라도 올린다. 좋아요에만 있는 영상은 음악인지 몰라 카드 없이 둔다.
        for song in todo:
            if load(song["id"]) is None and counts_as_music(song):
                atomic_write_json(card_path(song["id"]), minimal_card(song))
                stats["minimal"] += 1
        if stats["minimal"]:
            log(f"최소 카드 {stats['minimal']}곡 (다음 실행에서 다시 시도)")
    stats["costThisRun"] = round(budget.spent(), 4)
    return stats
