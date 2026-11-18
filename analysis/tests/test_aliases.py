"""바꿔 넣은 영상: 옛 번호의 분석(카드·글/소리 벡터·묶음)을 새 번호로 옮기고, 새 번호에 있는 것은 두기."""

import json

import numpy as np
import pytest

from musike_analysis import aliases, cards
from musike_analysis.vectors import load_table, save_table

OLD, NEW, OTHER_OLD, OTHER_NEW = "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"


@pytest.fixture()
def work(tmp_path, monkeypatch):
    monkeypatch.setattr(cards, "CARD_DIR", tmp_path / "cards")
    monkeypatch.setattr(aliases, "TEXT_PATH", tmp_path / "text.parquet")
    monkeypatch.setattr(aliases, "AUDIO_PATH", tmp_path / "audio.parquet")
    monkeypatch.setattr(aliases, "GROUPS_PATH", tmp_path / "groups.json")
    monkeypatch.setattr(aliases, "ALIASES_PATH", tmp_path / "video-aliases.json")
    (tmp_path / "cards").mkdir()
    return tmp_path


def _card(sid, genre):
    return {"id": sid, "is_music": True, "genre": genre, "card_text": f"{genre} 곡"}


def test_carries_old_analysis_to_new_id(work):
    for sid, genre in ((OLD, "시티팝"), (OTHER_OLD, "재즈"), (OTHER_NEW, "팝")):
        (work / "cards" / f"{sid}.json").write_text(json.dumps(_card(sid, genre)), encoding="utf-8")
    vec = {"vector": np.ones(4, dtype=np.float32), "hash": "h", "model": "m"}
    save_table(work / "audio.parquet", {OLD: vec})
    save_table(work / "text.parquet", {OLD: vec, OTHER_OLD: vec, OTHER_NEW: {**vec, "vector": np.zeros(4, dtype=np.float32) + 2}})
    (work / "groups.json").write_text(json.dumps({"version": 1, "groups": [], "assign": {OLD: "시티팝·1"}}), encoding="utf-8")
    (work / "video-aliases.json").write_text(json.dumps({OLD: NEW, OTHER_OLD: OTHER_NEW, "eeeeeeeeeee": "fffffffffff"}), encoding="utf-8")

    stats = aliases.carry_over({NEW, OTHER_NEW})

    assert stats == {"aliases": 2, "cards": 1, "text": 1, "audio": 1, "groups": 1}
    assert cards.load(NEW) == {**_card(OLD, "시티팝"), "id": NEW}
    assert cards.load(OTHER_NEW)["genre"] == "팝"  # 새 번호의 것은 그대로
    assert NEW in load_table(work / "audio.parquet")
    assert float(load_table(work / "text.parquet")[OTHER_NEW]["vector"][0]) == 2.0
    assert json.loads((work / "groups.json").read_text(encoding="utf-8"))["assign"][NEW] == "시티팝·1"
    # 두 번째에는 옮길 것이 없다.
    assert aliases.carry_over({NEW, OTHER_NEW}) == {"aliases": 2, "cards": 0, "text": 0, "audio": 0, "groups": 0}


def test_no_alias_file_changes_nothing(work):
    assert aliases.carry_over({NEW}) == {"aliases": 0, "cards": 0, "text": 0, "audio": 0, "groups": 0}
    assert not (work / "text.parquet").exists()
