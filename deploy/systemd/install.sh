#!/bin/sh
# Musike 취향 분석 타이머(매일 06:50)를 사용자 systemd 에 설치한다.
# 유닛은 본 저장소 ~/projects/musike/analysis 에서 돈다 — 이 브랜치를 main 에 합치고 본 저장소를 갱신한 뒤 실행한다.
# 파이썬 환경은 uv 가 analysis/.venv 에 만든다(uv.lock 그대로).
# 음악지도 유닛은 건드리지 않는다. 끌 때: systemctl --user disable --now music-map-watch.timer music-map-serve.service
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
analysis="$HOME/projects/musike/analysis"

if ! command -v uv >/dev/null 2>&1; then
    echo "uv 가 없습니다. 먼저 uv 를 설치하세요." >&2
    exit 1
fi
if [ ! -f "$analysis/pyproject.toml" ]; then
    echo "$analysis 가 없습니다. 본 저장소를 먼저 갱신하세요." >&2
    exit 1
fi
(cd "$analysis" && uv sync --frozen --no-dev)

dest="$HOME/.config/systemd/user"
mkdir -p "$dest"
cp "$here/musike-analysis.service" "$here/musike-analysis.timer" "$dest/"
systemctl --user daemon-reload
systemctl --user enable --now musike-analysis.timer
systemctl --user list-timers musike-analysis.timer
