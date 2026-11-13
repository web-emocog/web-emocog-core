import { EmotionAnalyzer } from '../../participant-web/js/emotion/emotion-analyzer.js?v=20261112-emotion2';
import { extractActionUnits } from '../../participant-web/js/emotion/au-extractor.js?v=20261112-emotion1';
import { EMOTION_CONFIG } from '../../participant-web/js/emotion/emotion-config.js';

export const GEOMETRY_METHOD = 'neutral_geometry.experimental.v1';

// Developer-only feature scales. These are engineering starting values, not fitted
// or validated AU intensities. Classifier gates and calibration settings are shared.
export const GEOMETRY_SCALES = Object.freeze({
    AU1: 5, AU2: 5, AU4: 3, AU5: 4, AU10: 10, AU15: 10, AU17: 10,
});

/** Unclipped signed geometry in image-normalized coordinates. No raw mesh retained.
 * Roll is removed in this coordinate space. Yaw/pitch and image aspect changes are
 * not corrected; use the same camera configuration throughout an A/B run.
 */
export function measureEmotionGeometry(lm) {
    const used = [33,263,234,454,133,362,159,145,386,374,107,336,70,300,0,17,18,13,14,61,291,2];
    if (!used.every(i => Number.isFinite(lm?.[i]?.x) && Number.isFinite(lm?.[i]?.y))) {
        throw new Error('Invalid geometry points');
    }
    const dx = lm[263].x - lm[33].x, dy = lm[263].y - lm[33].y;
    const eyeSpan = Math.hypot(dx,dy);
    const faceWidth = Math.hypot(lm[454].x-lm[234].x,lm[454].y-lm[234].y);
    if (!(eyeSpan > 0 && faceWidth > 0)) throw new Error('Degenerate geometry');
    const ux=dx/eyeSpan, uy=dy/eyeSpan;
    const y=i => ((lm[i].x-lm[33].x)*-uy+(lm[i].y-lm[33].y)*ux)/faceWidth;
    const distance=(a,b) => Math.hypot(lm[a].x-lm[b].x,lm[a].y-lm[b].y);
    const leftWidth=distance(33,133), rightWidth=distance(362,263);
    if (!(leftWidth > 0 && rightWidth > 0)) throw new Error('Degenerate eye width');
    const leftEyeCenter=(y(33)+y(133))/2, rightEyeCenter=(y(362)+y(263))/2;
    return {
        innerBrowHeight: ((leftEyeCenter-y(107))+(rightEyeCenter-y(336)))/2,
        outerBrowHeight: ((leftEyeCenter-y(70))+(rightEyeCenter-y(300)))/2,
        innerBrowDistance: distance(107,336)/faceWidth,
        leftEyeAspect: distance(159,145)/leftWidth,
        rightEyeAspect: distance(386,374)/rightWidth,
        // Subnasal anchor 2 to upper outer lip 0: raising lip reduces the gap.
        upperLipGap: y(0)-y(2),
        // Symmetric lip opening moves 13/14 in opposite directions: midpoint stays.
        cornerOffset: (y(61)+y(291))/2-(y(13)+y(14))/2,
        mouthOpening: y(14)-y(13),
        // Lower lip 17 to upper chin 18, not the mobile jaw tip 152.
        // Reduced gap is a chin-raise proxy, not a measurement of muscle tension.
        chinLipGap: y(18)-y(17),
    };
}

export class GeometryEmotionAnalyzer extends EmotionAnalyzer {
    _extractActionUnits(lm, geometry) {
        const raw = extractActionUnits(lm,geometry);
        this.legacyUnclippedAU=extractActionUnits(lm,geometry,{unclipped:true});
        const g = measureEmotionGeometry(lm);
        this.featureGeometry=g;
        const features = {
            AU1:g.innerBrowHeight, AU2:g.outerBrowHeight, AU4:-g.innerBrowDistance,
            AU5:(g.leftEyeAspect+g.rightEyeAspect)/2,
            AU10:-g.upperLipGap, AU15:g.cornerOffset, AU17:-g.chinLipGap,
        };
        // Signed, unbounded features are calibrated BEFORE clipping to [0,1].
        // Other nine AUs retain their original extraction for this experiment.
        for(const [au,value] of Object.entries(features)) raw[au]=value*GEOMETRY_SCALES[au];
        return raw;
    }

    _validateRawActionUnits(values) {
        if(Object.keys(values).length!==16 || !Object.values(values).every(Number.isFinite)) {
            throw new Error('Non-finite experimental feature');
        }
    }

    _featureDiagnostics() {
        return { featureMethod:GEOMETRY_METHOD, unclippedGeometry:{...this.featureGeometry},
            legacyUnclippedAU:{...this.legacyUnclippedAU} };
    }

    getCalibrationDiagnostics() {
        return { ...super.getCalibrationDiagnostics(), featureMethod:GEOMETRY_METHOD,
            featureScales:{...GEOMETRY_SCALES}, adaptiveRate:this.requireExplicitBaseline ? 0 : EMOTION_CONFIG.baseline.adaptiveRate,
            baselineUnits:'scaled signed geometry for AU1/2/4/5/10/15/17; legacy AU for others' };
    }

    clear() { super.clear(); this.featureGeometry=null; this.legacyUnclippedAU=null; }
}
