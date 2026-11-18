"""경로와 설정. 결과(작음)는 MUSIKE_ANALYSIS_DIR, 큰 원본(소리 조각·카드·parquet)은 하드의 MUSIKE_ANALYSIS_WORK 에만 둔다."""

from __future__ import annotations

import os
from pathlib import Path

MUSIKE_URL = (os.environ.get("MUSIKE_URL") or "http://127.0.0.1:4180").rstrip("/")

OUT_DIR = Path(os.environ.get("MUSIKE_ANALYSIS_DIR") or Path.home() / ".local" / "share" / "musike" / "analysis")
MAP_DIR = OUT_DIR / "map"
API_DIR = MAP_DIR / "api"

# 서버 데이터 폴더(읽기만): 바꿔 넣은 영상의 옛 번호 → 지금 번호(서버 영상 기록이 씀).
DATA_DIR = Path(os.environ.get("MUSIKE_DATA_DIR") or Path.home() / ".local" / "share" / "musike" / "data")
ALIASES_PATH = DATA_DIR / "video-aliases.json"
WORK_DIR = Path(os.environ.get("MUSIKE_ANALYSIS_WORK") or "/mnt/backup8t/orca-data/musike/analysis")
CLIP_DIR = WORK_DIR / "clips"
CARD_DIR = WORK_DIR / "cards"
TMP_DIR = WORK_DIR / "tmp"
AUDIO_PATH = WORK_DIR / "audio.parquet"
TEXT_PATH = WORK_DIR / "text.parquet"
CLIP_FAILED_PATH = WORK_DIR / "clips_failed.json"
GROUPS_PATH = WORK_DIR / "groups.json"
COSTS_PATH = WORK_DIR / "costs.json"
STATE_PATH = WORK_DIR / "state.json"
LOCK_PATH = WORK_DIR / "update.lock"

KEY_PATH = Path.home() / ".config" / "book-db" / "gemini.key"


def require_work_dir() -> None:
    """작업 폴더의 부모(하드)가 없으면 멈춘다. 마운트가 빠진 빈 자리에 큰 파일을 쓰지 않으려고 부모는 만들지 않는다."""
    if not WORK_DIR.parent.is_dir():
        raise SystemExit(f"작업 폴더 자리가 없습니다(하드 마운트 확인): {WORK_DIR.parent}")
    for d in (WORK_DIR, CLIP_DIR, CARD_DIR, TMP_DIR):
        d.mkdir(exist_ok=True)


def read_key() -> str | None:
    """Gemini 키는 파일에서만 읽는다. 값은 출력·로그하지 않는다."""
    try:
        return KEY_PATH.read_text(encoding="utf-8").strip() or None
    except FileNotFoundError:
        return None
