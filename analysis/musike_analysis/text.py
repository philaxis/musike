"""카드 글 → multilingual-e5-small 벡터(로컬, 무료).

브라우저 검색(transformers.js)과 같은 모델 파일(Xenova/multilingual-e5-small, ONNX q8)을 onnxruntime 으로 돌려
같은 벡터를 얻는다: 평균 풀링 + L2 정규화. 캐시: <작업 폴더>/text.parquet (곡 번호, 글 해시).
"""

from __future__ import annotations

import numpy as np

from .config import TEXT_PATH
from .util import log, sha1
from .vectors import load_table, save_table

MODEL = "Xenova/multilingual-e5-small"
DIM = 384
BATCH = 32
MAX_TOKENS = 512

_session = None


def card_text(card: dict) -> str:
    """카드 글(설명·장르·하위장르·시대·아티스트·작곡가·분위기). 지도 검색 색인도 같은 글을 쓴다."""
    parts = [
        card.get("card_text") or "",
        f"장르: {card.get('genre')}" if card.get("genre") else "",
        f"하위장르: {card.get('subgenre')}" if card.get("subgenre") else "",
        f"시대: {card.get('era')}" if card.get("era") else "",
        f"아티스트: {card.get('artist')}" if card.get("artist") else "",
        f"작곡가: {card.get('composer')}" if card.get("composer") else "",
        f"분위기: {', '.join(card.get('moods') or [])}" if card.get("moods") else "",
    ]
    return "passage: " + " ".join(" ".join(p for p in parts if p).split())


def _load():
    global _session
    if _session is None:
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        tok = Tokenizer.from_file(hf_hub_download(MODEL, "tokenizer.json"))
        tok.enable_truncation(MAX_TOKENS)
        tok.enable_padding()
        sess = ort.InferenceSession(hf_hub_download(MODEL, "onnx/model_quantized.onnx"), providers=["CPUExecutionProvider"])
        _session = (tok, sess, {i.name for i in sess.get_inputs()})
    return _session


def embed(texts: list[str]) -> np.ndarray:
    """글 목록 → (n, 384) L2 정규화 float32."""
    if not texts:
        return np.zeros((0, DIM), dtype=np.float32)
    tok, sess, names = _load()
    out = []
    for start in range(0, len(texts), BATCH):
        enc = tok.encode_batch(texts[start : start + BATCH])
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in names:
            feed["token_type_ids"] = np.zeros_like(ids)
        hidden = sess.run(None, feed)[0]
        m = mask[:, :, None].astype(np.float32)
        pooled = (hidden * m).sum(axis=1) / np.maximum(m.sum(axis=1), 1e-9)
        out.append(pooled / (np.linalg.norm(pooled, axis=1, keepdims=True) + 1e-12))
    return np.concatenate(out).astype(np.float32)


def run(cards: dict[str, dict]) -> tuple[dict[str, np.ndarray], dict]:
    """곡 번호 → 카드. 글이 바뀐 곡만 다시 임베딩. (곡 번호 → 벡터, 통계)"""
    table = load_table(TEXT_PATH)
    texts = {sid: card_text(card) for sid, card in cards.items()}
    todo = [sid for sid, text in texts.items() if sid not in table or table[sid]["hash"] != sha1(text)]
    log(f"글 벡터: {len(texts)}곡 · 새로 {len(todo)}곡 ({MODEL})")
    if todo:
        vecs = embed([texts[sid] for sid in todo])
        for sid, vec in zip(todo, vecs):
            table[sid] = {"vector": vec, "hash": sha1(texts[sid]), "model": MODEL}
        save_table(TEXT_PATH, table)
    return {sid: table[sid]["vector"] for sid in texts}, {"songs": len(texts), "embedded": len(todo)}
