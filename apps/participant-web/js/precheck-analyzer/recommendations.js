/**
 * Recommendations Module
 * 
 * Генерация рекомендаций на основе результатов анализа лица
 * 
 * @module precheck-analyzer/recommendations
 * @version 2.1.0
 */

/**
 * Приоритеты рекомендаций
 */
export const PRIORITY = {
    CRITICAL: 1,    // Блокирующие проблемы
    HIGH: 2,        // Серьёзные проблемы
    MEDIUM: 3,      // Умеренные проблемы
    LOW: 4          // Незначительные проблемы
};

/**
 * Категории проблем
 */
export const CATEGORY = {
    FACE: 'face',
    LIGHTING: 'lighting',
    POSE: 'pose',
    EYES: 'eyes',
    OCCLUSION: 'occlusion',
    STABILITY: 'stability'
};

/**
 * Маппинг проблем на рекомендации
 */
const ISSUE_RECOMMENDATIONS = {
    // Проблемы с лицом
    no_face: {
        message: 'Лицо не обнаружено. Убедитесь, что ваше лицо находится в кадре.',
        priority: PRIORITY.CRITICAL,
        category: CATEGORY.FACE
    },
    multiple_faces: {
        message: 'Обнаружено несколько лиц. Убедитесь, что в кадре только вы.',
        priority: PRIORITY.CRITICAL,
        category: CATEGORY.FACE
    },
    face_too_small: {
        message: 'Лицо слишком далеко. Приблизьтесь к камере.',
        priority: PRIORITY.HIGH,
        category: CATEGORY.FACE
    },
    face_too_large: {
        message: 'Лицо слишком близко. Отодвиньтесь от камеры.',
        priority: PRIORITY.HIGH,
        category: CATEGORY.FACE
    },
    face_not_centered: {
        message: 'Расположите лицо по центру кадра.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.FACE
    },
    
    // Проблемы с освещением
    too_dark: {
        message: 'Слишком темно. Добавьте освещение.',
        priority: PRIORITY.HIGH,
        category: CATEGORY.LIGHTING
    },
    too_bright: {
        message: 'Слишком ярко. Уменьшите яркость освещения или отойдите от окна.',
        priority: PRIORITY.HIGH,
        category: CATEGORY.LIGHTING
    },
    low_contrast: {
        message: 'Низкий контраст изображения. Улучшите освещение.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.LIGHTING
    },
    uneven_lighting: {
        message: 'Неравномерное освещение. Расположите источник света перед собой.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.LIGHTING
    },
    backlight: {
        message: 'Контровой свет. Не сидите спиной к окну или яркому источнику света.',
        priority: PRIORITY.HIGH,
        category: CATEGORY.LIGHTING
    },
    
    // Проблемы с позой
    head_turned_left: {
        message: 'Голова повёрнута влево. Смотрите прямо в камеру.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.POSE
    },
    head_turned_right: {
        message: 'Голова повёрнута вправо. Смотрите прямо в камеру.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.POSE
    },
    head_tilted_up: {
        message: 'Голова запрокинута. Опустите подбородок.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.POSE
    },
    head_tilted_down: {
        message: 'Голова опущена. Поднимите подбородок.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.POSE
    },
    head_tilted_side: {
        message: 'Голова наклонена вбок. Выровняйте голову.',
        priority: PRIORITY.LOW,
        category: CATEGORY.POSE
    },
    unstable_pose: {
        message: 'Держите голову неподвижно.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.STABILITY
    },
    
    // Проблемы с глазами
    eyes_closed: {
        message: 'Глаза закрыты. Откройте глаза и смотрите в камеру.',
        priority: PRIORITY.HIGH,
        category: CATEGORY.EYES
    },
    eyes_looking_away: {
        message: 'Смотрите прямо в камеру.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.EYES
    },
    eyes_not_centered: {
        message: 'Направьте взгляд в центр экрана.',
        priority: PRIORITY.LOW,
        category: CATEGORY.EYES
    },
    squinting: {
        message: 'Не прищуривайтесь. Откройте глаза нормально.',
        priority: PRIORITY.LOW,
        category: CATEGORY.EYES
    },
    
    // Окклюзии
    hand_on_face: {
        message: 'Уберите руку от лица.',
        priority: PRIORITY.CRITICAL,
        category: CATEGORY.OCCLUSION
    },
    hair_occlusion: {
        message: 'Волосы закрывают лицо. Уберите волосы с лица.',
        priority: PRIORITY.HIGH,
        category: CATEGORY.OCCLUSION
    },
    glasses_glare: {
        message: 'Блики на очках. Поверните голову или измените освещение.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.OCCLUSION
    },
    object_occlusion: {
        message: 'Что-то закрывает лицо. Уберите посторонние предметы.',
        priority: PRIORITY.HIGH,
        category: CATEGORY.OCCLUSION
    },
    mouth_open: {
        message: 'Закройте рот для точного анализа.',
        priority: PRIORITY.LOW,
        category: CATEGORY.FACE
    },
    
    // Проблемы со стабильностью
    excessive_movement: {
        message: 'Слишком много движений. Сидите спокойно.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.STABILITY
    },
    
    // Области лица
    forehead_occluded: {
        message: 'Лоб закрыт. Уберите волосы или аксессуары со лба.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.OCCLUSION
    },
    left_cheek_occluded: {
        message: 'Левая щека не видна. Поверните лицо к камере.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.OCCLUSION
    },
    right_cheek_occluded: {
        message: 'Правая щека не видна. Поверните лицо к камере.',
        priority: PRIORITY.MEDIUM,
        category: CATEGORY.OCCLUSION
    }
};

/**
 * Получение рекомендаций на основе списка проблем
 * 
 * @param {Array<string>} issues - список кодов проблем
 * @param {Object} analysisResult - полный результат анализа (опционально)
 * @returns {Array<Object>} отсортированный список рекомендаций
 */
export function getRecommendations(issues, analysisResult = null) {
    if (!issues || !Array.isArray(issues) || issues.length === 0) {
        return [];
    }
    
    const recommendations = [];
    const addedMessages = new Set();
    
    for (const issue of issues) {
        const rec = ISSUE_RECOMMENDATIONS[issue];
        if (rec && !addedMessages.has(rec.message)) {
            recommendations.push({
                issue,
                message: rec.message,
                priority: rec.priority,
                category: rec.category
            });
            addedMessages.add(rec.message);
        } else if (!rec) {
            // Неизвестная проблема — добавляем как есть
            const fallbackMessage = formatUnknownIssue(issue);
            if (!addedMessages.has(fallbackMessage)) {
                recommendations.push({
                    issue,
                    message: fallbackMessage,
                    priority: PRIORITY.MEDIUM,
                    category: CATEGORY.FACE
                });
                addedMessages.add(fallbackMessage);
            }
        }
    }
    
    // Дополнительные рекомендации на основе analysisResult
    if (analysisResult) {
        addContextualRecommendations(recommendations, analysisResult, addedMessages);
    }
    
    // Сортируем по приоритету (критичные первые)
    recommendations.sort((a, b) => a.priority - b.priority);
    
    return recommendations;
}

/**
 * Форматирование неизвестной проблемы в читаемое сообщение
 * 
 * @param {string} issue - код проблемы
 * @returns {string} читаемое сообщение
 */
function formatUnknownIssue(issue) {
    // snake_case -> "Readable text"
    return issue
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Добавление контекстных рекомендаций на основе результата анализа
 * 
 * @param {Array} recommendations - массив рекомендаций
 * @param {Object} result - результат анализа
 * @param {Set} addedMessages - уже добавленные сообщения
 */
function addContextualRecommendations(recommendations, result, addedMessages) {
    // Проверка освещения
    if (result.illumination) {
        const { brightness, contrast, evenness } = result.illumination;
        
        if (brightness < 80 && !addedMessages.has(ISSUE_RECOMMENDATIONS.too_dark?.message)) {
            recommendations.push({
                issue: 'low_brightness',
                message: `Яркость ${Math.round(brightness)}/255. Добавьте освещение.`,
                priority: PRIORITY.MEDIUM,
                category: CATEGORY.LIGHTING
            });
        }
        
        if (evenness && evenness < 0.7 && !addedMessages.has(ISSUE_RECOMMENDATIONS.uneven_lighting?.message)) {
            recommendations.push({
                issue: 'lighting_evenness',
                message: 'Освещение неравномерное. Добавьте фронтальный свет.',
                priority: PRIORITY.LOW,
                category: CATEGORY.LIGHTING
            });
        }
    }
    
    // Проверка позы с числовыми значениями
    if (result.pose) {
        const { yaw, pitch, roll } = result.pose;
        
        if (Math.abs(yaw) > 15) {
            const direction = yaw > 0 ? 'вправо' : 'влево';
            const existingPoseRec = recommendations.find(r => 
                r.issue === 'head_turned_left' || r.issue === 'head_turned_right'
            );
            if (!existingPoseRec) {
                recommendations.push({
                    issue: 'head_rotation',
                    message: `Голова повёрнута ${direction} на ${Math.abs(Math.round(yaw))}°. Смотрите прямо.`,
                    priority: PRIORITY.MEDIUM,
                    category: CATEGORY.POSE
                });
            }
        }
    }
}

/**
 * Проверка готовности к записи
 * 
 * @param {Array<string>} issues - список проблем
 * @param {Object} options - опции проверки
 * @returns {Object} результат проверки готовности
 */
export function checkReadiness(issues, options = {}) {
    const { 
        allowMinorIssues = true,
        maxMinorIssues = 2 
    } = options;
    
    const recommendations = getRecommendations(issues);
    
    const criticalIssues = recommendations.filter(r => r.priority === PRIORITY.CRITICAL);
    const highIssues = recommendations.filter(r => r.priority === PRIORITY.HIGH);
    const mediumIssues = recommendations.filter(r => r.priority === PRIORITY.MEDIUM);
    const lowIssues = recommendations.filter(r => r.priority === PRIORITY.LOW);
    
    // Не готов если есть критические или высокоприоритетные проблемы
    if (criticalIssues.length > 0 || highIssues.length > 0) {
        return {
            isReady: false,
            reason: 'critical_issues',
            criticalCount: criticalIssues.length,
            highCount: highIssues.length,
            recommendations
        };
    }
    
    // Проверяем количество средних проблем
    if (!allowMinorIssues && mediumIssues.length > 0) {
        return {
            isReady: false,
            reason: 'medium_issues',
            mediumCount: mediumIssues.length,
            recommendations
        };
    }
    
    // Проверяем общее количество незначительных проблем
    const minorCount = mediumIssues.length + lowIssues.length;
    if (minorCount > maxMinorIssues) {
        return {
            isReady: false,
            reason: 'too_many_minor_issues',
            minorCount,
            recommendations
        };
    }
    
    return {
        isReady: true,
        reason: minorCount > 0 ? 'ready_with_warnings' : 'fully_ready',
        warningCount: minorCount,
        recommendations
    };
}

/**
 * Получение главной (самой приоритетной) рекомендации
 * 
 * @param {Array<string>} issues - список проблем
 * @returns {Object|null} главная рекомендация или null
 */
export function getMainRecommendation(issues) {
    const recommendations = getRecommendations(issues);
    return recommendations.length > 0 ? recommendations[0] : null;
}

/**
 * Группировка рекомендаций по категориям
 * 
 * @param {Array<string>} issues - список проблем
 * @returns {Object} рекомендации, сгруппированные по категориям
 */
export function groupRecommendationsByCategory(issues) {
    const recommendations = getRecommendations(issues);
    const grouped = {};
    
    for (const rec of recommendations) {
        if (!grouped[rec.category]) {
            grouped[rec.category] = [];
        }
        grouped[rec.category].push(rec);
    }
    
    return grouped;
}

export default getRecommendations;
