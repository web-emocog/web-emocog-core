from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, Any, Optional
import json

@dataclass(frozen=True)
class TaskBounds:
    min_rt_ms: int
    max_rt_ms: int
    timeout_ms: int

@dataclass(frozen=True)
class FlagsThresholds:
    attention_cv_threshold: float = 0.30
    attention_omission_threshold: float = 0.10
    attention_lapse_threshold: float = 0.10
    lapse_ms: int = 500
    aggressive_fast_mean_ms: int = 320
    aggressive_error_rate_threshold: float = 0.20
    aggressive_commission_threshold: float = 0.20
    aggressive_wrong_threshold: float = 0.20
    aggressive_anticipation_threshold: float = 0.05
    many_anticipations_threshold: float = 0.10
    pes_min_delta_ms: int = 20
    pes_min_ratio: float = 0.10
    fatigue_slope_ms_per_trial: float = 1.0
    fatigue_delta_ms: int = 30
    conservative_slow_mean_ms: int = 600
    conservative_error_rate_max: float = 0.10
    conservative_omission_min: float = 0.10

@dataclass(frozen=True)
class AnalysisCfg:
    premature_window_ms: int = 200

@dataclass(frozen=True)
class ProjectConfig:
    task_bounds: Dict[str, TaskBounds]
    flags_thresholds: FlagsThresholds
    analysis: AnalysisCfg
    use_loglinear_correction: bool = True

    @staticmethod
    def load(path: Optional[str]) -> "ProjectConfig":
        data: Dict[str, Any] = {}
        if path:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        default_tb = {
            "simple": {"min_rt_ms": 100, "max_rt_ms": 2000, "timeout_ms": 2500},
            "choice": {"min_rt_ms": 150, "max_rt_ms": 2000, "timeout_ms": 2500},
            "go_nogo": {"min_rt_ms": 100, "max_rt_ms": 1500, "timeout_ms": 2000},
            "stroop": {"min_rt_ms": 200, "max_rt_ms": 3000, "timeout_ms": 3500},
            "pvt": {"min_rt_ms": 100, "max_rt_ms": 5000, "timeout_ms": 5000},
            "cpt": {"min_rt_ms": 100, "max_rt_ms": 2000, "timeout_ms": 2000},
        }
        merged = {**default_tb, **data.get("task_bounds", {})}
        task_bounds = {k: TaskBounds(**v) for k,v in merged.items()}
        ft_raw = data.get("flags_thresholds", {})
        flags_thresholds = FlagsThresholds(**{**FlagsThresholds().__dict__, **ft_raw})
        an_raw = data.get("analysis", {})
        analysis = AnalysisCfg(**{**AnalysisCfg().__dict__, **an_raw})
        use_loglinear = bool(data.get("dprime", {}).get("use_loglinear_correction", True))
        return ProjectConfig(task_bounds=task_bounds, flags_thresholds=flags_thresholds, analysis=analysis, use_loglinear_correction=use_loglinear)
