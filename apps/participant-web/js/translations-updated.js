/**
 * Расширение словаря переводов для Фазы 0 (политика конфиденциальности, опция «только сводка»).
 */
import { translations as base } from '../translations.js';

const additionsRu = {
    privacy_policy_short: 'Видео не записывается и не передаётся; все расчёты — на вашем устройстве; на сервер отправляются только обезличенные сводки.',
    label_aggregates_only: 'Только сводка (без сырых массивов)'
};

const additionsEn = {
    privacy_policy_short: 'Video is not recorded or transmitted; all processing is done on your device; only anonymized summaries are sent to the server.',
    label_aggregates_only: 'Summary only (no raw arrays)'
};

export const translations = {
    ru: { ...base.ru, ...additionsRu },
    en: { ...base.en, ...additionsEn }
};
