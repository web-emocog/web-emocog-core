/**
 * Модуль извлечения признаков v2.2
 * Извлекает признаки на основе радужки из landmarks MediaPipe Face Landmarker
 * для оценки взгляда через ridge-регрессию.
 * 
 * v2.2.0: Расширен до 17 признаков с терминами взаимодействия iris×head
 *         для лучшей точности в углах и по краям экрана.
 * 
 * Вектор признаков (17 элементов):
 *   [0]  leftIrisNormX   — X левой радужки относительно центра левого глаза, нормализованный по ширине глаза
 *   [1]  leftIrisNormY   — Y левой радужки относительно центра левого глаза, нормализованный по высоте глаза
 *   [2]  rightIrisNormX  — X правой радужки относительно центра правого глаза, нормализованный по ширине глаза
 *   [3]  rightIrisNormY  — Y правой радужки относительно центра правого глаза, нормализованный по высоте глаза
 *   [4]  avgIrisX        — среднее нормализованное X левой и правой радужки
 *   [5]  avgIrisY        — среднее нормализованное Y левой и правой радужки
 *   [6]  yawProxy        — оценка поворота головы (yaw) по расстояниям от носа до ушей
 *   [7]  pitchProxy      — оценка наклона головы (pitch) по расстояниям от носа до лба/подбородка
 *   [8]  headX           — X центра головы в кадре (0..1)
 *   [9]  headY           — Y центра головы в кадре (0..1)
 *   [10] leftEAR         — коэффициент раскрытия левого глаза (EAR)
 *   [11] rightEAR        — коэффициент раскрытия правого глаза (EAR)
 *   [12] irisX_x_yaw     — avgIrisX × yawProxy (взаимодействие: горизонтальный взгляд × поворот головы)
 *   [13] irisY_x_pitch   — avgIrisY × pitchProxy (взаимодействие: вертикальный взгляд × наклон головы)
 *   [14] irisX_x_headX   — avgIrisX × headX (взаимодействие: позиция радужки × положение головы)
 *   [15] irisY_x_headY   — avgIrisY × headY (взаимодействие: позиция радужки × положение головы)
 *   [16] bias            — 1.0 (удаляется до стандартизации и добавляется обратно после неё)
 * 
 * Термины взаимодействия захватывают нелинейную зависимость между положением радужки
 * и позой головы, что особенно важно для углов и краёв экрана.
 * 
 * @module gaze-tracker/features
 */

import { LANDMARKS, MIN_LANDMARKS } from './constants.js';

/**
 * Евклидово расстояние в 2D между двумя landmarks.
 */
function dist2d(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Извлекает 17-элементный вектор признаков из 478 landmarks лица.
 * @param {Array} landmarks - landmarks MediaPipe Face Landmarker (478)
 * @returns {number[] | null} вектор признаков или null при неудачном извлечении
 */
export function extractFeatures(landmarks) {
    if (!landmarks || landmarks.length < MIN_LANDMARKS) return null;

    try {
        const LM = LANDMARKS;

        const leftIris   = landmarks[LM.LEFT_IRIS_CENTER];
        const rightIris  = landmarks[LM.RIGHT_IRIS_CENTER];

        const leftInner  = landmarks[LM.LEFT_EYE_INNER];
        const leftOuter  = landmarks[LM.LEFT_EYE_OUTER];
        const leftTop    = landmarks[LM.LEFT_EYE_TOP];
        const leftBottom = landmarks[LM.LEFT_EYE_BOTTOM];

        const rightInner  = landmarks[LM.RIGHT_EYE_INNER];
        const rightOuter  = landmarks[LM.RIGHT_EYE_OUTER];
        const rightTop    = landmarks[LM.RIGHT_EYE_TOP];
        const rightBottom = landmarks[LM.RIGHT_EYE_BOTTOM];

        if (!leftIris || !rightIris || !leftInner || !leftOuter ||
            !rightInner || !rightOuter || !leftTop || !leftBottom ||
            !rightTop || !rightBottom) {
            return null;
        }

        // Размеры глаз
        const leftEyeW  = dist2d(leftInner, leftOuter);
        const leftEyeH  = dist2d(leftTop, leftBottom);
        const rightEyeW = dist2d(rightInner, rightOuter);
        const rightEyeH = dist2d(rightTop, rightBottom);

        if (leftEyeW < 1e-6 || rightEyeW < 1e-6) return null;
        if (leftEyeH < 1e-6 || rightEyeH < 1e-6) return null;

        // Центры глаз
        const leftEyeCX  = (leftInner.x + leftOuter.x) / 2;
        const leftEyeCY  = (leftTop.y + leftBottom.y) / 2;
        const rightEyeCX = (rightInner.x + rightOuter.x) / 2;
        const rightEyeCY = (rightTop.y + rightBottom.y) / 2;

        // Нормализованные позиции радужки внутри глаза (примерно [-1, 1])
        const leftNormX  = (leftIris.x - leftEyeCX) / (leftEyeW / 2);
        const leftNormY  = (leftIris.y - leftEyeCY) / (leftEyeH / 2);
        const rightNormX = (rightIris.x - rightEyeCX) / (rightEyeW / 2);
        const rightNormY = (rightIris.y - rightEyeCY) / (rightEyeH / 2);

        // Усреднённая позиция радужки
        const avgIrisX = (leftNormX + rightNormX) / 2;
        const avgIrisY = (leftNormY + rightNormY) / 2;

        // Прокси позы головы на основе геометрии лица
        const noseTip  = landmarks[LM.NOSE_TIP];
        const leftEar  = landmarks[LM.LEFT_EAR];
        const rightEar = landmarks[LM.RIGHT_EAR];
        const forehead = landmarks[LM.FOREHEAD];
        const chin     = landmarks[LM.CHIN];

        const dLeft     = dist2d(noseTip, leftEar);
        const dRight    = dist2d(noseTip, rightEar);
        const yawProxy  = (dLeft - dRight) / (dLeft + dRight + 1e-6);

        const dForehead  = dist2d(noseTip, forehead);
        const dChin      = dist2d(noseTip, chin);
        const pitchProxy = (dForehead - dChin) / (dForehead + dChin + 1e-6);

        // Позиция головы в кадре (0..1)
        const headX = (leftEyeCX + rightEyeCX) / 2;
        const headY = (leftEyeCY + rightEyeCY) / 2;

        // Раскрытие глаз (отношение сторон)
        const leftEAR  = leftEyeH / leftEyeW;
        const rightEAR = rightEyeH / rightEyeW;

        // Термины взаимодействия (iris × поза головы) — описывают нелинейное поведение в углах/по краям
        const irisX_x_yaw = avgIrisX * yawProxy;
        const irisY_x_pitch = avgIrisY * pitchProxy;
        const irisX_x_headX = avgIrisX * headX;
        const irisY_x_headY = avgIrisY * headY;

        return [
            leftNormX,              // 0: X левой радужки
            leftNormY,              // 1: Y левой радужки
            rightNormX,             // 2: X правой радужки
            rightNormY,             // 3: Y правой радужки
            avgIrisX,               // 4: среднее X радужки
            avgIrisY,               // 5: среднее Y радужки
            yawProxy,               // 6: yaw головы
            pitchProxy,             // 7: pitch головы
            headX,                  // 8: X позиции головы в кадре
            headY,                  // 9: Y позиции головы в кадре
            leftEAR,                // 10: раскрытие левого глаза
            rightEAR,               // 11: раскрытие правого глаза
            irisX_x_yaw,            // 12: взаимодействие iris×yaw
            irisY_x_pitch,          // 13: взаимодействие iris×pitch
            irisX_x_headX,          // 14: взаимодействие iris×headX
            irisY_x_headY,          // 15: взаимодействие iris×headY
            1.0                     // 16: bias
        ];
    } catch (e) {
        return null;
    }
}

/**
 * Оценивает уверенность предсказания (0-1) по раскрытию глаз и положению радужки.
 * @param {Array} landmarks - landmarks MediaPipe Face Landmarker (478)
 * @returns {number} оценка уверенности от 0 до 1
 */
export function estimateConfidence(landmarks) {
    if (!landmarks || landmarks.length < MIN_LANDMARKS) return 0;

    try {
        const LM = LANDMARKS;
        const leftIris   = landmarks[LM.LEFT_IRIS_CENTER];
        const rightIris  = landmarks[LM.RIGHT_IRIS_CENTER];
        const leftInner  = landmarks[LM.LEFT_EYE_INNER];
        const leftOuter  = landmarks[LM.LEFT_EYE_OUTER];
        const rightInner = landmarks[LM.RIGHT_EYE_INNER];
        const rightOuter = landmarks[LM.RIGHT_EYE_OUTER];
        const leftTop    = landmarks[LM.LEFT_EYE_TOP];
        const leftBottom = landmarks[LM.LEFT_EYE_BOTTOM];
        const rightTop   = landmarks[LM.RIGHT_EYE_TOP];
        const rightBottom = landmarks[LM.RIGHT_EYE_BOTTOM];

        const leftEyeW  = dist2d(leftInner, leftOuter);
        const leftEyeH  = dist2d(leftTop, leftBottom);
        const rightEyeW = dist2d(rightInner, rightOuter);
        const rightEyeH = dist2d(rightTop, rightBottom);

        const leftEAR  = leftEyeW > 0 ? leftEyeH / leftEyeW : 0;
        const rightEAR = rightEyeW > 0 ? rightEyeH / rightEyeW : 0;

        if (leftEAR < 0.15 || rightEAR < 0.15) return 0.1;

        const leftInBounds = leftIris.x >= Math.min(leftInner.x, leftOuter.x) &&
                             leftIris.x <= Math.max(leftInner.x, leftOuter.x);
        const rightInBounds = rightIris.x >= Math.min(rightInner.x, rightOuter.x) &&
                              rightIris.x <= Math.max(rightInner.x, rightOuter.x);

        let confidence = 0.5;
        if (leftInBounds) confidence += 0.2;
        if (rightInBounds) confidence += 0.2;
        if (leftEAR > 0.2) confidence += 0.05;
        if (rightEAR > 0.2) confidence += 0.05;

        return Math.min(1.0, confidence);
    } catch (e) {
        return 0.3;
    }
}
