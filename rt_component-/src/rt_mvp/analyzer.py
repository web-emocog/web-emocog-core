from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
import os, json

from .event_log import read_jsonl
from .config import ProjectConfig, TaskBounds
from . import stats
from .state_flags import compute_state_flags
from .report_html import build_report_html

# Результат одного испытания (trial) с классификацией и временными показателями
@dataclass
class TrialOutcome:
    trial_id: int
    block_id: int
    stimulus_type: str
    expected_response: Optional[str]
    is_go: Optional[bool]
    timeout_ms: int
    first_press_t: Optional[float]=None  # Время первого нажатия (абсолютное)
    first_press_button: Optional[str]=None  # Какая кнопка была нажата первой
    rt_ms: Optional[float]=None  # Время реакции в миллисекундах
    press_count: int=0  # Общее количество нажатий
    premature_press_count: int=0  # Нажатия раньше стимула
    late_press_count: int=0  # Нажатия после таймаута
    classification: str="unknown"  # Тип результата: correct, wrong, omission, timeout и т.д.
    is_correct: bool=False
    is_valid_rt: bool=False  # Валидное время реакции (в пределах норм)
    is_anticipation: bool=False  # Слишком быстрая реакция
    is_timeout: bool=False  # Истёк таймаут (нет ответа или слишком поздний)
    is_wrong: bool=False  # Неправильный ответ
    is_commission: bool=False  # Нежелательный ответ (в go/nogo задаче)
    is_omission: bool=False  # Отсутствие ответа

def _group_by_trial(events: List[Dict[str, Any]]) -> Dict[int, List[Dict[str, Any]]]:
    # Группирует события по ID испытания и сортирует по времени
    g: Dict[int, List[Dict[str, Any]]] = {}
    for ev in events:
        tid = ev.get("trial_id")
        if tid is None:
            continue
        try:
            tid_i = int(tid)
        except Exception:
            continue
        g.setdefault(tid_i, []).append(ev)
    for tid in g:
        g[tid].sort(key=lambda e: float(e.get("t_mono", 0.0)))
    return g

def build_trials(log_path: str, task: str, cfg: ProjectConfig) -> Tuple[List[TrialOutcome], Dict[str, Any]]:
    # Парсит лог событий и преобразует в список структурированных испытаний
    events = list(read_jsonl(log_path))
    bounds: TaskBounds = cfg.task_bounds.get(task, cfg.task_bounds["simple"])
    g = _group_by_trial(events)
    prem_ms = cfg.analysis.premature_window_ms

    trials: List[TrialOutcome] = []
    for tid in sorted(g.keys()):
        evs = g[tid]
        stim_on = next((e for e in evs if e.get("event_type")=="stimulus_on"), None)
        if not stim_on:
            continue

        block_id = int(stim_on.get("block_id", 1))
        stimulus_type = str(stim_on.get("stimulus_type",""))
        expected = stim_on.get("expected_response", None)
        is_go = stim_on.get("is_go", None)
        timeout_ms = int(stim_on.get("timeout_ms", bounds.timeout_ms))

        # Временной интервал: от появления стимула до истечения таймаута
        t0 = float(stim_on.get("t_mono", 0.0))
        t1 = t0 + timeout_ms/1000.0

        # Группирует нажатия кнопок по времени относительно стимула
        presses = [e for e in evs if e.get("event_type")=="keypress" and "t_mono" in e]
        press_times = [(float(p["t_mono"]), str(p.get("button_id",""))) for p in presses]

        in_window = [(t,b) for (t,b) in press_times if t0 <= t <= t1]  # Валидные ответы
        premature = [(t,b) for (t,b) in press_times if (t0 - prem_ms/1000.0) <= t < t0]  # До стимула
        late = [(t,b) for (t,b) in press_times if t > t1]  # После таймаута
        first = in_window[0] if in_window else None  # Первый валидный ответ

        out = TrialOutcome(
            trial_id=tid, block_id=block_id, stimulus_type=stimulus_type,
            expected_response=expected, is_go=is_go, timeout_ms=timeout_ms,
            press_count=len(press_times), premature_press_count=len(premature), late_press_count=len(late),
        )
        if first:
            tp, b = first
            out.first_press_t = tp
            out.first_press_button = b
            out.rt_ms = (tp - t0)*1000.0

        # Границы для валидного времени реакции
        min_rt = bounds.min_rt_ms
        max_rt = min(bounds.max_rt_ms, timeout_ms)

        def valid_rt(rt_ms: float) -> bool:
            return (rt_ms >= float(min_rt)) and (rt_ms <= float(max_rt))

        # Классифицирует результат в зависимости от типа задачи
        if task in ("simple","choice"):
            if out.rt_ms is None:
                out.classification="omission"; out.is_omission=True; out.is_timeout=True
            else:
                if out.rt_ms < min_rt:
                    out.classification="anticipation"; out.is_anticipation=True
                else:
                    if expected is not None and str(out.first_press_button)==str(expected):
                        out.classification="correct"; out.is_correct=True
                    else:
                        out.classification="wrong"; out.is_wrong=True
                if out.rt_ms > max_rt:
                    out.classification="timeout"; out.is_timeout=True; out.is_correct=False

        elif task=="go_nogo":
            if is_go is True:  # Go сигнал
                if out.rt_ms is None:
                    out.classification="omission"; out.is_omission=True; out.is_timeout=True
                else:
                    if out.rt_ms < min_rt:
                        out.classification="anticipation"; out.is_anticipation=True
                    else:
                        if str(out.first_press_button)=="space":
                            out.classification="correct"; out.is_correct=True
                        else:
                            out.classification="wrong"; out.is_wrong=True
                    if out.rt_ms > max_rt:
                        out.classification="timeout"; out.is_timeout=True; out.is_correct=False
            else:  # NoGo сигнал (нужно не нажимать)
                if out.rt_ms is None:
                    out.classification="correct_inhibition"; out.is_correct=True
                else:
                    out.classification="commission"; out.is_commission=True  # Ошибка: нажал, когда не надо
                    if out.rt_ms < min_rt:
                        out.is_anticipation=True

        else:  # Прочие типы задач
            if out.rt_ms is None:
                out.classification="omission"; out.is_omission=True; out.is_timeout=True
            else:
                if out.rt_ms < min_rt:
                    out.classification="anticipation"; out.is_anticipation=True
                else:
                    out.classification="correct"; out.is_correct=True
                if out.rt_ms > max_rt:
                    out.classification="timeout"; out.is_timeout=True; out.is_correct=False

        # Отмечает результаты с валидным временем реакции
        if out.is_correct and out.rt_ms is not None and valid_rt(out.rt_ms) and not out.is_anticipation:
            out.is_valid_rt=True

        trials.append(out)

    meta = {"log_path": log_path, "task": task, "bounds": {"min_rt_ms": bounds.min_rt_ms, "max_rt_ms": bounds.max_rt_ms, "timeout_ms": bounds.timeout_ms}, "n_trials": len(trials)}
    return trials, meta

def compute_metrics(trials: List[TrialOutcome], task: str, cfg: ProjectConfig) -> Dict[str, Any]:
    # Вычисляет статистические показатели производительности
    bounds = cfg.task_bounds.get(task, cfg.task_bounds["simple"])
    total=len(trials)
    correct=sum(1 for t in trials if t.is_correct)
    wrong=sum(1 for t in trials if t.is_wrong)
    commission=sum(1 for t in trials if t.is_commission)
    omission=sum(1 for t in trials if t.is_omission)
    anticipation=sum(1 for t in trials if t.is_anticipation)
    timeout=sum(1 for t in trials if t.is_timeout)

    # Для go/nogo отдельно считаем go и nogo испытания
    if task=="go_nogo":
        go_trials=sum(1 for t in trials if t.is_go is True)
        nogo_trials=sum(1 for t in trials if t.is_go is False)
        required=go_trials
    else:
        go_trials=None; nogo_trials=None; required=total

    # Статистика времени реакции
    rt_valid=[float(t.rt_ms) for t in trials if t.is_valid_rt and t.rt_ms is not None]
    mean_rt=stats.mean(rt_valid); median_rt=stats.median(rt_valid)
    rt_std=stats.std_sample(rt_valid); rt_cv=stats.coefficient_of_variation(rt_valid)

    # Тренд времени реакции на протяжении сессии
    xs=[]; ys=[]
    for idx,t in enumerate(trials, start=1):
        if t.is_valid_rt and t.rt_ms is not None:
            xs.append(float(idx)); ys.append(float(t.rt_ms))
    rt_slope=stats.linear_regression_slope(xs, ys)

    # Количество задержанных реакций (lapses)
    lapse_ms=cfg.flags_thresholds.lapse_ms
    lapses=sum(1 for r in rt_valid if r>float(lapse_ms))
    lapse_rate=(lapses/len(rt_valid)) if rt_valid else None

    # Процентные показатели
    accuracy=(correct/total) if total else None
    omission_rate=(omission/required) if required else None
    timeout_rate=(timeout/required) if required else None
    anticipation_rate=(anticipation/total) if total else None

    # Специфичные метрики для go/nogo задачи
    if task=="go_nogo" and go_trials is not None and nogo_trials is not None:
        commission_rate=(commission/nogo_trials) if nogo_trials else None
        hit_rate=(sum(1 for t in trials if t.is_go is True and t.classification=="correct")/go_trials) if go_trials else None
        fa_rate=(commission/nogo_trials) if nogo_trials else None
        d_prime=None
        if hit_rate is not None and fa_rate is not None:
            # Вычисляет d-prime с логарифмической коррекцией (если включена)
            if cfg.use_loglinear_correction:
                H=sum(1 for t in trials if t.is_go is True and t.classification=="correct")
                FA=commission
                hit=(H+0.5)/(go_trials+1.0) if go_trials else 0.5
                fa=(FA+0.5)/(nogo_trials+1.0) if nogo_trials else 0.5
            else:
                hit=hit_rate; fa=fa_rate
            d_prime=stats.inv_norm_cdf(hit)-stats.inv_norm_cdf(fa)
    else:
        commission_rate=None; hit_rate=None; fa_rate=None; d_prime=None

    # Корреляция между скоростью и точностью
    rt_all=[]; corr_all=[]
    for t in trials:
        if t.rt_ms is not None and not t.is_timeout:
            rt_all.append(float(t.rt_ms))
            corr_all.append(1.0 if t.is_correct else 0.0)
    speed_accuracy_r=stats.pearson_r(rt_all, corr_all)

    # Возвращает полный набор метрик
    return {
        "counts": {"total_trials": total,"correct":correct,"wrong":wrong,"commission":commission,"omission":omission,"anticipation":anticipation,"timeout":timeout,"go_trials":go_trials,"nogo_trials":n[...]
        "rt": {"n_valid":len(rt_valid),"mean_rt_ms":mean_rt,"median_rt_ms":median_rt,"rt_std_ms":rt_std,"rt_cv":rt_cv,"rt_slope_ms_per_trial":rt_slope,"lapses_gt_ms":lapse_ms,"lapses_count":lapses,"la[...]
        "rates": {"accuracy":accuracy,"omission_rate":omission_rate,"commission_error_rate":commission_rate,"timeout_rate":timeout_rate,"anticipation_rate":anticipation_rate,"hit_rate":hit_rate,"false[...]
        "speed_accuracy": {"pearson_r_rt_correctness": speed_accuracy_r},
        "bounds": {"min_rt_ms": bounds.min_rt_ms, "max_rt_ms": bounds.max_rt_ms, "timeout_ms": bounds.timeout_ms},
    }

def analyze_and_report(log_path: str, task: str, config_path: Optional[str]=None) -> Dict[str, Any]:
    # Полный анализ сессии: обработка логов, вычисление метрик, генерация отчёта
    cfg=ProjectConfig.load(config_path)
    trials, meta = build_trials(log_path, task, cfg)  # Парсит и классифицирует испытания
    metrics = compute_metrics(trials, task, cfg)  # Вычисляет метрики
    flags = compute_state_flags(trials, metrics, task, cfg)  # Генерирует флаги состояния

    # Сохраняет результаты в файлы
    session_name=os.path.splitext(os.path.basename(log_path))[0]
    out_dir=os.path.join("reports", session_name)
    os.makedirs(out_dir, exist_ok=True)

    summary={"meta":meta,"metrics":metrics,"flags":flags}
    with open(os.path.join(out_dir,"summary.json"),"w",encoding="utf-8") as f:
        json.dump(summary,f,ensure_ascii=False,indent=2)

    html = build_report_html(meta, trials, metrics, flags)  # Генерирует HTML-отчёт
    with open(os.path.join(out_dir,"report.html"),"w",encoding="utf-8") as f:
        f.write(html)
    return summary
