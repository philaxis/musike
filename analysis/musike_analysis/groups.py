"""큰 갈래와 소리 묶음.

- 큰 갈래 = 카드 장르. 25곡 미만 장르는 '기타'.
- 소리 묶음 = 큰 갈래 안에서 소리 벡터 k-means(k ≈ 소리 있는 곡 / 150, 1~8). 소리 벡터 없는 곡은 글 벡터로 가장 가까운
  묶음에. 25곡 미만 묶음은 '<갈래>·etc'('그 밖의 <갈래>')로 모은다.
- 이름 = 세부 장르 상위 2개('재즈퓨전 · 모던재즈'). 이름이 겹치면 대표 아티스트를 붙인다.
- 번호·이름은 groups.json 에 두고 다음 실행에서 이어 쓴다: 전에 묶음이 있던 곡은 그대로, 새 곡만 가장 가까운 묶음(같은 갈래)에.
  갈래가 새로 생겼거나 그 갈래 곡이 하나도 남지 않았으면 그 갈래만 새로 나눈다. `--regroup` 은 전부 새로.
"""

from __future__ import annotations

import collections

import numpy as np

from .config import GROUPS_PATH
from .util import atomic_write_json, load_json, now_iso
from .vectors import unit

MIN_GENRE = 25
MIN_GROUP = 25
PER_GROUP = 150
MAX_K = 8
OTHER = "기타"
SEED = 42


def genres_of(cards: dict[str, dict]) -> dict[str, str]:
    raw = {sid: c.get("genre") or OTHER for sid, c in cards.items()}
    counts = collections.Counter(raw.values())
    return {sid: g if counts[g] >= MIN_GENRE else OTHER for sid, g in raw.items()}


def _centroids(members: dict[str, list[str]], vecs: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    out = {}
    for gid, ids in members.items():
        have = [vecs[i] for i in ids if i in vecs]
        if have:
            c = np.mean(unit(np.stack(have)), axis=0)
            out[gid] = c / (np.linalg.norm(c) + 1e-12)
    return out


def _nearest(sid: str, candidates: list[str], members: dict[str, list[str]], audio: dict, text: dict) -> str:
    """소리 벡터가 있으면 소리 중심, 없으면 글 중심이 가장 가까운 묶음."""
    for vecs in (audio, text):
        if sid not in vecs:
            continue
        cents = _centroids({g: members[g] for g in candidates}, vecs)
        if cents:
            v = vecs[sid] / (np.linalg.norm(vecs[sid]) + 1e-12)
            return max(cents, key=lambda g: float(cents[g] @ v))
    return max(candidates, key=lambda g: len(members[g]))


def _fresh(genre: str, ids: list[str], audio: dict, text: dict) -> dict[str, list[str]]:
    """한 갈래를 새로 나눈다: 소리 k-means → 소리 없는 곡은 글로 → 작은 묶음은 etc. {묶음 id: 곡들}"""
    with_audio = [i for i in ids if i in audio]
    k = max(1, min(MAX_K, round(len(with_audio) / PER_GROUP)))
    if len(with_audio) >= 2 * MIN_GROUP and k > 1:
        from sklearn.cluster import KMeans

        labels = KMeans(n_clusters=k, n_init=10, random_state=SEED).fit_predict(unit(np.stack([audio[i] for i in with_audio])))
        clusters = [[i for i, lab in zip(with_audio, labels) if lab == c] for c in range(k)]
    else:
        clusters = [with_audio] if with_audio else [[]]
    clusters.sort(key=len, reverse=True)
    members = {f"{genre}·{n}": list(c) for n, c in enumerate(clusters, 1)}
    rest = [i for i in ids if i not in audio]
    names = list(members)
    for sid in rest:
        members[_nearest(sid, names, members, {}, text) if any(members.values()) else names[0]].append(sid)
    return _fold_small(genre, members)


def _fold_small(genre: str, members: dict[str, list[str]]) -> dict[str, list[str]]:
    etc = f"{genre}·etc"
    out: dict[str, list[str]] = {}
    for gid, ids in members.items():
        if not ids:
            continue
        if len(ids) < MIN_GROUP and gid != etc:
            out.setdefault(etc, []).extend(ids)
        else:
            out.setdefault(gid, []).extend(ids)
    # 갈래 전체가 작아 etc 하나만 남았으면 번호 묶음으로 둔다
    if list(out) == [etc] and len(members) == 1:
        return {f"{genre}·1": out[etc]}
    return out


def _subgenre_name(ids: list[str], cards: dict[str, dict]) -> str | None:
    counts: collections.Counter = collections.Counter()
    spelled: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for i in ids:
        sub = (cards[i].get("subgenre") or "").strip()
        if sub:
            key = sub.replace(" ", "").casefold()
            counts[key] += 1
            spelled[key][sub.replace(" ", "")] += 1
    top = [spelled[k].most_common(1)[0][0] for k, _ in counts.most_common(2)]
    return " · ".join(top) or None


def _artists(ids: list[str], cards: dict[str, dict]) -> list[str]:
    return [a for a, _ in collections.Counter(cards[i].get("artist") for i in ids if cards[i].get("artist")).most_common()]


def _name_new(new: dict[str, list[str]], genre_of_group: dict[str, str], taken: dict[str, str], cards: dict[str, dict]) -> dict[str, str]:
    """새 묶음 이름. taken = 이미 있는 묶음 id → 이름(바꾸지 않는다)."""
    names: dict[str, str] = {}
    for gid, ids in new.items():
        genre = genre_of_group[gid]
        names[gid] = f"그 밖의 {genre}" if gid.endswith("·etc") else (_subgenre_name(ids, cards) or genre)
    used = collections.Counter(list(taken.values()) + list(names.values()))
    for base in [n for n, c in used.items() if c > 1]:
        clash = [g for g, n in names.items() if n == base]
        others: set = set()
        for gid in clash:
            pick = next((a for a in _artists(new[gid], cards) if a not in others), None)
            others.add(pick)
            names[gid] = f"{base} ({pick})" if pick else f"{base} {gid.rsplit('·', 1)[-1]}"
    return names


def assign(cards: dict[str, dict], audio: dict[str, np.ndarray], text: dict[str, np.ndarray], regroup: bool = False) -> tuple[dict[str, str], dict[str, str], list[dict]]:
    """(곡 → 큰 갈래, 곡 → 묶음 id, 묶음 목록[{id, genre, name, size}]). groups.json 을 고친다."""
    genre = genres_of(cards)
    state = {} if regroup else (load_json(GROUPS_PATH) or {})
    saved_assign: dict[str, str] = state.get("assign") or {}
    saved_groups = {g["id"]: g for g in state.get("groups") or []}

    by_genre: dict[str, list[str]] = collections.defaultdict(list)
    for sid in cards:
        by_genre[genre[sid]].append(sid)

    members: dict[str, list[str]] = {}
    genre_of_group: dict[str, str] = {}
    fresh: dict[str, list[str]] = {}
    for g, ids in by_genre.items():
        kept: dict[str, list[str]] = collections.defaultdict(list)
        new = []
        for sid in ids:
            gid = saved_assign.get(sid)
            if gid in saved_groups and saved_groups[gid]["genre"] == g:
                kept[gid].append(sid)
            else:
                new.append(sid)
        if not kept:
            made = _fresh(g, ids, audio, text)
            fresh.update(made)
            members.update(made)
        else:
            candidates = list(kept)
            for sid in new:
                kept[_nearest(sid, candidates, kept, audio, text)].append(sid)
            members.update(kept)
        for gid in members:
            genre_of_group.setdefault(gid, g)

    names = {gid: saved_groups[gid]["name"] for gid in members if gid in saved_groups and gid not in fresh}
    names.update(_name_new(fresh, genre_of_group, names, cards))

    song_group = {sid: gid for gid, ids in members.items() for sid in ids}
    order = sorted(members, key=lambda gid: (-len(by_genre[genre_of_group[gid]]), genre_of_group[gid], gid.endswith("·etc"), -len(members[gid])))
    groups = [{"id": gid, "genre": genre_of_group[gid], "name": names[gid], "size": len(members[gid])} for gid in order]
    atomic_write_json(
        GROUPS_PATH,
        {"version": 1, "at": now_iso(), "groups": [{k: g[k] for k in ("id", "genre", "name")} for g in groups], "assign": song_group},
        indent=0,
    )
    return genre, song_group, groups
