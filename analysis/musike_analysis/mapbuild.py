"""3D 지도: 글 벡터 UMAP·PCA·이웃, 소리 벡터 UMAP·이웃 → 지도 폴더(map/).

큰 군집 = 큰 갈래, 세부 군집 = 소리 묶음(taste.json 과 같은 것). Musike 가 이 폴더를 /api/map/ 으로 내주고 「음악 지도」 화면의
iframe 에 띄운다(재생·메뉴는 Musike 쪽, web/player.js 가 다리).
- index.html(작은 껍데기) + 내용 해시를 이름에 단 파일들 — render(): `python -m musike_analysis map` 은 이것만 다시 쓴다.
  points.<해시>.json(첫 화면에 필요한 지점 자료) · detail.<해시>.json(설명·이웃, 첫 화면 뒤에) · web 파일 · 검색 자료 사본.
  이름이 내용을 따르므로 서버는 이 파일들을 오래 캐시하게 하고(immutable), 바뀌면 이름이 바뀐다. files.json 이 지금 이름표.
- map_points.json(지도 자료 원본), vectors_e5.bin(의미 검색 곡 벡터, 점 순서, 처음 의미 검색할 때 받는다)
- api/songs.json · api/neighbors.json · api/status.json
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import numpy as np

from . import budget
from .config import API_DIR, MAP_DIR
from .soundsearch import int8_bytes
from .util import atomic_write_bytes, atomic_write_json, log, now_iso
from .vectors import unit

SEED = 42
NEIGHBORS = 30
WEB_DIR = Path(__file__).with_name("web")
WEB_FILES = ("search.js", "soundsearch.js", "player.js")
# 검색할 때만 받는 자료(vectors_e5.bin 은 아래 build, 소리 개념 자료는 soundsearch.build 가 먼저 쓴다). 없으면 그 검색만 꺼진다.
# 글자 검색 항목은 지도 점에서 만들므로 따로 받지 않는다.
SEARCH_FILES = ("vectors_e5.bin", "sound_concepts_meta.json", "sound_concepts_index.json", "vectors_e5_concepts.bin")
# 첫 화면에는 필요 없는 지점 필드: 설명 글·이웃(정보 패널, 이웃 조건, 소리 이웃). 첫 화면을 그린 뒤 detail 파일로 받는다.
DETAIL = ("ct", "ns", "nn", "an")
HASHED = re.compile(r"^[\w-]+\.[0-9a-f]{12}\.\w+$")
MANIFEST = "files.json"


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


def _put(stem: str, ext: str, raw: bytes) -> str:
    """내용 해시를 이름에 단 파일(같은 내용이면 그대로 둔다)."""
    name = f"{stem}.{hashlib.sha256(raw).hexdigest()[:12]}{ext}"
    if not (MAP_DIR / name).is_file():
        atomic_write_bytes(MAP_DIR / name, raw)
    return name


def _json(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def split_points(data: dict) -> tuple[dict, dict]:
    """지도 자료 → (첫 화면 자료, 나중 자료). 나중 자료는 필드마다 점 순서의 배열(이웃 점수는 화면처럼 소수 둘째 자리)."""
    points = data.get("points") or []
    core = {**data, "points": [{k: v for k, v in p.items() if k not in DETAIL} for p in points]}
    detail = {
        "ct": [p.get("ct") or "" for p in points],
        "ns": [[round(float(s), 2) for s in p.get("ns") or []] for p in points],
        "nn": [p.get("nn") or [] for p in points],
        "an": [p.get("an") for p in points],
    }
    return core, detail


def render(data: dict) -> None:
    """지도 페이지: 해시 이름의 자료·web 파일과 그 이름을 담은 index.html. 지난번과 이번 것이 아닌 해시 파일은 지운다
    (지난번 것은 남겨 둔다: 이미 열려 있는 지도가 처음 검색할 때 옛 이름을 부른다)."""
    MAP_DIR.mkdir(parents=True, exist_ok=True)
    core, detail = split_points(data)
    files = {"points.json": _put("points", ".json", _json(core)), "detail.json": _put("detail", ".json", _json(detail))}
    for name in WEB_FILES + SEARCH_FILES:
        src = (WEB_DIR if name in WEB_FILES else MAP_DIR) / name
        if src.is_file():
            stem, ext = name.rsplit(".", 1)
            files[name] = _put(stem, "." + ext, src.read_bytes())
    body = json.dumps(files, ensure_ascii=False, separators=(",", ":"))
    html = (WEB_DIR / "map3d_template.html").read_text(encoding="utf-8").replace("__FILES__", body)
    atomic_write_bytes(MAP_DIR / "index.html", html.encode("utf-8"))

    manifest = MAP_DIR / MANIFEST
    try:
        previous = json.loads(manifest.read_text(encoding="utf-8")).get("files") or {}
    except (OSError, ValueError, AttributeError):
        previous = {}
    keep = set(files.values()) | {v for v in previous.values() if isinstance(v, str)}
    for path in MAP_DIR.iterdir():
        if HASHED.match(path.name) and path.name not in keep and path.is_file():
            path.unlink()
    atomic_write_json(manifest, {"files": files})


def rerender() -> int:
    """`python -m musike_analysis map`: 계산 없이 지금 map_points.json 으로 지도 페이지만 다시 쓴다."""
    path = MAP_DIR / "map_points.json"
    if not path.is_file():
        log(f"지도 자료가 없습니다(먼저 update): {path}")
        return 1
    data = json.loads(path.read_text(encoding="utf-8"))
    render(data)
    log(f"지도 페이지 다시 씀: {MAP_DIR / 'index.html'} ({len(data.get('points') or [])}곡)")
    return 0


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
    atomic_write_json(MAP_DIR / "map_points.json", data)

    # 의미 검색 곡 벡터: 줄 순서 = 점 순서(검색 항목은 브라우저가 지도 점에서 만든다)
    atomic_write_bytes(MAP_DIR / "vectors_e5.bin", int8_bytes(tmat))
    render(data)  # 검색 자료까지 쓴 뒤: 해시 이름 사본을 같이 만든다

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
