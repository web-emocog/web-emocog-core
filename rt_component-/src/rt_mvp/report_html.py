from __future__ import annotations
from typing import Any, Dict, List, Tuple, TYPE_CHECKING
import html
from . import stats

if TYPE_CHECKING:
    from .analyzer import TrialOutcome

# Форматирование числа или строки с обработкой None
def _fmt(x: Any, nd: int=3) -> str:
    if x is None: return "—"
    if isinstance(x, float): return f"{x:.{nd}f}"
    return str(x)

# Генерация заголовка SVG
def _svg_header(w: int, h: int) -> str:
    return f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">'

# Генерация нижнего колонтитула SVG
def _svg_footer() -> str:
    return "</svg>"

# Создание осей для SVG с заданием отступов
def _axes(w: int, h: int, pad: int=40) -> Tuple[int,int,int,int,str]:
    x0,y0,x1,y1=pad,pad,w-pad,h-pad
    ax=[]
    ax.append(f'<line x1="{x0}" y1="{y1}" x2="{x1}" y2="{y1}" stroke="#000" />')  # Ось X
    ax.append(f'<line x1="{x0}" y1="{y0}" x2="{x0}" y2="{y1}" stroke="#000" />')  # Ось Y
    return x0,y0,x1,y1,"\n".join(ax)

# Линейное масштабирование значения из одного диапазона в другой
def _scale(val: float, vmin: float, vmax: float, a: float, b: float) -> float:
    if vmax<=vmin: return (a+b)/2.0
    t=(val-vmin)/(vmax-vmin)
    return a+t*(b-a)

# Генерация SVG-диаграммы рассеяния (scatter plot)
def svg_scatter(trials: List[TrialOutcome], w: int=900, h: int=320) -> str:
    pts=[]
    for i,t in enumerate(trials, start=1):
        if t.rt_ms is None: continue  # Игнорировать отсутствующие значения RT
        pts.append((i,float(t.rt_ms),t.classification))
    if not pts: return "<p>Нет RT-точек.</p>"  # Если нет данных, вернуть сообщение
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    xmin,xmax=min(xs),max(xs)
    ymin,ymax=min(ys),max(ys)
    ymax=ymax*1.05+1.0; ymin=max(0.0,ymin*0.95-1.0)  # Расширяем диапазоны
    x0,y0,x1,y1,ax=_axes(w,h)
    color={"correct":"#2e7d32","correct_inhibition":"#2e7d32","wrong":"#c62828","commission":"#ad1457","omission":"#616161","timeout":"#6d4c41","anticipation":"#1565c0","unknown":"#000"}
    svg=[_svg_header(w,h),ax]
    for xi,yi,cls in pts:
        cx=_scale(float(xi),float(xmin),float(xmax),x0,x1)  # Масштабирование X
        cy=_scale(float(yi),float(ymin),float(ymax),y1,y0)  # Масштабирование Y
        svg.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="3.3" fill="{color.get(cls,"#000")}" />')  # Добавление точки
    svg.append(_svg_footer())
    return "\n".join(svg)

# Генерация SVG-гистограммы распределения значений
def svg_hist(values: List[float], bins: int=12, w: int=900, h: int=260) -> str:
    if not values: return "<p>Нет валидных RT.</p>"  # Если нет данных, вернуть сообщение
    vmin,vmax=min(values),max(values)
    if vmax<=vmin: vmax=vmin+1.0  # Избежать деления на ноль
    counts=[0]*bins
    for v in values:
        t=(v-vmin)/(vmax-vmin)
        idx=int(t*bins)  # Определяем корзину (bin)
        if idx==bins: idx=bins-1
        counts[idx]+=1
    maxc=max(counts) if counts else 1
    x0,y0,x1,y1,ax=_axes(w,h)
    svg=[_svg_header(w,h),ax]
    bar_w=(x1-x0)/bins
    for i,c in enumerate(counts):
        bh=0 if maxc==0 else (c/maxc)*(y1-y0)  # Высота столбца
        x=x0+i*bar_w; y=y1-bh
        svg.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_w-2:.1f}" height="{bh:.1f}" fill="#78909c" />')  # Рисуем прямоугольник
    svg.append(_svg_footer())
    return "\n".join(svg)

# Генерация SVG тренда с использованием линейной регрессии
def svg_trend(trials: List[TrialOutcome], w: int=900, h: int=260) -> str:
    xs=[]; ys=[]
    for i,t in enumerate(trials, start=1):
        if t.is_valid_rt and t.rt_ms is not None:
            xs.append(float(i)); ys.append(float(t.rt_ms))
    if len(xs)<2: return "<p>Недостаточно валидных RT.</p>"  # Если данных недостаточно
    xmin,xmax=min(xs),max(xs); ymin,ymax=min(ys),max(ys)
    ymax=ymax*1.05+1.0; ymin=max(0.0,ymin*0.95-1.0)
    slope=stats.linear_regression_slope(xs,ys) or 0.0  # Вычисление наклон��
    xm=stats.mean(xs) or 0.0; ym=stats.mean(ys) or 0.0  # Средние значения
    a=ym-slope*xm  # Вычисление интерсепта
    x0,y0,x1,y1,ax=_axes(w,h)
    svg=[_svg_header(w,h),ax]
    for xi,yi in zip(xs,ys):
        cx=_scale(xi,xmin,xmax,x0,x1); cy=_scale(yi,ymin,ymax,y1,y0)
        svg.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="3.2" fill="#2e7d32" />')  # Точки на графике
    xL,xR=xmin,xmax; yL=a+slope*xL; yR=a+slope*xR  # Прямая линия тренда
    lx1=_scale(xL,xmin,xmax,x0,x1); lx2=_scale(xR,xmin,xmax,x0,x1)
    ly1=_scale(yL,ymin,ymax,y1,y0); ly2=_scale(yR,ymin,ymax,y1,y0)
    svg.append(f'<line x1="{lx1:.1f}" y1="{ly1:.1f}" x2="{lx2:.1f}" y2="{ly2:.1f}" stroke="#000" stroke-width="2" />')  # Линия регрессии
    svg.append(_svg_footer())
    return "\n".join(svg)

# Построение HTML-отчета на основе данных
def build_report_html(meta: Dict[str, Any], trials: List[TrialOutcome], metrics: Dict[str, Any], flags: Dict[str, Any]) -> str:
    task=html.escape(str(meta.get("task","")))  # Получение информации о задаче
    rt_valid=[float(t.rt_ms) for t in trials if t.is_valid_rt and t.rt_ms is not None]
    scatter=svg_scatter(trials); hist=svg_hist(rt_valid); trend=svg_trend(trials)  # Генерация SVG графиков
    rt=metrics.get("rt",{}); rates=metrics.get("rates",{})
    rows=[("n_trials",meta.get("n_trials")),("n_valid_rt",rt.get("n_valid")),("mean_rt_ms",_fmt(rt.get("mean_rt_ms"),2)),
          ("median_rt_ms",_fmt(rt.get("median_rt_ms"),2)),("rt_std_ms",_fmt(rt.get("rt_std_ms"),2)),("rt_cv",_fmt(rt.get("rt_cv"),3)),
          ("rt_slope_ms_per_trial",_fmt(rt.get("rt_slope_ms_per_trial"),2)),("accuracy",_fmt(rates.get("accuracy"),3)),
          ("omission_rate",_fmt(rates.get("omission_rate"),3)),("commission_error_rate",_fmt(rates.get("commission_error_rate"),3)),
          ("timeout_rate",_fmt(rates.get("timeout_rate"),3)),("anticipation_rate",_fmt(rates.get("anticipation_rate"),3)),
          ("d_prime",_fmt(rates.get("d_prime"),3))]
    metrics_html="<table border='1' cellspacing='0' cellpadding='6'>" + "".join(
        f"<tr><td>{html.escape(k)}</td><td>{html.escape(str(v))}</td></tr>" for k,v in rows
    ) + "</table>"  # Таблица метрик
    flags_html="<ul>"+"\n".join(
        f"<li><b>{html.escape(name)}</b>: {html.escape(str(info.get('value')))}"
        + (f"<br><small>{html.escape('; '.join(info.get('reasons',[])))}</small>" if info.get("reasons") else "")
        + "</li>"
        for name,info in flags.items()
    )+"</ul>"  # Список флагов
    return f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"/>
<title>RT report — {task}</title>
<style>body{{font-family:Arial,sans-serif;margin:20px}} svg{{border:1px solid #eee;background:#fff}} .small{{color:#444}}</style>
</head><body>
<h1>RT report — {task}</h1>
<div class="small">log: {html.escape(str(meta.get("log_path","")))}</div>
<h2>Метрики</h2>{metrics_html}
<h2>Флаги состояния</h2>{flags_html}
<h2>RT по триалам</h2>{scatter}
<h2>Гистограмма валидных RT</h2>{hist}
<h2>Тренд RT</h2>{trend}
</body></html>"""
