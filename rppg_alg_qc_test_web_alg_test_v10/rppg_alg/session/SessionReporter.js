import { median } from "../utils.js";

// SessionReporter:
// - собирает JSON за всю сессию
// - хранит опубликованные значения и "hold" (последний опубликованный)
// - считает диапазон ЧСС за сессию с очисткой нереалистичных выбросов
export class SessionReporter {
  constructor(opts = {}) {
    // Максимум точек в памяти (для длинных сессий).
    // Если null — без лимита.
    this._maxSamples = Number.isFinite(opts.maxSamples) ? opts.maxSamples : null;
    this._samples = [];
    this._startMs = null;
    this._endMs = null;
    this._lastPublished = null;
  }

  // out — результат RppgEngine.update()
  // timestampMs — системное время кадра/окна
  push(out, timestampMs) {
    if (!out || !Number.isFinite(timestampMs)) return;

    if (this._startMs == null) this._startMs = timestampMs;
    this._endMs = timestampMs;

    const published = !!out.published;
    const bpmPublished = Number.isFinite(out.bpmPublished) ? out.bpmPublished : null;
    if (published && bpmPublished != null) this._lastPublished = bpmPublished;

    const bpmHold = (this._lastPublished != null) ? this._lastPublished : null;
    const bpmSmoothed = Number.isFinite(out.bpmSmoothed) ? out.bpmSmoothed : null;
    const confidence = Number.isFinite(out.confidence) ? out.confidence : null;

    const respRate = (out.features && Number.isFinite(out.features.respRate))
      ? out.features.respRate
      : null;

    this._samples.push({
      t_ms: Math.round(timestampMs),
      published,
      publish_reason: out.publishReason ?? null,
      bpm_published: bpmPublished,
      bpm_hold: bpmHold,
      bpm_smoothed: bpmSmoothed,
      confidence,
      resp_rate: respRate,
    });

    if (this._maxSamples != null && this._samples.length > this._maxSamples) {
      // Удаляем самые старые точки, чтобы память не росла бесконечно.
      this._samples.shift();
    }
  }

  // Удаляем только явно нереалистичные выбросы по MAD.
  // Это мягкая очистка: не срезает физиологичные изменения.
  _cleanOutliers(values) {
    const xs = values.filter((v) => Number.isFinite(v));
    if (!xs.length) return [];
    const m = median(xs);
    const dev = xs.map((v) => Math.abs(v - m));
    const mad = median(dev);
    if (!Number.isFinite(mad) || mad === 0) return xs;
    const thr = 3 * mad;
    return xs.filter((v) => Math.abs(v - m) <= thr);
  }

  // finalize — завершает сессию и возвращает итоговые данные
  finalize() {
    const bpmHoldVals = this._samples
      .map((s) => s.bpm_hold)
      .filter((v) => Number.isFinite(v));

    const bpmPubVals = this._samples
      .map((s) => s.bpm_published)
      .filter((v) => Number.isFinite(v));

    const cleanedHold = this._cleanOutliers(bpmHoldVals);
    const cleanedPub = this._cleanOutliers(bpmPubVals);

    const minHold = cleanedHold.length ? Math.min(...cleanedHold) : null;
    const maxHold = cleanedHold.length ? Math.max(...cleanedHold) : null;

    const minPub = cleanedPub.length ? Math.min(...cleanedPub) : null;
    const maxPub = cleanedPub.length ? Math.max(...cleanedPub) : null;

    return {
      session: {
        start_ms: this._startMs,
        end_ms: this._endMs,
        samples: this._samples.length,
      },
      range_bpm: {
        hold: { min: minHold, max: maxHold, count: cleanedHold.length },
        published: { min: minPub, max: maxPub, count: cleanedPub.length },
      },
      samples: this._samples,
    };
  }
}
