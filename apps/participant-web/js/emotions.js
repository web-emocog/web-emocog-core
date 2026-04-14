/**
 * Emotion analyzer module based on landmarks geometry.
 * Adapted from upstream emotions-module/security2 with stable API for updated flow.
 */

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function dist3(p1, p2) {
    const dx = (p1?.x || 0) - (p2?.x || 0);
    const dy = (p1?.y || 0) - (p2?.y || 0);
    const dz = (p1?.z || 0) - (p2?.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class EmotionAnalyzer {
    constructor() {
        this.labels = ['neutral', 'happiness', 'sadness', 'anger', 'fear', 'surprise', 'disgust'];
        this.window = [];
        this.windowSize = 4;
    }

    analyzeLandmarks(landmarks) {
        if (!Array.isArray(landmarks) || landmarks.length < 400) {
            return this.defaultResult();
        }

        const leftEyeOpen = dist3(landmarks[159], landmarks[145]);
        const rightEyeOpen = dist3(landmarks[386], landmarks[374]);
        const eyeOpenness = (leftEyeOpen + rightEyeOpen) / 2;

        const leftMouth = landmarks[61];
        const rightMouth = landmarks[291];
        const topLip = landmarks[13];
        const bottomLip = landmarks[14];
        const leftEyebrow = landmarks[70];
        const rightEyebrow = landmarks[300];
        const noseTip = landmarks[1];

        const mouthWidth = dist3(leftMouth, rightMouth);
        const mouthOpen = dist3(topLip, bottomLip);
        const mouthCurvature = ((leftMouth?.y || 0) + (rightMouth?.y || 0)) / 2 - (topLip?.y || 0);
        const eyebrowHeight = (((leftEyebrow?.y || 0) + (rightEyebrow?.y || 0)) / 2) - (noseTip?.y || 0);

        const scores = {
            neutral: 0.18,
            happiness: 0,
            sadness: 0,
            anger: 0,
            fear: 0,
            surprise: 0,
            disgust: 0
        };

        if (mouthWidth > 0.11 && mouthCurvature < -0.006) {
            scores.happiness = Math.min(1.0, mouthWidth * 4.2 + Math.abs(mouthCurvature) * 14);
        }
        if (mouthCurvature > 0.003 && eyeOpenness < 0.024) {
            scores.sadness = Math.min(0.9, mouthCurvature * 62 + (0.028 - eyeOpenness) * 24);
        }
        if (eyeOpenness > 0.026 && mouthOpen > 0.024 && eyebrowHeight < -0.042) {
            scores.surprise = Math.min(0.95, eyeOpenness * 18 + mouthOpen * 18);
        }
        if (eyebrowHeight > -0.028 && mouthWidth < 0.13) {
            scores.anger = Math.min(0.85, (0.024 + eyebrowHeight) * 26);
        }
        if (eyeOpenness > 0.022 && mouthOpen > 0.012 && mouthOpen < 0.034) {
            scores.fear = Math.min(0.85, eyeOpenness * 14 + mouthOpen * 12);
        }
        if (mouthCurvature > 0.002 && (topLip?.y || 0) < (noseTip?.y || 0) + 0.022) {
            scores.disgust = Math.min(0.75, mouthCurvature * 36);
        }

        const total = Object.values(scores).reduce((s, v) => s + v, 0) || 1;
        Object.keys(scores).forEach((k) => {
            scores[k] = scores[k] / total;
        });

        this.window.push(scores);
        if (this.window.length > this.windowSize) this.window.shift();
        const smooth = this.smoothScores();

        const positive = (smooth.happiness || 0) + (smooth.surprise || 0) * 0.5;
        const negative = (smooth.sadness || 0) + (smooth.anger || 0) + (smooth.fear || 0) + (smooth.disgust || 0);
        const valence = clamp(positive - negative, -1, 1);

        const highArousal = (smooth.anger || 0) + (smooth.fear || 0) + (smooth.surprise || 0);
        const lowArousal = (smooth.sadness || 0) + (smooth.neutral || 0);
        const arousal = clamp(highArousal / (highArousal + lowArousal + 0.001), 0, 1);

        const dominant = this.labels.reduce((best, label) => (smooth[label] > smooth[best] ? label : best), 'neutral');
        return { scores: smooth, valence, arousal, dominant };
    }

    smoothScores() {
        const out = {};
        this.labels.forEach((label) => {
            const vals = this.window.map((s) => s[label] || 0);
            out[label] = vals.reduce((sum, v) => sum + v, 0) / (vals.length || 1);
        });
        return out;
    }

    defaultResult() {
        return {
            scores: { neutral: 1, happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
            valence: 0,
            arousal: 0,
            dominant: 'neutral'
        };
    }
}

