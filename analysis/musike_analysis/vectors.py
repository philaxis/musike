"""벡터 캐시 parquet: id · vector(float32 목록) · hash · model. 임시 파일 → rename."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .util import tmp_path


def load_table(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    import pyarrow.parquet as pq

    out = {}
    for row in pq.read_table(path).to_pylist():
        vec = np.asarray(row["vector"], dtype=np.float32)
        if vec.ndim == 1 and vec.size and np.isfinite(vec).all():
            out[str(row["id"])] = {"vector": vec, "hash": row.get("hash") or "", "model": row.get("model") or ""}
    return out


def save_table(path: Path, records: dict[str, dict]) -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq

    ids = sorted(records)
    table = pa.table(
        {
            "id": pa.array(ids, pa.string()),
            "vector": pa.array([np.asarray(records[i]["vector"], dtype=np.float32) for i in ids], pa.list_(pa.float32())),
            "hash": pa.array([records[i].get("hash") or "" for i in ids], pa.string()),
            "model": pa.array([records[i].get("model") or "" for i in ids], pa.string()),
        }
    )
    tmp = tmp_path(path)
    pq.write_table(table, tmp, compression="zstd")
    tmp.replace(path)


def unit(mat: np.ndarray) -> np.ndarray:
    mat = np.asarray(mat, dtype=np.float32)
    if mat.size == 0:
        return mat
    return mat / (np.linalg.norm(mat, axis=1, keepdims=True) + 1e-12)
