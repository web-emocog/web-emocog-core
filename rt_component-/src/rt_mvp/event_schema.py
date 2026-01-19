from __future__ import annotations
from typing import Any, Dict, Optional
import time

def base_event(*, event_type: str, session_id: str, run_id: str, t_mono_s: float,
               trial_id: Optional[int]=None, block_id: Optional[int]=None,
               instrument: str="rt", schema_version: int=1, **payload: Any) -> Dict[str, Any]:
    ev: Dict[str, Any] = {
        "schema_version": schema_version,
        "instrument": instrument,
        "session_id": session_id,
        "run_id": run_id,
        "event_type": event_type,
        "t_mono": float(t_mono_s),
        "t_unix": float(time.time()),
    }
    if trial_id is not None: ev["trial_id"] = int(trial_id)
    if block_id is not None: ev["block_id"] = int(block_id)
    ev.update(payload)
    return ev
