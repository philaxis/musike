"""python -m musike_analysis <명령>

  update   곡 상자를 읽어 새 곡만 카드·벡터를 만들고 taste.json·지도를 다시 쓴다
  map      계산 없이 지금 map/map_points.json 으로 지도 페이지(index.html·web 파일)만 다시 쓴다
  status   마지막 실행 결과(state.json)
"""

from __future__ import annotations

import argparse
import json
import sys

from .config import STATE_PATH
from .util import load_json


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m musike_analysis", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    up = sub.add_parser("update", help="새 곡만 분석하고 결과를 다시 쓴다")
    up.add_argument("--max-cost", type=float, default=1.0, help="이번 실행 Gemini 비용 상한(달러, 기본 1)")
    up.add_argument("--no-audio", dest="audio", action="store_false", help="소리 조각·벡터·소리 색인을 건너뛴다(GPU 안 씀)")
    up.add_argument("--no-map", dest="map", action="store_false", help="3D 지도·소리 색인을 만들지 않는다")
    up.add_argument("--regroup", action="store_true", help="소리 묶음을 번호·이름까지 새로 나눈다")
    up.add_argument("--retry-failed", action="store_true", help="전에 못 받은 소리 조각도 다시 받아 본다")
    up.add_argument("--fetch-limit", type=int, help="이번에 받을 소리 조각 수 상한")
    sub.add_parser("map", help="지도 페이지만 다시 쓴다(웹 파일을 고친 뒤, MUSIKE_ANALYSIS_DIR 로 시험 폴더)")
    sub.add_parser("status", help="마지막 실행 결과")
    args = ap.parse_args(argv)
    if args.cmd == "update":
        from . import update

        return update.main(args)
    if args.cmd == "map":
        from . import mapbuild

        return mapbuild.rerender()
    print(json.dumps(load_json(STATE_PATH) or {}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
