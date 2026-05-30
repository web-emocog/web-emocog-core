"""Stdin JSON -> stdout JSON metrics (uses rt_mvp analyzer without changing formulas)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from rt_mvp.analyzer import build_trials_from_events, compute_metrics
from rt_mvp.config import ProjectConfig


def main() -> int:
    data = json.load(sys.stdin)
    events = data.get("events") or []
    task = data.get("task") or "simple"
    config_path = data.get("config_path")
    cfg = ProjectConfig.load(config_path)
    trials, meta = build_trials_from_events(events, task, cfg)
    metrics = compute_metrics(trials, task, cfg)
    json.dump(
        {
            "meta": meta,
            "metrics": metrics,
            "n_trials": len(trials),
        },
        sys.stdout,
        ensure_ascii=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
