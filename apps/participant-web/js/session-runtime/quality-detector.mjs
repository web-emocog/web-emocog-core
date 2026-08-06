import { ERROR_KINDS } from './contracts.mjs';

const QUALITY_RULES = Object.freeze({
    face_missing: {
        holdMs: 1500,
        message: 'Лицо не видно. Вернитесь в кадр.'
    },
    low_light: {
        holdMs: 2500,
        message: 'Освещение недостаточно для надёжного измерения.'
    },
    head_pose: {
        holdMs: 2500,
        message: 'Положение головы длительно мешает измерению.'
    },
    face_occluded: {
        holdMs: 2000,
        message: 'Часть лица закрыта.'
    },
    low_fps: {
        holdMs: 3000,
        message: 'Частота кадров камеры длительно ниже допустимой.'
    }
});

function hasBadIllumination(frame) {
    const status = String(frame?.illumination?.status || '').toLowerCase();
    return ['too_dark', 'too_bright', 'dark', 'bright', 'error'].includes(status);
}

function hasBadPose(frame) {
    const pose = frame?.pose;
    if (!pose) return false;
    const status = String(pose.status || '').toLowerCase();
    return pose.isTilted === true
        || pose.isStable === false
        || ['tilted', 'unstable', 'off_center', 'error'].includes(status);
}

function hasOcclusion(segmenterResult) {
    const visibility = segmenterResult?.faceVisibility;
    if (!visibility) return false;
    const issues = segmenterResult?.issues || visibility.issues || [];
    return visibility.handDetected === true
        || (Array.isArray(issues) && issues.some(
            issue => issue === 'hand_on_face' || String(issue).includes('hand_occluded')
        ));
}

function hasAnalysisError(frame) {
    return frame?.error === true
        || (typeof frame?.error === 'string' && frame.error.length > 0)
        || (typeof frame?.errorMessage === 'string' && frame.errorMessage.length > 0);
}

export class SessionQualityDetector {
    constructor(options = {}) {
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.rules = { ...QUALITY_RULES, ...(options.rules || {}) };
        this.firstSeen = new Map();
        this.active = new Map();
        this.analysisFailureCount = 0;
    }

    _conditions(frame, segmenterResult, context) {
        const cameraFps = Number(context?.cameraFps);
        return {
            face_missing: frame?.face?.detected === false,
            low_light: hasBadIllumination(frame),
            head_pose: hasBadPose(frame),
            face_occluded: hasOcclusion(segmenterResult),
            low_fps: Number.isFinite(cameraFps) && cameraFps > 0 && cameraFps < 12
        };
    }

    update(frame, segmenterResult = null, now = this.now(), context = {}) {
        const raised = [];
        const resolved = [];

        if (hasAnalysisError(frame)) {
            this.analysisFailureCount += 1;
        } else {
            this.analysisFailureCount = 0;
        }

        if (this.analysisFailureCount >= 3 && !this.active.has('frame_analysis_failed')) {
            const issue = {
                kind: ERROR_KINDS.TECHNICAL,
                code: 'frame_analysis_failed',
                message: frame?.errorMessage || frame?.error || 'Не удалось обработать видеокадры.',
                recoverable: true,
                timestamp: now
            };
            this.active.set(issue.code, issue);
            raised.push(issue);
        }
        if (this.analysisFailureCount === 0 && this.active.has('frame_analysis_failed')) {
            this.active.delete('frame_analysis_failed');
            resolved.push('frame_analysis_failed');
        }

        const conditions = this._conditions(frame, segmenterResult, context);
        for (const [code, isBad] of Object.entries(conditions)) {
            if (!isBad) {
                this.firstSeen.delete(code);
                if (this.active.has(code)) {
                    this.active.delete(code);
                    resolved.push(code);
                }
                continue;
            }

            if (!this.firstSeen.has(code)) this.firstSeen.set(code, now);
            const rule = this.rules[code];
            if (!this.active.has(code) && now - this.firstSeen.get(code) >= rule.holdMs) {
                const issue = {
                    kind: ERROR_KINDS.QUALITY,
                    code,
                    message: rule.message,
                    recoverable: true,
                    timestamp: now
                };
                this.active.set(code, issue);
                raised.push(issue);
            }
        }

        return { raised, resolved };
    }

    reset() {
        this.firstSeen.clear();
        this.active.clear();
        this.analysisFailureCount = 0;
    }
}
