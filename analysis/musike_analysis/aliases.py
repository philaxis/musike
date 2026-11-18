"""바꿔 넣은 영상의 분석을 새 번호로 옮긴다.

서버는 못 트는 영상을 다른 영상으로 바꿔 넣을 때마다 옛 번호 → 지금 번호를 `<데이터>/video-aliases.json` 에 적는다
(서버 영상 기록, `server/src/ledger.ts`). 같은 곡이므로 옛 번호의 카드·글 벡터·소리 벡터·소리 묶음을 새 번호로
복사해 다시 분석하지 않는다. 새 번호에 이미 있는 것은 그대로 두고, 옛 번호에도 없던 것은 평소처럼 새로 분석된다.
"""

from __future__ import annotations

from pathlib import Path

from . import cards
from .config import ALIASES_PATH, AUDIO_PATH, GROUPS_PATH, TEXT_PATH
from .util import atomic_write_json, load_json, log
from .vectors import load_table, save_table


def load(path: Path | None = None) -> dict[str, str]:
    """옛 번호 → 지금 번호(서버가 사슬을 이미 따라가 둠). 파일이 없거나 깨졌으면 빈 dict."""
    raw = load_json(path or ALIASES_PATH, {})
    return {str(k): str(v) for k, v in raw.items() if isinstance(v, str)} if isinstance(raw, dict) else {}


def carry_over(song_ids: set[str], aliases: dict[str, str] | None = None) -> dict:
    """지금 곡 후보 가운데 바꿔 넣은 곡에 옛 번호의 분석을 복사한다. (옮긴 수)"""
    pairs = [(old, new) for old, new in (load() if aliases is None else aliases).items() if new in song_ids and old != new]
    stats = {"aliases": len(pairs), "cards": 0, "text": 0, "audio": 0, "groups": 0}
    if not pairs:
        return stats
    for old, new in pairs:
        card = cards.load(old)
        if card is not None and cards.load(new) is None:
            atomic_write_json(cards.card_path(new), {**card, "id": new})
            stats["cards"] += 1
    for path, key in ((TEXT_PATH, "text"), (AUDIO_PATH, "audio")):
        table = load_table(path)
        moved = [(old, new) for old, new in pairs if old in table and new not in table]
        for old, new in moved:
            table[new] = dict(table[old])
        if moved:
            save_table(path, table)
        stats[key] = len(moved)
    state = load_json(GROUPS_PATH)
    assign = state.get("assign") if isinstance(state, dict) else None
    if isinstance(assign, dict):
        moved = [(old, new) for old, new in pairs if old in assign and new not in assign]
        for old, new in moved:
            assign[new] = assign[old]
        if moved:
            atomic_write_json(GROUPS_PATH, state, indent=0)
        stats["groups"] = len(moved)
    log(f"바꿔 넣은 곡 {len(pairs)}곡: 카드 {stats['cards']} · 글 벡터 {stats['text']} · 소리 벡터 {stats['audio']} · 묶음 {stats['groups']} 옮김")
    return stats
