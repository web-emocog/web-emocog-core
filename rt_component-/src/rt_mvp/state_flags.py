from __future__ import annotations
from typing import Any, Dict, List, TYPE_CHECKING
from .config import ProjectConfig

if TYPE_CHECKING:
    from .analyzer import TrialOutcome
from . import stats
def compute_post_error_slowing(trials: List[TrialOutcome]) -> Dict[str, Any]:
    after_error: List[float]=[]
    after_correct: List[float]=[]
    for i in range(1, len(trials)):
        cur=trials[i]; prev=trials[i-1]
        if not (cur.is_valid_rt and cur.rt_ms is not None):
            continue
        prev_is_error = (not prev.is_correct) and (prev.classification in ("wrong","commission","omission","timeout","anticipation"))
        if prev_is_error:
            after_error.append(float(cur.rt_ms))
        elif prev.is_correct:
            after_correct.append(float(cur.rt_ms))
    m_err=stats.mean(after_error); m_cor=stats.mean(after_correct)
    delta=(m_err-m_cor) if (m_err is not None and m_cor is not None) else None
    return {"after_error_n":len(after_error),"after_correct_n":len(after_correct),"after_error_mean_rt_ms":m_err,"after_correct_mean_rt_ms":m_cor,"delta_ms":delta}

def compute_state_flags(trials: List[TrialOutcome], metrics: Dict[str, Any], task: str, cfg: ProjectConfig) -> Dict[str, Any]:
    th=cfg.flags_thresholds
    rt=metrics.get("rt",{}); rates=metrics.get("rates",{}); counts=metrics.get("counts",{})
    mean_rt=rt.get("mean_rt_ms"); rt_cv=rt.get("rt_cv"); lapse_rate=rt.get("lapse_rate")
    omission_rate=rates.get("omission_rate"); commission_rate=rates.get("commission_error_rate")
    anticipation_rate=rates.get("anticipation_rate"); accuracy=rates.get("accuracy")
    total=counts.get("total_trials",0) or 0
    error_rate=(1.0-float(accuracy)) if (accuracy is not None and total) else None

    pes=compute_post_error_slowing(trials)
    slope=rt.get("rt_slope_ms_per_trial")

    valid_rts=[float(t.rt_ms) for t in trials if t.is_valid_rt and t.rt_ms is not None]
    fatigue={"slope":slope,"first_third_mean":None,"last_third_mean":None,"delta_ms":None}
    if len(valid_rts)>=6:
        k=len(valid_rts); a=max(1,k//3)
        mf=stats.mean(valid_rts[:a]); ml=stats.mean(valid_rts[-a:])
        fatigue["first_third_mean"]=mf; fatigue["last_third_mean"]=ml
        if mf is not None and ml is not None:
            fatigue["delta_ms"]=ml-mf

    attention=False; attention_reasons=[]
    if rt_cv is not None and rt_cv>=th.attention_cv_threshold:
        attention=True; attention_reasons.append(f"rt_cv={rt_cv:.3f}≥{th.attention_cv_threshold}")
    if omission_rate is not None and omission_rate>=th.attention_omission_threshold:
        attention=True; attention_reasons.append(f"omission_rate={omission_rate:.3f}≥{th.attention_omission_threshold}")
    if lapse_rate is not None and lapse_rate>=th.attention_lapse_threshold:
        attention=True; attention_reasons.append(f"lapse_rate={lapse_rate:.3f}≥{th.attention_lapse_threshold} (lapse>{th.lapse_ms}ms)")

    aggressive=False; aggressive_reasons=[]
    if mean_rt is not None and mean_rt<=th.aggressive_fast_mean_ms:
        if error_rate is not None and error_rate>=th.aggressive_error_rate_threshold:
            aggressive=True; aggressive_reasons.append("быстро + много ошибок")
        if commission_rate is not None and commission_rate>=th.aggressive_commission_threshold:
            aggressive=True; aggressive_reasons.append("быстро + много commission (No-Go)")
        if anticipation_rate is not None and anticipation_rate>=th.aggressive_anticipation_threshold:
            aggressive=True; aggressive_reasons.append("быстро + много антиципаций")

    many_anticip=False; many_reasons=[]
    if anticipation_rate is not None and anticipation_rate>=th.many_anticipations_threshold:
        many_anticip=True; many_reasons.append(f"anticipation_rate={anticipation_rate:.3f}≥{th.many_anticipations_threshold}")

    pes_flag=False; pes_reasons=[]
    delta=pes.get("delta_ms"); base=pes.get("after_correct_mean_rt_ms")
    if delta is not None and base is not None:
        if delta>=th.pes_min_delta_ms and delta>=th.pes_min_ratio*base:
            pes_flag=True; pes_reasons.append(f"delta={delta:.1f}ms, baseline={base:.1f}ms")

    fatigue_flag=False; fatigue_reasons=[]
    if slope is not None and slope>=th.fatigue_slope_ms_per_trial:
        fatigue_flag=True; fatigue_reasons.append(f"slope={slope:.2f} ms/trial")
    if fatigue.get("delta_ms") is not None and fatigue["delta_ms"]>=th.fatigue_delta_ms:
        fatigue_flag=True; fatigue_reasons.append(f"last-first={fatigue['delta_ms']:.1f}ms")

    conservative=False; conservative_reasons=[]
    if mean_rt is not None and mean_rt>=th.conservative_slow_mean_ms:
        if error_rate is not None and error_rate<=th.conservative_error_rate_max:
            if omission_rate is not None and omission_rate>=th.conservative_omission_min:
                conservative=True; conservative_reasons.append("медленно, почти без ошибок, но часто пропускает")

    return {
        "attention_scattered": {"value": attention, "reasons": attention_reasons},
        "aggressive_response_tactic": {"value": aggressive, "reasons": aggressive_reasons},
        "many_anticipations": {"value": many_anticip, "reasons": many_reasons},
        "post_error_slowing_detected": {"value": pes_flag, "reasons": pes_reasons, "details": pes},
        "fatigue_trend_detected": {"value": fatigue_flag, "reasons": fatigue_reasons, "details": fatigue},
        "conservative_tactic": {"value": conservative, "reasons": conservative_reasons},
    }
