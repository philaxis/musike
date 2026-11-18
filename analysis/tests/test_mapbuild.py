"""지도 페이지만 다시 쓰기(`python -m musike_analysis map`): 계산 없이 map_points.json → index.html·해시 이름 파일."""

from __future__ import annotations

import json

import pytest

from musike_analysis import mapbuild

DATA = {
    "generatedAt": "2026-11-18T06:55:00+09:00",
    "counts": {"songs": 2, "coarse": 1, "fine": 1, "audio": 0},
    "pca": {"variance": [0.5, 0.3, 0.2], "names": [["−", "+"]] * 3},
    "coarse": [{"name": "시티팝", "count": 2, "genre": "시티팝"}],
    "fine": [{"name": "시티팝", "parent": 0, "count": 2, "subgenre": "시티팝"}],
    "points": [
        {"id": "L" + "a" * 20, "t": "Sparkle", "a": "山下達郎", "x": [0, 0, 0], "pc": [0, 0, 0], "nn": [1], "ns": [0.91234], "k1": 0, "k2": 0,
         "ct": "여름 시티팝", "an": [1]},
        {"id": "dQw4w9WgXcQ", "t": "</script><b>x</b>", "a": "", "x": [1, 1, 1], "pc": [1, 1, 1], "nn": [0], "ns": [0.9], "k1": 0, "k2": 0},
    ],
}


@pytest.fixture
def map_dir(tmp_path, monkeypatch):
    out = tmp_path / "map"
    monkeypatch.setattr(mapbuild, "MAP_DIR", out)
    return out


def files_of(map_dir):
    return json.loads((map_dir / "files.json").read_text(encoding="utf-8"))["files"]


def test_rerender_writes_page_from_points(map_dir):
    map_dir.mkdir()
    (map_dir / "map_points.json").write_text(json.dumps(DATA, ensure_ascii=False), encoding="utf-8")
    (map_dir / "vectors_e5.bin").write_bytes(bytes(range(8)))
    assert mapbuild.rerender() == 0

    files = files_of(map_dir)
    html = (map_dir / "index.html").read_text(encoding="utf-8")
    # 자료는 페이지 밖, 이름표만 페이지에
    assert "__FILES__" not in html and "Sparkle" not in html
    assert json.dumps(files, ensure_ascii=False, separators=(",", ":")) in html
    for name, hashed in files.items():
        stem, ext = name.rsplit(".", 1)
        assert mapbuild.HASHED.match(hashed) and hashed.startswith(stem + ".") and hashed.endswith("." + ext), hashed
        assert (map_dir / hashed).is_file()
    # 첫 화면 자료엔 설명·이웃이 없고, 나중 자료에 점 순서로 있다(이웃 점수는 소수 둘째 자리)
    core = json.loads((map_dir / files["points.json"]).read_text(encoding="utf-8"))
    assert [p["t"] for p in core["points"]] == ["Sparkle", "</script><b>x</b>"]
    assert not any(k in p for p in core["points"] for k in mapbuild.DETAIL)
    assert core["counts"] == DATA["counts"]
    detail = json.loads((map_dir / files["detail.json"]).read_text(encoding="utf-8"))
    assert detail == {"ct": ["여름 시티팝", ""], "ns": [[0.91], [0.9]], "nn": [[1], [0]], "an": [[1], None]}
    # web 파일·검색 자료는 내용 그대로 해시 이름으로
    for name in mapbuild.WEB_FILES:
        assert (map_dir / files[name]).read_bytes() == (mapbuild.WEB_DIR / name).read_bytes()
    assert (map_dir / files["vectors_e5.bin"]).read_bytes() == bytes(range(8))
    assert "sound_concepts_index.json" not in files
    # Musike 안에서만: 재생은 Musike 다리, 개인 기록(user.js)은 없다
    assert '"player.js"' in html
    assert "user.js" not in html and "user.css" not in html
    assert 'location.replace("/library/map"' in html
    # 내 파일 곡 표지는 Musike, 유튜브 미니 플레이어는 없다
    assert "/api/local/" in html
    assert "youtube-nocookie" not in (map_dir / files["player.js"]).read_text(encoding="utf-8")


def test_rerender_keeps_names_and_prunes_old_files(map_dir):
    map_dir.mkdir()
    (map_dir / "map_points.json").write_text(json.dumps(DATA, ensure_ascii=False), encoding="utf-8")
    stale = map_dir / "points.0123456789ab.json"
    stale.write_text("{}", encoding="utf-8")
    (map_dir / "notes.txt").write_text("남의 파일", encoding="utf-8")
    assert mapbuild.rerender() == 0
    first = files_of(map_dir)
    assert not stale.exists() and (map_dir / "notes.txt").exists()
    # 같은 자료면 같은 이름
    assert mapbuild.rerender() == 0
    assert files_of(map_dir) == first
    # 자료가 바뀌면 새 이름, 지난번 것은 한 번 더 남는다(열려 있는 지도가 부를 수 있다)
    changed = {**DATA, "points": [{**DATA["points"][0], "t": "Ride on Time"}, DATA["points"][1]]}
    (map_dir / "map_points.json").write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8")
    assert mapbuild.rerender() == 0
    second = files_of(map_dir)
    assert second["points.json"] != first["points.json"] and second["detail.json"] == first["detail.json"]
    assert (map_dir / first["points.json"]).exists()
    assert mapbuild.rerender() == 0
    assert not (map_dir / first["points.json"]).exists() and (map_dir / second["points.json"]).exists()


def test_rerender_without_points_writes_nothing(map_dir):
    assert mapbuild.rerender() == 1
    assert not map_dir.exists() or not any(map_dir.iterdir())
