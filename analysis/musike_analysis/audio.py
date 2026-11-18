"""소리: 곡마다 30초 조각 → MuQ-MuLan 오디오 벡터(512).

조각은 <작업 폴더>/clips/<곡 번호>.opus (24kHz 모노). 이미 있으면 받지 않는다.
- 유튜브 곡: yt-dlp 로 영상 길이의 35% 지점부터 30초(구간 받기가 안 되면 전체를 받아 자른다).
- 내 파일 곡: Musike 의 소리 주소(`/api/stream/<id>/audio`)에서 곡 가운데 30초. 앨범 파일을 나눈 곡·영상 파일은
  서버가 `?t=` 부터 잘라 주는 "offset" 방식이라 `?t=` 로, 보통 소리 파일은 그대로 받으며 ffmpeg 가 건너뛴다.
실패는 clips_failed.json 에 사유와 함께 남긴다. 다시 안 되는 사유(삭제·비공개·저작권 …)는 다시 받지 않고,
그 밖의 사유는 7일 뒤 한 번 더 해 본다.
"""

from __future__ import annotations

import shutil
import subprocess
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np

from . import songs as songs_api
from .config import AUDIO_PATH, CLIP_DIR, CLIP_FAILED_PATH, MUSIKE_URL, TMP_DIR
from .util import atomic_write_json, load_json, log, now_iso
from .vectors import load_table, save_table

MODEL = "OpenMuQ/MuQ-MuLan-large"
DIM = 512
SAMPLE_RATE = 24000
CLIP_SECONDS = 30.0
PERMANENT = {"비공개", "삭제/사용 불가", "저작권", "지역 제한", "멤버십 전용", "연령 제한"}
RETRY_AFTER = timedelta(days=7)


class FetchError(RuntimeError):
    def __init__(self, reason: str, message: str = ""):
        super().__init__(message or reason)
        self.reason = reason
        self.message = message or reason


def tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"{name} 이(가) PATH 에 없습니다")
    return path


def clip_path(song_id: str) -> Path:
    return CLIP_DIR / f"{song_id}.opus"


def has_clip(song_id: str) -> bool:
    p = clip_path(song_id)
    return p.exists() and p.stat().st_size > 2000


def _run(cmd: list[str], timeout: float = 180) -> tuple[int, str, str]:
    try:
        proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout {timeout}s"


def _reason(stderr: str, code: int) -> str:
    text = (stderr or "").lower()
    if code == 139 or "exited with code -11" in text:
        return "ffmpeg-network"
    if "private video" in text:
        return "비공개"
    if "members-only" in text or "join this channel" in text or "premium members" in text:
        return "멤버십 전용"
    if "age" in text and ("confirm" in text or "restrict" in text):
        return "연령 제한"
    if "sign in" in text or "not a bot" in text or "cookies" in text:
        return "로그인/봇 확인"
    if "not available in your country" in text or "geo" in text:
        return "지역 제한"
    if "copyright" in text:
        return "저작권"
    if "video unavailable" in text or "has been removed" in text or "does not exist" in text:
        return "삭제/사용 불가"
    if code == 124:
        return "시간 초과"
    if "ffmpeg" in text:
        return "ffmpeg"
    return "기타"


def _last_line(text: str) -> str:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    for line in reversed(lines):
        if line.startswith("ERROR:"):
            return line[:300]
    return (lines[-1] if lines else "")[:300]


def clip_window(duration: float, at: float) -> tuple[float, float]:
    """길이의 at(0~1) 지점 둘레 30초 창. 짧으면 전체. (시작, 길이)"""
    d = float(duration or 0)
    if d <= 0:
        return 0.0, CLIP_SECONDS
    length = min(CLIP_SECONDS, d)
    start = min(max(d * at, 0.0), max(0.0, d - length))
    return round(start, 3), round(length, 3)


def _encode(src: str, out_path: Path, start: float | None, length: float, timeout: float = 240) -> None:
    """ffmpeg: src(파일·주소)의 start 부터 length 초 → 24kHz 모노 opus. 임시 파일 → rename."""
    tmp = out_path.with_name(out_path.stem + ".tmp.opus")
    cmd = [tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
    if start:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", src, "-t", f"{length:.3f}", "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "libopus", "-b:a", "48k", str(tmp)]
    code, _, err = _run(cmd, timeout=timeout)
    if code != 0 or not tmp.exists() or tmp.stat().st_size < 2000:
        tmp.unlink(missing_ok=True)
        raise FetchError(_reason(err, code) if code == 124 else "ffmpeg", _last_line(err) or f"code {code}")
    tmp.replace(out_path)


# ---------------------------------------------------------------- 유튜브


class Pacer:
    """유튜브 요청 사이 최소 간격(예의)."""

    def __init__(self, gap: float = 1.5):
        self.gap = gap
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            if self.next_at > now:
                time.sleep(self.next_at - now)
                now = time.monotonic()
            self.next_at = max(now, self.next_at) + self.gap


def _ytdlp(args: list[str], pacer: Pacer, timeout: float) -> str:
    pacer.wait()
    code, out, err = _run([tool("yt-dlp"), "--no-warnings", "--no-playlist", *args], timeout=timeout)
    if code != 0:
        raise FetchError(_reason(err, code), _last_line(err))
    return out


def _media(folder: Path) -> Path:
    files = [p for p in folder.iterdir() if p.is_file() and not p.name.endswith((".part", ".ytdl", ".tmp"))]
    if not files:
        raise FetchError("빈 파일", "받은 파일 없음")
    return max(files, key=lambda p: p.stat().st_size)


def fetch_youtube(song: dict, pacer: Pacer) -> None:
    vid = song["id"]
    url = f"https://www.youtube.com/watch?v={vid}"
    work = TMP_DIR / vid
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    try:
        raw = (_ytdlp(["--skip-download", "--print", "%(duration)s", url], pacer, 90).strip().splitlines() or ["0"])[-1]
        duration = float(raw) if raw.replace(".", "", 1).isdigit() else float(song.get("duration") or 0)
        start, length = clip_window(duration, 0.35)
        try:
            _ytdlp(["-f", "bestaudio/best", "--download-sections", f"*{start:.3f}-{start + length:.3f}",
                    "--ffmpeg-location", tool("ffmpeg"), "--no-part", "-o", str(work / "section.%(ext)s"), url], pacer, 240)
            _encode(str(_media(work)), clip_path(vid), None, length)
        except FetchError as exc:
            if exc.reason in PERMANENT:
                raise
            log(f"{vid}: 구간 받기 실패({exc.reason}) → 전체 받아 자름")
            for p in work.iterdir():
                p.unlink()
            _ytdlp(["-f", "worstaudio[abr<=70]/worstaudio/bestaudio", "--no-part", "-o", str(work / "full.%(ext)s"), url], pacer, 300)
            _encode(str(_media(work)), clip_path(vid), start, length)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---------------------------------------------------------------- 내 파일


def fetch_local(song: dict) -> None:
    """Musike 소리 주소에서 곡 가운데 30초."""
    sid = song["id"]
    info = songs_api.api(f"/api/prepare/{sid}", method="POST")
    start, length = clip_window(float(info.get("duration") or song.get("duration") or 0), 0.5)
    src = f"{MUSIKE_URL}/api/stream/{urllib.parse.quote(sid)}/audio"
    if info.get("audioMode") == "offset":
        # 서버가 ?t= 부터 잘라 보낸다
        _encode(f"{src}?t={start:.3f}", clip_path(sid), None, length)
    else:
        _encode(src, clip_path(sid), start, length)


# ---------------------------------------------------------------- 받기


def _skip_failed(entry: dict | None, retry_failed: bool) -> bool:
    if not entry or retry_failed:
        return False
    if entry.get("reason") in PERMANENT:
        return True
    try:
        at = datetime.fromisoformat(entry.get("at") or "")
    except ValueError:
        return False
    return datetime.now(UTC) - at < RETRY_AFTER


def fetch(songs: list[dict], have: set[str], retry_failed: bool = False, limit: int | None = None) -> dict:
    """소리 벡터도 조각도 없는 곡만 받는다."""
    failed = load_json(CLIP_FAILED_PATH) or {}
    todo = [s for s in songs if s["id"] not in have and not has_clip(s["id"]) and not s.get("unavailable")
            and not _skip_failed(failed.get(s["id"]), retry_failed)]
    if limit:
        todo = todo[:limit]
    yt = [s for s in todo if s["source"] == "youtube"]
    loc = [s for s in todo if s["source"] == "local"]
    log(f"소리 조각: 이번 {len(todo)}곡 (유튜브 {len(yt)} · 내 파일 {len(loc)})")
    stats = {"todo": len(todo), "ok": 0, "failed": 0}
    if not todo:
        return stats
    pacer = Pacer(1.5)
    lock = threading.Lock()

    def work(song: dict):
        try:
            fetch_youtube(song, pacer) if song["source"] == "youtube" else fetch_local(song)
            return song["id"], None
        except FetchError as exc:
            return song["id"], exc
        except Exception as exc:  # noqa: BLE001 - 실패는 곡별로 남긴다
            return song["id"], FetchError("기타", f"{type(exc).__name__}: {exc}"[:300])

    def drain(pool_songs: list[dict], workers: int):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(work, s) for s in pool_songs]
            for fut in as_completed(futures):
                sid, err = fut.result()
                with lock:
                    if err is None:
                        stats["ok"] += 1
                        failed.pop(sid, None)
                    else:
                        stats["failed"] += 1
                        failed[sid] = {"reason": err.reason, "message": err.message, "at": now_iso()}
                    done = stats["ok"] + stats["failed"]
                    if done % 20 == 0 or done == len(todo):
                        atomic_write_json(CLIP_FAILED_PATH, failed, indent=1)
                        log(f"소리 조각 {done}/{len(todo)} · 성공 {stats['ok']} · 실패 {stats['failed']}")

    try:
        # 유튜브는 예의상 둘, 내 파일은 이 PC 서버라 셋
        threads = [threading.Thread(target=drain, args=(yt, 2)), threading.Thread(target=drain, args=(loc, 3))]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    finally:
        atomic_write_json(CLIP_FAILED_PATH, failed, indent=1)
    return stats


# ---------------------------------------------------------------- MuQ-MuLan

_model = None


def model():
    """(MuQMuLan, device). 한 번만 올린다(소리 개념 색인도 같은 모델의 글 인코더를 쓴다)."""
    global _model
    if _model is None:
        import torch
        from muq import MuQMuLan

        device = "cuda" if torch.cuda.is_available() else "cpu"
        m = MuQMuLan.from_pretrained(MODEL).to(device).eval()
        log(f"소리 모델: {MODEL} ({device})")
        _model = (m, device)
    return _model


def _read_clip(path: Path) -> np.ndarray:
    """ffmpeg 로 24kHz 모노 float32 로 풀기(libsndfile 이 못 읽는 opus 도 읽는다)."""
    proc = subprocess.run(
        [tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60,
    )
    wav = np.frombuffer(proc.stdout, dtype="<f4")
    if proc.returncode != 0 or wav.size < SAMPLE_RATE:
        raise FetchError("ffmpeg", _last_line(proc.stderr.decode("utf-8", "replace")) or "빈 소리")
    return np.ascontiguousarray(wav, dtype=np.float32)


def encode_texts(texts: list[str], batch: int = 32) -> np.ndarray:
    """MuQ-MuLan 글 인코더(소리와 같은 공간)."""
    import torch

    m, _ = model()
    out = []
    for i in range(0, len(texts), batch):
        with torch.no_grad():
            out.append(m(texts=texts[i : i + batch]).float().cpu().numpy())
    return np.concatenate(out) if out else np.zeros((0, DIM), dtype=np.float32)


def embed(ids: list[str], table: dict[str, dict]) -> int:
    """조각은 있는데 벡터가 없는 곡만. table 을 고치고 저장한다. 새로 만든 수."""
    import torch

    todo = [sid for sid in ids if sid not in table and has_clip(sid)]
    log(f"소리 벡터: 이번 {len(todo)}곡 ({MODEL})")
    if not todo:
        return 0
    m, device = model()
    done = 0
    for i in range(0, len(todo), 4):
        chunk = todo[i : i + 4]
        wavs = []
        for sid in chunk:
            try:
                wavs.append(_read_clip(clip_path(sid)))
            except Exception as exc:  # noqa: BLE001 - 깨진 조각은 지우고 다음에 다시 받는다
                log(f"{sid}: 조각을 읽지 못해 지움({exc})")
                clip_path(sid).unlink(missing_ok=True)
                wavs.append(None)
        pairs = [(sid, w) for sid, w in zip(chunk, wavs) if w is not None]
        if not pairs:
            continue
        arr = np.zeros((len(pairs), max(len(w) for _, w in pairs)), dtype=np.float32)
        for j, (_, w) in enumerate(pairs):
            arr[j, : len(w)] = w
        with torch.no_grad():
            emb = m(wavs=torch.from_numpy(arr).to(device)).float().cpu().numpy()
        for (sid, _), vec in zip(pairs, emb):
            if np.isfinite(vec).all():
                table[sid] = {"vector": vec.astype(np.float32), "hash": "", "model": MODEL}
                done += 1
        if (i // 4 + 1) % 50 == 0:
            log(f"소리 벡터 {done}/{len(todo)}")
            save_table(AUDIO_PATH, table)
    save_table(AUDIO_PATH, table)
    return done


def run(songs: list[dict], retry_failed: bool = False, fetch_limit: int | None = None) -> tuple[dict[str, np.ndarray], dict]:
    """빠진 곡만 조각 받기 → 벡터. (곡 번호 → 벡터, 통계)"""
    table = load_table(AUDIO_PATH)
    stats = {"fetch": fetch(songs, set(table), retry_failed, fetch_limit)}
    stats["embedded"] = embed([s["id"] for s in songs], table)
    ids = {s["id"] for s in songs}
    return {sid: rec["vector"] for sid, rec in table.items() if sid in ids}, stats


def load_vectors(songs: list[dict]) -> dict[str, np.ndarray]:
    ids = {s["id"] for s in songs}
    return {sid: rec["vector"] for sid, rec in load_table(AUDIO_PATH).items() if sid in ids}
