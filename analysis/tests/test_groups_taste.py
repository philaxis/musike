import json

import numpy as np
import pytest

from musike_analysis import cards, config, groups, songs, taste


@pytest.fixture()
def work(tmp_path, monkeypatch):
    monkeypatch.setattr(groups, "GROUPS_PATH", tmp_path / "groups.json")
    monkeypatch.setattr(taste, "OUT_DIR", tmp_path / "out")
    return tmp_path


def _data(seed=0):
    """재즈 120곡(소리 두 덩어리, 그중 10곡은 소리 없음) + 팝 10곡(→ 기타)."""
    rng = np.random.default_rng(seed)
    a, b = rng.normal(size=512), rng.normal(size=512)
    cards_, audio, text = {}, {}, {}
    for i in range(120):
        sid = f"j{i:03d}"
        cards_[sid] = {"genre": "재즈", "subgenre": "모던 재즈" if i < 60 else "보사노바", "artist": "A" if i < 60 else "B"}
        center = a if i < 60 else b
        text[sid] = (center[:384] + rng.normal(scale=0.1, size=384)).astype(np.float32)
        if i % 12:
            audio[sid] = (center + rng.normal(scale=0.1, size=512)).astype(np.float32)
    for i in range(10):
        sid = f"p{i}"
        cards_[sid] = {"genre": "팝", "subgenre": "인디팝"}
        text[sid] = rng.normal(size=384).astype(np.float32)
    return cards_, audio, text


def test_groups_split_fold_and_keep(work, monkeypatch):
    monkeypatch.setattr(groups, "PER_GROUP", 50)
    cards_, audio, text = _data()
    genre, group, listing = groups.assign(cards_, audio, text)
    assert genre["p0"] == "기타"
    jazz = [g for g in listing if g["genre"] == "재즈"]
    assert len(jazz) == 2 and all(g["size"] >= 25 for g in jazz)
    # 소리 없는 곡도 글로 묶음에 들어간다
    assert group["j000"] == group["j001"] and group["j000"] != group["j060"]
    assert {g["name"] for g in jazz} == {"모던재즈", "보사노바"}

    # 다음 실행: 번호 유지, 새 곡은 가까운 묶음으로
    cards_["j999"] = dict(cards_["j061"])
    audio["j999"], text["j999"] = audio["j061"], text["j061"]
    _, group2, listing2 = groups.assign(cards_, audio, text)
    assert all(group2[s] == group[s] for s in group)
    assert group2["j999"] == group["j061"]
    assert {g["id"]: g["name"] for g in listing2} == {g["id"]: g["name"] for g in listing}


def test_name_clash_uses_artist(work, monkeypatch):
    monkeypatch.setattr(groups, "PER_GROUP", 50)
    cards_, audio, text = _data()
    for sid, c in cards_.items():
        c["subgenre"] = "모던 재즈" if c["genre"] == "재즈" else c["subgenre"]
    _, _, listing = groups.assign(cards_, audio, text)
    names = sorted(g["name"] for g in listing if g["genre"] == "재즈")
    assert names == ["모던재즈 (A)", "모던재즈 (B)"]


def test_small_groups_go_to_etc(work):
    cards_, audio, text = _data()
    members = groups._fold_small("재즈", {"재즈·1": [f"x{i}" for i in range(30)], "재즈·2": ["y1", "y2"]})
    assert members == {"재즈·1": [f"x{i}" for i in range(30)], "재즈·etc": ["y1", "y2"]}


def test_taste_write_contract(work):
    order = ["s1", "s2"]
    cards_ = {"s1": {"subgenre": "하드 밥", "era": "1950년대", "year": 1956, "moods": ["따뜻함"], "scores": {"energy": 3}},
              "s2": {"scores": {"energy": None}}}
    extra = {sid: {"composer": None, "work": None, "album": "X", "movement": None, "instance": None} for sid in order}
    audio = {"s2": np.ones(512, dtype=np.float32)}
    text = {"s1": np.ones(384, dtype=np.float32), "s2": np.ones(384, dtype=np.float32)}
    doc, amat, tmat = taste.build(order, cards_, extra, {"s1": "재즈", "s2": "기타"}, {"s1": "재즈·1"}, [], audio, text)
    taste.write(doc, amat, tmat)
    out = work / "out"
    got = json.loads((out / "taste.json").read_text())
    s1, s2 = got["songs"]
    assert (s1["a"], s1["t"], s2["a"], s2["t"]) == (-1, 0, 0, 1)
    assert s1["scores"] == {"energy": 3} and s2["scores"] is None and s2["group"] is None
    assert set(s1) >= {"id", "genre", "sub", "era", "year", "moods", "scores", "group", "composer", "work", "album", "movement", "instance", "a", "t"}
    a = np.fromfile(out / "audio.f32", dtype="<f4").reshape(-1, 512)
    assert a.shape == (1, 512) and abs(np.linalg.norm(a[0]) - 1) < 1e-5
    assert not list(out.glob(".*.tmp"))


def test_box_item_to_song():
    yt = {"track": {"id": "CQIkP6U3_14", "title": "t", "artist": "ch", "duration": 95, "kind": "video"},
          "sources": [{"kind": "youtube-playlist", "name": "GAME"}, {"kind": "youtube-liked", "name": "좋아요"}]}
    s = songs.to_song(yt)
    assert s["source"] == "youtube" and s["playlists"] == ["GAME"] and s["liked"] and s["inPlaylist"]
    loc = {"track": {"id": "LLjpuSVOU1qXDS6sBmyML", "title": "Wendy", "artist": "야마시타 타츠로", "album": "ADD", "duration": 153, "kind": "song", "source": "local"},
           "sources": [{"kind": "local", "name": "야마시타 타츠로"}]}
    assert songs.to_song(loc)["source"] == "local"
    assert songs.to_song({"track": {"id": "x", "kind": "bundle"}}) is None
    assert songs.to_song({"track": {"id": "CQIkP6U3_14", "title": "Deleted video"}}) is None


def test_card_parse_and_normalize():
    raw = '```json\n{"cards":[{"id":"a","is_music":false,"genre":"jazz","year":"1959년","scores":{"energy":7}}]}\n```'
    got = cards.parse_cards(raw)
    song = {"id": "a", "source": "youtube", "inPlaylist": True}
    card = cards.normalize_card(got[0], song)
    assert card["genre"] == "재즈" and card["year"] == 1959 and card["scores"]["energy"] == 5
    assert card["is_music"] is True  # 재생목록 곡은 음악


def test_work_dir_requires_parent(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORK_DIR", tmp_path / "missing" / "analysis")
    with pytest.raises(SystemExit):
        config.require_work_dir()
