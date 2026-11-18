"""지도 페이지만 다시 쓰기(`python -m musike_analysis map`): 계산 없이 map_points.json → index.html·web 파일."""

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
        {"id": "L" + "a" * 20, "t": "Sparkle", "a": "山下達郎", "x": [0, 0, 0], "pc": [0, 0, 0], "nn": [1], "ns": [0.9], "k1": 0, "k2": 0},
        {"id": "dQw4w9WgXcQ", "t": "</script><b>x</b>", "a": "", "x": [1, 1, 1], "pc": [1, 1, 1], "nn": [0], "ns": [0.9], "k1": 0, "k2": 0},
    ],
}


@pytest.fixture
def map_dir(tmp_path, monkeypatch):
    out = tmp_path / "map"
    monkeypatch.setattr(mapbuild, "MAP_DIR", out)
    return out


def test_rerender_writes_page_from_points(map_dir):
    map_dir.mkdir()
    (map_dir / "map_points.json").write_text(json.dumps(DATA, ensure_ascii=False), encoding="utf-8")
    (map_dir / "search.js").write_text("old", encoding="utf-8")
    assert mapbuild.rerender() == 0

    html = (map_dir / "index.html").read_text(encoding="utf-8")
    assert "__DATA__" not in html
    assert "Sparkle" in html
    # 제목 속 </script> 가 데이터 스크립트를 닫지 않는다
    assert "<\\/script><b>x<\\/b>" in html
    # Musike 안에서만: 재생은 Musike 다리, 개인 기록(user.js)은 없다
    assert '<script src="player.js"></script>' in html
    assert "user.js" not in html and "user.css" not in html
    assert 'location.replace("/library/map"' in html
    for name in mapbuild.WEB_FILES:
        assert (map_dir / name).read_text(encoding="utf-8") == (mapbuild.WEB_DIR / name).read_text(encoding="utf-8")
    # 내 파일 곡 표지는 Musike, 유튜브 미니 플레이어는 없다
    assert "/api/local/" in html
    assert "youtube-nocookie" not in (map_dir / "player.js").read_text(encoding="utf-8")


def test_rerender_without_points_writes_nothing(map_dir):
    assert mapbuild.rerender() == 1
    assert not map_dir.exists() or not any(map_dir.iterdir())
