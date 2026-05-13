/**
 * AU Extractor — вычисление 16 Action Units по FACS и внутренняя маска лица.
 *
 * Все коэффициенты берутся из EMOTION_CONFIG.au.
 * Все AU строго в [0, 1].
 *
 * @module au-extractor
 * @version 1.0.0
 */

import { EMOTION_CONFIG } from './emotion-config.js';

// ── Утилиты ───────────────────────────────────────────────────────────────────

/** Ограничение значения в диапазоне [min, max] */
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/** 3D евклидово расстояние */
function dist3(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ── Маска лица ────────────────────────────────────────────────────────────────

/**
 * Строит внутреннюю маску лица без FaceMaskCollector.
 * @param {Array} lm — landmarks
 * @returns {{ zones, geometry, symmetry }}
 */
export function buildInternalMask(lm) {
    const faceWidth  = dist3(lm[234], lm[454]);
    const faceHeight = dist3(lm[10],  lm[152]);
    const normFactor = Math.sqrt(faceWidth ** 2 + faceHeight ** 2) || 1;

    return {
        zones:    _extractZones(lm),
        geometry: _calcGeometry(lm, faceWidth, faceHeight),
        symmetry: _calcSymmetry(lm, faceWidth, normFactor),
    };
}

function _extractZones(lm) {
    const zone = (indices) => {
        let sx = 0, sy = 0, sz = 0;
        for (const i of indices) { sx += lm[i].x; sy += lm[i].y; sz += (lm[i].z || 0); }
        const n = indices.length;
        return { x: +(sx / n).toFixed(4), y: +(sy / n).toFixed(4), z: +(sz / n).toFixed(4) };
    };
    return {
        forehead:     zone([10, 338, 297, 332, 284, 251, 389, 356, 454]),
        leftEyebrow:  zone([70, 63, 105, 66, 107]),
        rightEyebrow: zone([300, 293, 334, 296, 336]),
        leftEye:      zone([33, 160, 158, 133, 153, 144, 145, 159]),
        rightEye:     zone([362, 385, 387, 263, 373, 380, 374, 386]),
        nose:         zone([1, 2, 98, 327, 168, 6, 197, 195, 5]),
        upperLip:     zone([61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]),
        lowerLip:     zone([146, 91, 181, 84, 17, 314, 405, 321, 375]),
        leftCheek:    zone([116, 111, 117, 118, 119, 100, 47, 126]),
        rightCheek:   zone([345, 340, 346, 347, 348, 329, 277, 355]),
        jaw:          zone([172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323]),
    };
}

function _calcGeometry(lm, faceWidth, faceHeight) {
    return {
        faceWidth:        +faceWidth.toFixed(4),
        faceHeight:       +faceHeight.toFixed(4),
        leftEyeOpenness:  +dist3(lm[159], lm[145]).toFixed(4),
        rightEyeOpenness: +dist3(lm[386], lm[374]).toFixed(4),
        mouthWidth:       +dist3(lm[61],  lm[291]).toFixed(4),
        mouthOpenness:    +dist3(lm[13],  lm[14]).toFixed(4),
        mouthCurvature:   +((lm[61].y + lm[291].y) / 2 - lm[13].y).toFixed(4),
        headTilt:         +Math.atan2(lm[263].y - lm[33].y, lm[263].x - lm[33].x).toFixed(4),
    };
}

function _calcSymmetry(lm, faceWidth, normFactor) {
    const nose = lm[1];
    const pairs = [[33, 263], [61, 291], [234, 454], [127, 356]];
    let totalAsymmetry = 0;
    const pairValues = [];

    for (const [li, ri] of pairs) {
        const lp = lm[li], rp = lm[ri];
        const asymmetry = (Math.abs(Math.abs(lp.x - nose.x) - Math.abs(rp.x - nose.x)) +
                           Math.abs(lp.y - rp.y)) / normFactor;
        pairValues.push(+asymmetry.toFixed(4));
        totalAsymmetry += asymmetry;
    }

    return {
        overall: +(totalAsymmetry / pairs.length).toFixed(4),
        pairs:   pairValues,
    };
}

// ── Извлечение Action Units ───────────────────────────────────────────────────

/**
 * Вычисляет 16 Action Units по FACS.
 * Коэффициенты берутся из EMOTION_CONFIG.au.
 *
 * @param {Array}  lm       — landmarks (минимум 468 точек)
 * @param {Object} [geometry] — предвычисленная геометрия из маски
 * @returns {Object} AU1..AU27, все значения в [0, 1]
 */
export function extractActionUnits(lm, geometry = null) {
    const C = EMOTION_CONFIG.au;

    // Ключевые точки
    const lEyeTop  = lm[159], lEyeBot  = lm[145];
    const rEyeTop  = lm[386], rEyeBot  = lm[374];
    const lMouth   = lm[61],  rMouth   = lm[291];
    const topLip   = lm[13],  botLip   = lm[14];
    const noseTip  = lm[1];
    const lBrowOut = lm[70],  lBrowIn  = lm[107];
    const rBrowOut = lm[300], rBrowIn  = lm[336];
    const lCheek   = lm[117], rCheek   = lm[346];
    const upLipCtr = lm[0],   loLipCtr = lm[17];
    const lNostril = lm[203], rNostril = lm[423];
    const chin     = lm[152], forehead = lm[10];

    const faceH      = geometry?.faceHeight ?? dist3(forehead, chin);
    const faceW      = geometry?.faceWidth  ?? dist3(lm[234], lm[454]);
    const normFactor = Math.sqrt(faceH ** 2 + faceW ** 2) || 1;

    // AU1: внутренний подъём брови
    const AU1 = clamp(
        ((noseTip.y - lBrowIn.y) + (noseTip.y - rBrowIn.y)) / normFactor * C.browRaiseScale,
        0, 1
    );

    // AU2: внешний подъём брови
    const AU2 = clamp(
        ((noseTip.y - lBrowOut.y) + (noseTip.y - rBrowOut.y)) / normFactor * C.browRaiseScale,
        0, 1
    );

    // AU4: сведение бровей
    const browDist = dist3(lBrowIn, rBrowIn) / faceW;
    const AU4 = clamp(C.browFurrowThresh - browDist * C.browFurrowSlope, 0, 1);

    // AU5: широко открытые глаза
    const lEyeOpen = dist3(lEyeTop, lEyeBot) / normFactor;
    const rEyeOpen = dist3(rEyeTop, rEyeBot) / normFactor;
    const AU5 = clamp((lEyeOpen + rEyeOpen) * C.eyeOpenScale, 0, 1);

    // AU6: поднятие щёк
    const lCheekDist = dist3(lCheek, lEyeBot) / normFactor;
    const rCheekDist = dist3(rCheek, rEyeBot) / normFactor;
    const AU6 = clamp((C.cheekNormalDist - (lCheekDist + rCheekDist) / 2) * C.cheekRaiseSlope, 0, 1);

    // AU7: сужение век (активно при малом открытии)
    const eyeAvg = (lEyeOpen + rEyeOpen) / 2;
    const AU7 = clamp((C.lidTightThresh - eyeAvg) * C.lidTightSlope, 0, 1);

    // AU9: сморщивание носа
    const nostrilDist = dist3(lNostril, rNostril) / normFactor;
    const AU9 = clamp(C.noseWrinkleThresh - nostrilDist * C.noseWrinkleSlope, 0, 1);

    // AU10: поднятие верхней губы
    const upLipRaise = (noseTip.y - upLipCtr.y) / normFactor;
    const AU10 = clamp((C.upperLipThresh - upLipRaise) * C.upperLipSlope, 0, 1);

    // AU12: растяжение уголков губ (улыбка)
    const mouthW = dist3(lMouth, rMouth) / faceW;
    const AU12 = clamp((mouthW - C.smileThresh) * C.smileSlope, 0, 1);

    // AU15: опускание уголков губ
    const cornerH = ((lMouth.y + rMouth.y) / 2 - upLipCtr.y) / normFactor;
    const AU15 = clamp((cornerH - C.lipCornerDepThresh) * C.lipCornerDepSlope, 0, 1);

    // AU17: поднятие подбородка
    const chinRaise = (loLipCtr.y - chin.y) / normFactor;
    const AU17 = clamp((C.chinRaiseThresh - chinRaise) * C.chinRaiseSlope, 0, 1);

    // AU20: горизонтальное растяжение губ (страх)
    const AU20 = clamp((mouthW - C.lipStretchThresh) * C.lipStretchSlope, 0, 1);

    // AU23: сжатие губ
    const lipTight = dist3(upLipCtr, loLipCtr) / normFactor;
    const AU23 = clamp((C.lipTightThresh - lipTight) * C.lipTightSlope, 0, 1);

    // AU25: разделение губ
    const mouthOpen = dist3(topLip, botLip) / normFactor;
    const AU25 = clamp(mouthOpen * C.lipPartScale, 0, 1);

    // AU26: отвисание челюсти
    const jawDrop = dist3(upLipCtr, loLipCtr) / normFactor;
    const AU26 = clamp((jawDrop - C.jawDropThresh) * C.jawDropSlope, 0, 1);

    // AU27: широкое открытие рта
    const AU27 = clamp((mouthOpen - C.mouthStretchThresh) * C.mouthStretchSlope, 0, 1);

    return { AU1, AU2, AU4, AU5, AU6, AU7, AU9, AU10, AU12, AU15, AU17, AU20, AU23, AU25, AU26, AU27 };
}