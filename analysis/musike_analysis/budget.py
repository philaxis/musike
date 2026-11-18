"""Gemini 비용: 한 번 실행당 상한과 누적 기록(costs.json, 키·프롬프트 없음)."""

from __future__ import annotations

import threading

from .config import COSTS_PATH
from .util import atomic_write_json, load_json, now_iso

_lock = threading.Lock()
_limit: float | None = None
_spent = 0.0


class BudgetExceeded(RuntimeError):
    pass


def start(limit: float | None) -> None:
    global _limit, _spent
    with _lock:
        _limit = float(limit) if limit and float(limit) > 0 else None
        _spent = 0.0


def spent() -> float:
    with _lock:
        return _spent


def check() -> None:
    with _lock:
        if _limit is not None and _spent >= _limit:
            raise BudgetExceeded(f"이번 실행 비용 상한 ${_limit:.2f} 도달(사용 ${_spent:.3f})")


def charge(inp: int, out: int, price_in_per_m: float, price_out_per_m: float, command: str) -> float:
    """토큰 비용을 이번 실행 합계와 costs.json 누적에 더한다."""
    global _spent
    usd = (inp or 0) / 1e6 * price_in_per_m + (out or 0) / 1e6 * price_out_per_m
    with _lock:
        _spent += usd
        data = load_json(COSTS_PATH) or {}
        data["totalUsd"] = round(float(data.get("totalUsd") or 0.0) + usd, 6)
        runs = list(data.get("runs") or [])
        runs.append({"at": now_iso(), "command": command, "usd": round(usd, 6), "inputTokens": int(inp or 0), "outputTokens": int(out or 0)})
        data["runs"] = runs[-500:]
        atomic_write_json(COSTS_PATH, data, indent=1)
    return usd


def total() -> float:
    return round(float((load_json(COSTS_PATH) or {}).get("totalUsd") or 0.0), 6)
