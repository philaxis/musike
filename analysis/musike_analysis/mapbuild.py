"""3D 지도: 글 벡터 UMAP·PCA·이웃, 소리 벡터 UMAP·이웃 → 지도 폴더(map/).

큰 군집 = 큰 갈래, 세부 군집 = 소리 묶음(taste.json 과 같은 것). 다음 단계에서 Musike 가 이 폴더를 보여 준다.
- index.html (데이터 인라인) + 페이지가 부르는 web 파일
- map_points.json, search_meta.json · vectors_e5.bin (브라우저 의미 검색)
- api/songs.json · api/neighbors.json · api/status.json
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np

from . import budget
from .config import API_DIR, MAP_DIR
from .soundsearch import int8_assets
from .util import atomic_write_bytes, atomic_write_json, log, now_iso
from .vectors import unit

SEED = 42
NEIGHBORS = 30
WEB_DIR = Path(__file__).with_name("web")
WEB_FILES = ("search.js", "soundsearch.js", "player.js", "user.js", "user.css")


def umap_xyz(vecs: np.ndarray) -> np.ndarray:
    """UMAP 3D, 가운데 0 · 가장 먼 점 반지름 100. seed 고정."""
    import umap

    n_neighbors = max(2, min(15, len(vecs) - 1))
    xyz = umap.UMAP(n_components=3, metric="cosine", n_neighbors=n_neighbors, min_dist=0.1, random_state=SEED).fit_transform(vecs)
    xyz = xyz - xyz.mean(axis=0)
    return xyz / max(float(np.linalg.norm(xyz, axis=1).max()), 1e-9) * 100.0


def pca_xyz(vecs: np.ndarray) -> tuple[np.ndarray, list[float]]:
    from sklearn.decomposition import PCA

    pca = PCA(n_components=3, random_state=SEED)
    return pca.fit_transform(np.asarray(vecs, dtype=np.float64)), [round(float(v), 4) for v in pca.explained_variance_ratio_]


def neighbors(vecs: np.ndarray, k: int = NEIGHBORS) -> tuple[np.ndarray, np.ndarray]:
    """코사인 최근접 k(자기 제외). vecs 는 정규화돼 있어야 한다."""
    sims = vecs @ vecs.T
    np.fill_diagonal(sims, -np.inf)
    k = min(k, len(vecs) - 1)
    idx = np.argpartition(-sims, k, axis=1)[:, :k]
    part = np.take_along_axis(sims, idx, axis=1)
    order = np.argsort(-part, axis=1)
    return np.take_along_axis(idx, order, axis=1), np.take_along_axis(part, order, axis=1)


def build(order: list[str], songs: dict, cards: dict, extra: dict, genre: dict, group: dict, groups: list[dict],
          text: dict, audio: dict, tags: dict) -> dict:
    ids = [sid for sid in order if sid in text]
    n = len(ids)
    if n < 3:
        log("지도: 곡이 3곡 미만이라 건너뜀")
        return {"songs": n}
    tmat = unit(np.stack([text[sid] for sid in ids]))
    log(f"지도: {n}곡 UMAP·PCA·이웃 계산")
    xyz = umap_xyz(tmat)
    pc, variance = pca_xyz(tmat)
    nn, ns = neighbors(tmat)
    index_of = {sid: i for i, sid in enumerate(ids)}

    a_ids = [sid for sid in ids if sid in audio]
    a_xyz: dict[str, np.ndarray] = {}
    a_nn: dict[str, list[tuple[str, float]]] = {}
    if len(a_ids) >= 5:
        amat = unit(np.stack([audio[sid] for sid in a_ids]))
        log(f"지도: 소리 {len(a_ids)}곡 UMAP·이웃 계산")
        axyz = umap_xyz(amat)
        ann, ans = neighbors(amat)
        for i, sid in enumerate(a_ids):
            a_xyz[sid] = axyz[i]
            a_nn[sid] = [(a_ids[int(j)], float(s)) for j, s in zip(ann[i], ans[i])]

    genres = list(dict.fromkeys(g["genre"] for g in groups))
    coarse_of = {g: i for i, g in enumerate(genres)}
    fine_of = {g["id"]: i for i, g in enumerate(groups)}
    points = []
    for i, sid in enumerate(ids):
        song, card, x = songs[sid], cards[sid], extra[sid]
        p = {
            "id": sid,
            "t": card.get("title") or song.get("title") or "",
            "a": card.get("artist") or "",
            "c": x["composer"] or "",
            "w": x["work"] or "",
            "al": x["album"] or "",
            "y": card.get("year"),
            "g": genre[sid],
            "sg": card.get("subgenre") or "",
            "e": card.get("era") or "",
            "rg": card.get("region") or "",
            "m": card.get("moods") or [],
            "in": card.get("instruments") or [],
            "s": card.get("scores") or {},
            "pl": song.get("playlists") or [],
            "l": 1 if song.get("liked") else 0,
            "pr": "legacy",
            "ct": card.get("card_text") or "",
            "ch": song.get("artist") or "",
            "src": song["source"],
            "x": [round(float(v), 2) for v in xyz[i]],
            "pc": [round(float(v), 4) for v in pc[i]],
            "nn": [int(v) for v in nn[i]],
            "ns": [round(float(v), 4) for v in ns[i]],
            "k1": coarse_of[genre[sid]],
            "k2": fine_of[group[sid]],
        }
        if sid in a_xyz:
            p["ax"] = [round(float(v), 2) for v in a_xyz[sid]]
            p["an"] = [index_of[o] for o, _ in a_nn[sid]]
            p["st"] = tags.get(sid) or []
        points.append(p)

    counts_g = {g: sum(1 for sid in ids if genre[sid] == g) for g in genres}
    counts_f = {g["id"]: sum(1 for sid in ids if group[sid] == g["id"]) for g in groups}
    data = {
        "generatedAt": now_iso(),
        "counts": {"songs": n, "coarse": len(genres), "fine": len(groups), "audio": len(a_ids)},
        "pca": {"variance": variance, "names": [["−", "+"], ["−", "+"], ["−", "+"]]},
        "coarse": [{"name": g, "count": counts_g[g], "genre": g} for g in genres],
        "fine": [{"name": g["name"], "parent": coarse_of[g["genre"]], "count": counts_f[g["id"]], "subgenre": g["name"]} for g in groups],
        "points": points,
    }

    MAP_DIR.mkdir(parents=True, exist_ok=True)
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = (WEB_DIR / "map3d_template.html").read_text(encoding="utf-8").replace("__DATA__", body).replace("__STATIC__", "false")
    atomic_write_bytes(MAP_DIR / "index.html", html.encode("utf-8"))
    for name in WEB_FILES:
        shutil.copyfile(WEB_DIR / name, MAP_DIR / name)
    atomic_write_json(MAP_DIR / "map_points.json", data)

    rows = [
        {
            "videoId": p["id"], "point": i, "title": p["t"], "artist": p["a"], "composer": p["c"], "work": p["w"],
            "genre": p["g"], "subgenre": p["sg"], "era": p["e"], "year": p["y"], "moods": " ".join(p["m"]),
            "playlists": p["pl"], "summary": p["ct"].strip()[:180],
        }
        for i, p in enumerate(points)
    ]
    int8_assets(tmat, rows, MAP_DIR / "vectors_e5.bin", MAP_DIR / "search_meta.json")

    names = {g["id"]: g["name"] for g in groups}
    atomic_write_json(
        API_DIR / "songs.json",
        {
            "version": 1,
            "generatedAt": data["generatedAt"],
            "songs": {
                p["id"]: {
                    "title": p["t"], "artist": p["a"] or None, "composer": p["c"] or None, "work": p["w"] or None,
                    "genre": p["g"], "subgenre": p["sg"] or None, "era": p["e"] or None, "year": p["y"], "moods": p["m"],
                    "scores": p["s"], "cluster": {"coarse": p["g"], "fine": names[group[p["id"]]]}, "playlists": p["pl"],
                    "liked": bool(p["l"]), "soundTags": p.get("st") or [],
                }
                for p in points
            },
        },
    )
    atomic_write_json(
        API_DIR / "neighbors.json",
        {
            sid: {
                "text": [[ids[int(j)], round(float(s), 3)] for j, s in zip(nn[i][:20], ns[i][:20])],
                "audio": [[o, round(s, 3)] for o, s in a_nn.get(sid, [])[:20]],
            }
            for i, sid in enumerate(ids)
        },
    )
    atomic_write_json(
        API_DIR / "status.json",
        {"songCount": n, "audioSongs": len(a_ids), "costUsd": budget.total(), "finishedAt": now_iso()},
    )
    log(f"지도 저장: {MAP_DIR / 'index.html'}")
    return {"songs": n, "audio": len(a_ids)}
