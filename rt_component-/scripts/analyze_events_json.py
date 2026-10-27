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


def analyze(data: dict, cfg: ProjectConfig) -> dict:
    events = data.get("events") or []
    task = data.get("task") or "simple"
    trials, meta = build_trials_from_events(events, task, cfg)
    metrics = compute_metrics(trials, task, cfg)
    return {"meta": meta, "metrics": metrics, "n_trials": len(trials)}


def main() -> int:
    data = json.load(sys.stdin)
    cfg = ProjectConfig.load(data.get("config_path"))
    # Preserve the single-job CLI contract for existing integrations and tests.
    if "jobs" in data:
        result = {"jobs": [analyze(job, cfg) for job in data["jobs"]]}
    else:
        result = analyze(data, cfg)
    json.dump(result, sys.stdout, ensure_ascii=False, allow_nan=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
