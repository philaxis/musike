"""한 번에: 곡 후보 → 카드(새 곡만 Gemini) → 글 벡터 → 소리 조각·벡터(빠진 곡만) → 묶음 → taste.json → 소리 색인·지도."""

from __future__ import annotations

import json
import time

from . import audio, budget, cards, catalog, groups, mapbuild, songs as songs_api, soundsearch, taste, text
from .config import LOCK_PATH, OUT_DIR, STATE_PATH, require_work_dir
from .util import BUSY, Lock, atomic_write_json, log, now_iso
from .vectors import unit


def run(max_cost: float, with_audio: bool = True, with_map: bool = True, regroup: bool = False,
        retry_failed: bool = False, fetch_limit: int | None = None) -> dict:
    started = time.time()
    budget.start(max_cost)
    log(f"=== Musike 분석 시작 (Gemini 상한 ${max_cost:.2f}) ===")

    songs = songs_api.load()
    log(f"곡 후보: {len(songs)}곡 (유튜브 {sum(s['source'] == 'youtube' for s in songs)} · 내 파일 {sum(s['source'] == 'local' for s in songs)})")
    card_stats = cards.run(songs)
    by_id = {s["id"]: s for s in songs}
    music_cards = {s["id"]: c for s in songs if (c := cards.load(s["id"])) and c.get("is_music")}
    music = [s for s in songs if s["id"] in music_cards]
    order = [s["id"] for s in music]

    text_vecs, text_stats = text.run(music_cards)
    if with_audio:
        audio_vecs, audio_stats = audio.run(music, retry_failed=retry_failed, fetch_limit=fetch_limit)
    else:
        audio_vecs, audio_stats = audio.load_vectors(music), None

    genre, group, group_list = groups.assign(music_cards, audio_vecs, text_vecs, regroup=regroup)
    rows = []
    for sid in order:
        s, c = by_id[sid], music_cards[sid]
        album = (s.get("album") or c.get("album")) if s["source"] == "local" else (c.get("album") or s.get("album"))
        rows.append({"composer": c.get("composer"), "work": c.get("work"), "artist": c.get("artist") or s.get("artist"),
                     "album": album, "title": s.get("title") or c.get("title"), "genre": c.get("genre")})
    extra = dict(zip(order, catalog.annotate(rows)))
    doc, amat, tmat = taste.build(order, music_cards, extra, genre, group, group_list, audio_vecs, text_vecs)
    taste.write(doc, amat, tmat)
    log(f"taste.json: {len(order)}곡 · 소리 벡터 {len(amat)} · 글 벡터 {len(tmat)} → {OUT_DIR}")

    map_stats = sound_stats = None
    if with_map:
        tags = {}
        if with_audio:
            a_ids = [sid for sid in order if sid in audio_vecs]
            tags, sound_stats = soundsearch.build(a_ids, unit(amat), music_cards)
        map_stats = mapbuild.build(order, by_id, music_cards, extra, genre, group, group_list, text_vecs, audio_vecs, tags)

    stats = {
        "finishedAt": now_iso(),
        "seconds": round(time.time() - started, 1),
        "candidates": len(songs),
        "songs": len(order),
        "localSongs": sum(1 for sid in order if by_id[sid]["source"] == "local"),
        "audioRows": int(len(amat)),
        "textRows": int(len(tmat)),
        "groups": [f"{g['id']} {g['name']} ({g['size']})" for g in group_list],
        "cards": card_stats,
        "text": text_stats,
        "audio": audio_stats,
        "soundsearch": sound_stats,
        "map": map_stats,
        "costThisRun": round(budget.spent(), 4),
        "costTotal": budget.total(),
    }
    atomic_write_json(STATE_PATH, stats, indent=1)
    log(f"=== 끝: {stats['seconds']}초 · {stats['songs']}곡(내 파일 {stats['localSongs']}) · 소리 {stats['audioRows']} · Gemini ${stats['costThisRun']:.4f} ===")
    return stats


def main(args) -> int:
    require_work_dir()
    lock = Lock(LOCK_PATH)
    if not lock.acquire():
        log("다른 분석이 실행 중입니다(update.lock)")
        return BUSY
    try:
        stats = run(args.max_cost, with_audio=args.audio, with_map=args.map, regroup=args.regroup,
                    retry_failed=args.retry_failed, fetch_limit=args.fetch_limit)
    finally:
        lock.release()
    print(json.dumps({k: stats[k] for k in ("songs", "localSongs", "audioRows", "textRows", "costThisRun", "seconds")}, ensure_ascii=False))
    return 0
