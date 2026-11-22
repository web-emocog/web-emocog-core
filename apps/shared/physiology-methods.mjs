// Методы оценки ЧСС и дыхания, выбираемые в протоколе (settings.physiologyMethods).
// Отсутствие настройки = прежнее поведение, поэтому опубликованные протоколы не меняются.
// Каждый метод пишет собственную версию в данные сессии, чтобы аналитика не смешивала методы.

export const HEART_RATE_METHODS = Object.freeze({
    pos: Object.freeze({ algorithm: 'pos', methodVersion: 'continuous_signals.v2', experimental: false,
        label: { ru: 'POS (текущий)', en: 'POS (current)' } }),
    chrom: Object.freeze({ algorithm: 'chrom', methodVersion: 'continuous_signals.v2.chrom', experimental: true,
        label: { ru: 'CHROM (экспериментальный)', en: 'CHROM (experimental)' } }),
    auto: Object.freeze({ algorithm: 'auto', methodVersion: 'continuous_signals.v2.auto', experimental: true,
        label: { ru: 'Автовыбор POS/CHROM (экспериментальный)', en: 'Automatic POS/CHROM (experimental)' } })
});

export const RESPIRATION_METHODS = Object.freeze({
    luma: Object.freeze({ methodVersion: 'respiration_luma.log_peak.v2', experimental: false,
        label: { ru: 'По яркости кожи (текущий)', en: 'Skin brightness (current)' } }),
    motion: Object.freeze({ methodVersion: 'respiration_motion.consensus.v1', experimental: true,
        label: { ru: 'По движению головы и плеч (экспериментальный)', en: 'Head and shoulder motion (experimental)' } })
});

export const DEFAULT_PHYSIOLOGY_METHODS = Object.freeze({ heartRate: 'pos', respiration: 'luma' });

export function physiologyMethodsSource(definition = null) {
    return definition?.settings?.physiologyMethods ?? definition?.physiologyMethods ?? null;
}

// Возвращает список ошибок; пустой список — настройка допустима.
export function validatePhysiologyMethods(value) {
    if (value == null) return [];
    if (typeof value !== 'object' || Array.isArray(value)) return ['physiology_methods_invalid'];
    const errors = [];
    for (const key of Object.keys(value)) if (!['heartRate', 'respiration'].includes(key)) errors.push('physiology_methods_invalid');
    if (value.heartRate != null && !Object.hasOwn(HEART_RATE_METHODS, value.heartRate)) errors.push('heart_rate_method_unsupported');
    if (value.respiration != null && !Object.hasOwn(RESPIRATION_METHODS, value.respiration)) errors.push('respiration_method_unsupported');
    return [...new Set(errors)];
}

// Для исполнения: неизвестное значение не роняет сессию, а даёт прежний метод.
export function resolvePhysiologyMethods(definition = null) {
    const source = physiologyMethodsSource(definition) || {};
    const heartRate = Object.hasOwn(HEART_RATE_METHODS, source.heartRate) ? source.heartRate : DEFAULT_PHYSIOLOGY_METHODS.heartRate;
    const respiration = Object.hasOwn(RESPIRATION_METHODS, source.respiration) ? source.respiration : DEFAULT_PHYSIOLOGY_METHODS.respiration;
    return {
        heartRate, respiration,
        heartRateAlgorithm: HEART_RATE_METHODS[heartRate].algorithm,
        heartRateMethodVersion: HEART_RATE_METHODS[heartRate].methodVersion,
        respirationMethodVersion: RESPIRATION_METHODS[respiration].methodVersion
    };
}
