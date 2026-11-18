"""곡 후보: Musike 곡 상자 전체(유튜브 곡 + 내 파일 곡, 숨긴 곡 제외)를 서버 API 로 읽는다.

`GET /api/box?cursor=N` 은 200곡씩 주고 `next` 가 null 이면 끝이다. 상자는 내 폴더 곡(가상으로 나눈 앨범 곡 포함)을
"local" 출처로 함께 보여 주므로 이것 하나로 후보가 다 모인다.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request

from .config import MUSIKE_URL

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
LOCAL_ID = re.compile(r"^L[A-Za-z0-9_-]{20}$")
GONE_TITLES = {"Deleted video", "Private video"}


def api(path: str, method: str = "GET", timeout: float = 60):
    req = urllib.request.Request(MUSIKE_URL + path, method=method, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def to_song(item: dict) -> dict | None:
    """상자 한 줄 → 후보 곡. 묶음·이상한 번호·지워진 영상은 뺀다."""
    t = item.get("track") or {}
    sid = str(t.get("id") or "")
    is_local = t.get("source") == "local"
    if t.get("kind") == "bundle" or not (LOCAL_ID.match(sid) if is_local else VIDEO_ID.match(sid)):
        return None
    if (t.get("title") or "").strip() in GONE_TITLES:
        return None
    sources = item.get("sources") or []
    return {
        "id": sid,
        "source": "local" if is_local else "youtube",
        "title": (t.get("title") or "").strip(),
        "artist": (t.get("artist") or "").strip(),
        "album": (t.get("album") or "").strip() or None,
        "year": t.get("year") or None,
        "duration": float(t.get("duration") or 0),
        "video": t.get("kind") == "video",
        "playlists": [s.get("name") or "" for s in sources if s.get("kind") in ("youtube-playlist", "local")],
        "liked": any(s.get("kind") == "youtube-liked" for s in sources),
        "inPlaylist": any(s.get("kind") in ("youtube-playlist", "local") for s in sources),
        "unavailable": bool(t.get("unavailable") or item.get("gone")),
    }


def load() -> list[dict]:
    """상자 순서(새 곡 먼저, 그다음 내 폴더) 그대로, 번호마다 한 곡."""
    out: list[dict] = []
    seen: set[str] = set()
    cursor: str | None = "0"
    while cursor is not None:
        page = api("/api/box?" + urllib.parse.urlencode({"cursor": cursor}))
        for item in page.get("items") or []:
            song = to_song(item)
            if song and song["id"] not in seen:
                seen.add(song["id"])
                out.append(song)
        cursor = page.get("next")
    return out
