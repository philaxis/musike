"""결과 폴더에 taste.json · audio.f32 · text.f32 를 쓴다(계약: #26 취향 데이터 계약).

셋 다 임시 파일에 먼저 쓰고 audio → text → taste.json 순서로 rename 한다. 서버는 taste.json 의 mtime 을 보고 다시 읽으므로
taste.json 이 바뀌는 순간에는 벡터 파일이 이미 새것이다.
"""

from __future__ import annotations

import json

import numpy as np

from . import audio as audio_mod
from . import text as text_mod
from .config import OUT_DIR
from .util import now_iso, tmp_path
from .vectors import unit

VERSION = 1


def _scores(card: dict) -> dict | None:
    s = card.get("scores") or {}
    return s if any(v is not None for v in s.values()) else None


def build(order: list[str], cards: dict, extra: dict, genre: dict, group: dict, groups: list[dict], audio: dict, text: dict):
    """(taste dict, audio 행렬, text 행렬). order = 곡 순서, extra = catalog.annotate 결과(곡 번호별)."""
    songs, a_rows, t_rows = [], [], []
    for sid in order:
        card = cards[sid]
        a = t = -1
        if sid in audio:
            a = len(a_rows)
            a_rows.append(audio[sid])
        if sid in text:
            t = len(t_rows)
            t_rows.append(text[sid])
        x = extra[sid]
        songs.append(
            {
                "id": sid,
                "genre": genre[sid],
                "sub": card.get("subgenre"),
                "era": card.get("era"),
                "year": card.get("year"),
                "moods": card.get("moods") or [],
                "scores": _scores(card),
                "group": group.get(sid),
                "composer": x["composer"],
                "work": x["work"],
                "album": x["album"],
                "movement": x["movement"],
                "instance": x["instance"],
                "a": a,
                "t": t,
            }
        )
    taste = {
        "version": VERSION,
        "generatedAt": now_iso(),
        "audioModel": audio_mod.MODEL,
        "audioDim": audio_mod.DIM,
        "textModel": text_mod.MODEL,
        "textDim": text_mod.DIM,
        "songs": songs,
        "groups": groups,
    }
    amat = unit(np.stack(a_rows)) if a_rows else np.zeros((0, audio_mod.DIM), dtype=np.float32)
    tmat = unit(np.stack(t_rows)) if t_rows else np.zeros((0, text_mod.DIM), dtype=np.float32)
    return taste, amat, tmat


def write(taste: dict, amat: np.ndarray, tmat: np.ndarray) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = [
        (OUT_DIR / "audio.f32", np.ascontiguousarray(amat, dtype="<f4").tobytes()),
        (OUT_DIR / "text.f32", np.ascontiguousarray(tmat, dtype="<f4").tobytes()),
        (OUT_DIR / "taste.json", json.dumps(taste, ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
    ]
    tmps = []
    for path, data in files:
        tmp = tmp_path(path)
        tmp.write_bytes(data)
        tmps.append((tmp, path))
    for tmp, path in tmps:
        tmp.replace(path)
