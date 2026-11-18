"""입출력·로그 도우미. 파일은 모두 임시 파일 → rename 으로 쓴다."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

BUSY = 75  # EX_TEMPFAIL: 다른 실행이 lock 을 잡고 있음


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def clean(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"none", "null", "nan"} else text


def load_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def tmp_path(path: Path) -> Path:
    return path.with_name(f".{path.name}.{os.getpid()}.tmp")


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = tmp_path(path)
    tmp.write_bytes(data)
    tmp.replace(path)


def atomic_write_json(path: Path, obj, indent: int | None = None) -> None:
    sep = (",", ":") if indent is None else None
    atomic_write_bytes(path, json.dumps(obj, ensure_ascii=False, indent=indent, separators=sep).encode("utf-8"))


class Lock:
    """flock: 동시 실행 막기. 프로세스가 끝나면 저절로 풀린다."""

    def __init__(self, path: Path):
        self.path = path
        self.fh = None

    def acquire(self) -> bool:
        self.fh = open(self.path, "a+")
        try:
            fcntl.flock(self.fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.fh.close()
            self.fh = None
            return False
        return True

    def release(self) -> None:
        if self.fh:
            fcntl.flock(self.fh, fcntl.LOCK_UN)
            self.fh.close()
            self.fh = None
