"""소리로 찾기 색인과 소리 태그. Gemini 호출 없음.

- 소리 개념 사전(data/sound_concepts.json, 1,247개)의 영어 문장을 MuQ-MuLan 글 인코더로 임베딩하고, 곡 소리 벡터와의
  코사인을 개념별 z-score 로 바꿔 상위 150곡을 색인한다. 한국어 질의는 지도 검색과 같은 e5-small 로 개념에 붙인다.
- 소리 태그: 카드의 장르·하위장르·분위기 어휘(최대 200개)와 곡 소리 벡터가 가장 가까운 5개.

결과(지도 폴더): sound_concepts_index.json · vectors_e5_concepts.bin · sound_concepts_meta.json · api/sound_concepts.json
"""

from __future__ import annotations

import collections
import json
from pathlib import Path

import numpy as np

from . import audio as audio_mod
from . import text as text_mod
from .config import API_DIR, MAP_DIR
from .util import atomic_write_bytes, atomic_write_json, log, now_iso
from .vectors import unit

CONCEPTS_PATH = Path(__file__).with_name("data") / "sound_concepts.json"
TOP_SONGS = 150
API_SONGS = 50
WEAK_MAX_COS = 0.12
TAG_LIMIT = 200


def load_concepts() -> list[dict]:
    raw = json.loads(CONCEPTS_PATH.read_text(encoding="utf-8"))
    return raw.get("concepts") if isinstance(raw, dict) else raw


def concept_text(concept: dict) -> str:
    aliases = [str(a).strip() for a in concept.get("aliases_ko") or [] if str(a).strip()]
    return "passage: " + " ".join([str(concept["ko"]).strip(), *aliases])


def zscore_index(sims: np.ndarray, ids: list[str], top_n: int = TOP_SONGS):
    """열(개념)마다 (곡 z-score 상위 top_n, {maxZ, maxCos})."""
    n, c = sims.shape
    mean, std = sims.mean(axis=0), sims.std(axis=0)
    z = (sims - mean) / np.where(std < 1e-6, 1.0, std)
    order = np.argsort(-z, axis=0)[: min(top_n, n)]
    max_cos = sims.max(axis=0)
    index, strength = [], []
    for j in range(c):
        picked = order[:, j]
        index.append([[ids[i], round(float(z[i, j]), 3)] for i in picked])
        strength.append({"maxZ": round(float(z[picked[0], j]), 3), "maxCos": round(float(max_cos[j]), 3)})
    return index, strength


def int8_bytes(vectors: np.ndarray) -> bytes:
    """브라우저 검색용 int8 벡터(줄마다 한 항목). transformers.js 쪽 embed_text 와 같은 모양."""
    return np.clip(np.round(np.asarray(vectors, dtype=np.float32) * 127), -127, 127).astype(np.int8).tobytes()


def int8_assets(vectors: np.ndarray, rows: list[dict], bin_path: Path, meta_path: Path) -> None:
    """브라우저 검색 자산(int8 벡터 + 메타)."""
    dim = int(vectors.shape[1]) if vectors.size else text_mod.DIM
    for i, row in enumerate(rows):
        row["offset"] = i * dim
    atomic_write_bytes(bin_path, int8_bytes(vectors))
    atomic_write_json(meta_path, {"model": text_mod.MODEL, "dtype": "int8", "dim": dim, "count": len(rows), "items": rows})


def sound_tags(ids: list[str], amat: np.ndarray, cards: dict[str, dict]) -> dict[str, list[str]]:
    """곡 소리 벡터와 가장 가까운 장르·하위장르·분위기 5개."""
    counters = {"장르": collections.Counter(), "하위장르": collections.Counter(), "분위기": collections.Counter()}
    for card in cards.values():
        if card.get("genre"):
            counters["장르"][card["genre"]] += 1
        if card.get("subgenre"):
            counters["하위장르"][card["subgenre"]] += 1
        for mood in card.get("moods") or []:
            counters["분위기"][mood] += 1
    vocab: list[tuple[str, str]] = []
    seen: set[str] = set()
    for label, n in (("장르", 40), ("하위장르", 80), ("분위기", 80)):
        for name, _ in counters[label].most_common(n):
            if name not in seen and len(vocab) < TAG_LIMIT:
                seen.add(name)
                vocab.append((label, name))
    if not vocab or not len(ids):
        return {}
    tmat = unit(audio_mod.encode_texts([f"{label}: {name}" for label, name in vocab]))
    top = np.argsort(-(amat @ tmat.T), axis=1)[:, :5]
    return {sid: [vocab[int(j)][1] for j in row] for sid, row in zip(ids, top)}


def build(ids: list[str], amat: np.ndarray, cards: dict[str, dict]) -> tuple[dict[str, list[str]], dict]:
    """ids·amat = 소리 벡터가 있는 곡(정규화). (소리 태그, 통계)"""
    concepts = load_concepts()
    if len(ids):
        prompts = unit(audio_mod.encode_texts([c["en_prompt"] for c in concepts]))
        by_col, strength_col = zscore_index(amat @ prompts.T, ids)
    else:
        by_col = [[] for _ in concepts]
        strength_col = [{"maxZ": 0.0, "maxCos": 0.0} for _ in concepts]
    index = {c["id"]: by_col[j] for j, c in enumerate(concepts)}
    strength = {c["id"]: strength_col[j] for j, c in enumerate(concepts)}
    weak = [cid for cid, st in strength.items() if st["maxCos"] < WEAK_MAX_COS]
    at = now_iso()
    common = {"version": 1, "generatedAt": at, "model": audio_mod.MODEL, "audioModel": audio_mod.MODEL, "scoreKind": "z",
              "songCount": len(ids), "weakMaxCos": WEAK_MAX_COS}
    atomic_write_json(MAP_DIR / "sound_concepts_index.json", {**common, "conceptCount": len(concepts), "index": index, "strength": strength, "weak": weak})
    atomic_write_json(
        API_DIR / "sound_concepts.json",
        {
            **common,
            "concepts": [{k: c.get(k) for k in ("id", "ko", "aliases_ko", "en_prompt", "group")} for c in concepts],
            "index": {cid: rows[:API_SONGS] for cid, rows in index.items()},
            "weak": weak,
        },
    )
    rows = [{"id": c["id"], "ko": c["ko"], "aliases_ko": c.get("aliases_ko") or [], "group": c["group"]} for c in concepts]
    int8_assets(text_mod.embed([concept_text(c) for c in concepts]), rows, MAP_DIR / "vectors_e5_concepts.bin", MAP_DIR / "sound_concepts_meta.json")
    tags = sound_tags(ids, amat, cards)
    log(f"소리 개념 색인: 개념 {len(concepts)}개 · 곡 {len(ids)} · 약한 개념 {len(weak)}개 · 소리 태그 {len(tags)}곡")
    return tags, {"concepts": len(concepts), "songs": len(ids), "weak": len(weak)}
