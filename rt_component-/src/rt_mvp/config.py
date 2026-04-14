from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, Any, Optional
import json

# Класс для определения временных границ выполнения задачи
@dataclass(frozen=True)
class TaskBounds:
    min_rt_ms: int  # Минимальное время отклика в миллисекундах
    max_rt_ms: int  # Максимальное время отклика в миллисекундах
    timeout_ms: int  # Время ожидания перед таймаутом в миллисекундах

# Класс для хранения пороговых значений различных флагов анализа
@dataclass(frozen=True)
class FlagsThresholds:
    # Пороги для анализа внимания
    attention_cv_threshold: float = 0.30  # Коэффициент вариации внимания
    attention_omission_threshold: float = 0.10  # Порог пропусков
    attention_lapse_threshold: float = 0.10  # Порог кратковременного спада внимания
    lapse_ms: int = 500  # Длительность спада внимания в миллисекундах
    
    # Пороги для анализа агрессивного (быстрого) поведения
    aggressive_fast_mean_ms: int = 320  # Среднее быстрое время ответа
    aggressive_error_rate_threshold: float = 0.20  # Порог ошибок при агрессивной стратегии
    aggressive_commission_threshold: float = 0.20  # Порог ложных срабатываний
    aggressive_wrong_threshold: float = 0.20  # Порог неправильных ответов
    aggressive_anticipation_threshold: float = 0.05  # Порог преждевременных ответов
    many_anticipations_threshold: float = 0.10  # Порог множественных преждевременных ответов
    
    # Пороги для анализа позитивного ожидания
    pes_min_delta_ms: int = 20  # Минимальная разница времени в миллисекундах
    pes_min_ratio: float = 0.10  # Минимальное отношение
    
    # Пороги для анализа усталости
    fatigue_slope_ms_per_trial: float = 1.0  # Наклон усталости в миллисекундах на попытку
    fatigue_delta_ms: int = 30  # Дельта времени усталости в миллисекундах
    
    # Пороги для анализа консервативного (медленного) поведения
    conservative_slow_mean_ms: int = 600  # Среднее медленное время ответа
    conservative_error_rate_max: float = 0.10  # Максимальный порог ошибок при консервативной стратегии
    conservative_omission_min: float = 0.10  # Минимальный порог пропусков

# Класс для конфигурации анализа
@dataclass(frozen=True)
class AnalysisCfg:
    premature_window_ms: int = 200  # Временное окно для анализа преждевременных ответов в миллисекундах

# Основной класс конфигурации проекта
@dataclass(frozen=True)
class ProjectConfig:
    task_bounds: Dict[str, TaskBounds]  # Словарь границ времени для каждого типа задачи
    flags_thresholds: FlagsThresholds  # Пороговые значения флагов анализа
    analysis: AnalysisCfg  # Конфигурация анализа
    use_loglinear_correction: bool = True  # Использовать ли логарифмическую коррекцию для d-prime

    @staticmethod
    def load(path: Optional[str]) -> "ProjectConfig":
        """Загружает конфигурацию из JSON файла или использует значения по умолчанию"""
        data: Dict[str, Any] = {}
        
        # Если указан путь к файлу, загружаем конфигурацию из него
        if path:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        
        # Значения по умолчанию для границ времени различных типов задач
        default_tb = {
            "simple": {"min_rt_ms": 100, "max_rt_ms": 2000, "timeout_ms": 2500},
            "choice": {"min_rt_ms": 150, "max_rt_ms": 2000, "timeout_ms": 2500},
            "go_nogo": {"min_rt_ms": 100, "max_rt_ms": 1500, "timeout_ms": 2000},
            "stroop": {"min_rt_ms": 200, "max_rt_ms": 3000, "timeout_ms": 3500},
            "pvt": {"min_rt_ms": 100, "max_rt_ms": 5000, "timeout_ms": 5000},
            "cpt": {"min_rt_ms": 100, "max_rt_ms": 2000, "timeout_ms": 2000},
        }
        
        # Объединяем значения по умолчанию с загруженными из файла (загруженные значения переопределяют defaults)
        merged = {**default_tb, **data.get("task_bounds", {})}
        
        # Преобразуем словари в объекты TaskBounds
        task_bounds = {k: TaskBounds(**v) for k,v in merged.items()}
        
        # Загружаем или создаем пороги флагов, объединяя defaults с загруженными значени��ми
        ft_raw = data.get("flags_thresholds", {})
        flags_thresholds = FlagsThresholds(**{**FlagsThresholds().__dict__, **ft_raw})
        
        # Загружаем или создаем конфигурацию анализа
        an_raw = data.get("analysis", {})
        analysis = AnalysisCfg(**{**AnalysisCfg().__dict__, **an_raw})
        
        # Загружаем параметр логарифмической коррекции
        use_loglinear = bool(data.get("dprime", {}).get("use_loglinear_correction", True))
        
        # Возвращаем полностью инициализированный объект конфигурации
        return ProjectConfig(task_bounds=task_bounds, flags_thresholds=flags_thresholds, analysis=analysis, use_loglinear_correction=use_loglinear)
