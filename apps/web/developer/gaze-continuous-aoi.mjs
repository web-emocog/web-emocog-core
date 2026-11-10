// Local-only two-model evaluation. Visual cues label requested fixations
// for the evaluator, never for the predictor. No positions leave this module.
export const AOI_PRESENTATION_MS = 6000;
export const AOI_TRANSITION_MS = 700;
export const AOI_MAX_OVERRUN_MS = 500;
export const AOI_SIGNAL_KEYS = Object.freeze(['baseline.raw', 'baseline.corrected', 'eye_patch.raw', 'eye_patch.corrected']);
const bands = [.16, .33, .50, .67, .84];
const orders = [
  [0, 7, 4, 9, 2, 5, 8, 1, 6, 3, 9, 0, 5, 2, 7, 4, 3, 8, 1, 6],
  [8, 3, 6, 1, 4, 7, 0, 9, 2, 5, 7, 2, 9, 4, 1, 6, 5, 0, 3, 8],
];
export const AOI_PRESENTATIONS = Object.freeze(orders.flatMap((order, half) => order.map((condition, i) =>
  Object.freeze({ index: half * 20 + i, half: half ? 'late' : 'early',
    targetSide: condition % 2 ? 'right' : 'left', band: Math.floor(condition / 2),
    inset: i < 10 ? 'outer' : 'inner' }))));

export function aoiTrialLayout(trial) {
  const y = bands[trial.band];
  const left = { left: .075, right: .43, top: y - .095, bottom: y + .095 };
  const right = { left: .57, right: .925, top: left.top, bottom: left.bottom };
  const x = trial.targetSide === 'left' ? (trial.inset === 'outer' ? .15 : .34) : (trial.inset === 'outer' ? .85 : .66);
  return { left, right, cue: { x, y } };
}

export function insideAoiRectangle(x, y, rect) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

const freshCounts = () => ({ target: 0, other: 0, outsideAoi: 0, offScreen: 0, missing: 0 });
const freshPair = () => ({ common: 0, bothHit: 0, onlyBaselineHit: 0, onlyPatchHit: 0, neitherHit: 0,
  baselineErrorSumPx: 0, patchErrorSumPx: 0 });
const fraction = (n, d) => d ? n / d : null;

function summarizeFixations(entry, layout, trial) {
  const result = { fixationCount: entry?.fixationCountTotal ?? 0, truncated: entry?.fixationsTruncated === true,
    validObservationMs: entry?.validObservationDurationMs ?? 0,
    targetDwellMs: 0, otherDwellMs: 0, outsideAoiDwellMs: 0, reachedTarget: false };
  if (result.truncated) return { ...result, targetDwellMs: null, otherDwellMs: null, outsideAoiDwellMs: null, reachedTarget: null };
  for (const f of entry?.fixationPoints ?? []) {
    if (insideAoiRectangle(f.x, f.y, layout[trial.targetSide])) {
      result.targetDwellMs += f.durationMs; result.reachedTarget = true;
    } else if (insideAoiRectangle(f.x, f.y, layout[trial.targetSide === 'left' ? 'right' : 'left'])) {
      result.otherDwellMs += f.durationMs;
    } else result.outsideAoiDwellMs += f.durationMs;
  }
  return result;
}

export function createAoiTrialRecorder(trial, geometry, viewport, startedAt, createHeatmapAccumulator) {
  const { board, left, right, cue } = geometry;
  const layout = { left, right };
  const cueX = board.left + cue.x * board.width, cueY = board.top + cue.y * board.height;
  const streams = Object.fromEntries(AOI_SIGNAL_KEYS.map(key => [key, {
    frames: freshCounts(), fixation: createHeatmapAccumulator({ gridWidth: 1, gridHeight: 1,
      screenWidth: viewport.width, screenHeight: viewport.height }),
  }]));
  const pairs = { raw: freshPair(), corrected: freshPair() };
  let last = -Infinity, measured = 0, outsideWindow = 0, duplicate = 0, sealed = false;
  return {
    observe(timestamp, predictions) {
      if (sealed) return;
      if (!Number.isFinite(timestamp) || timestamp < startedAt + AOI_TRANSITION_MS || timestamp >= startedAt + AOI_PRESENTATION_MS) {
        outsideWindow++; return;
      }
      if (timestamp <= last) { duplicate++; return; }
      last = timestamp; measured++;
      const labels = {}, errors = {};
      for (const key of AOI_SIGNAL_KEYS) {
        const [model, type] = key.split('.');
        const point = predictions?.[model];
        const x = point?.[type + 'X'], y = point?.[type + 'Y'];
        const valid = point?.valid === true && Number.isFinite(x) && Number.isFinite(y);
        const onScreen = valid && x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height
          && (type !== 'corrected' || point.onScreen === true);
        const nx = (x - board.left) / board.width, ny = (y - board.top) / board.height;
        const label = !valid ? 'missing' : !onScreen ? 'offScreen'
          : insideAoiRectangle(nx, ny, layout[trial.targetSide]) ? 'target'
          : insideAoiRectangle(nx, ny, layout[trial.targetSide === 'left' ? 'right' : 'left']) ? 'other' : 'outsideAoi';
        labels[key] = label;
        if (valid) errors[key] = Math.hypot(x - cueX, y - cueY);
        streams[key].frames[label]++;
        // Identical streaming fixation construction to the participant runtime.
        // Never invent coordinates for missing samples; let its timestamp/gap
        // rules handle them. All fixation points stay local until reduction.
        streams[key].fixation.add({ t: timestamp, tRelMs: timestamp - startedAt, valid, onScreen,
          ...(valid ? { correctedX: x, correctedY: y, confidence: point.confidence } : {}),
          screenWidth: viewport.width, screenHeight: viewport.height, phase: 'cognitive_stimulus',
          blockId: 'local-aoi', presentationId: String(trial.index + 1), stimulusId: 'local-pair', stimulusRect: board });
      }
      for (const [type, p] of Object.entries(pairs)) {
        const b = labels['baseline.' + type], a = labels['eye_patch.' + type];
        if (a === 'missing' || b === 'missing') continue;
        p.common++;
        p.baselineErrorSumPx += errors['baseline.' + type];
        p.patchErrorSumPx += errors['eye_patch.' + type];
        p[a === 'target' ? b === 'target' ? 'bothHit' : 'onlyPatchHit' : b === 'target' ? 'onlyBaselineHit' : 'neitherHit']++;
      }
    },
    finish(presentedMs) {
      if (sealed) throw Error('aoi_trial_already_closed');
      sealed = true;
      return { presentation: trial.index + 1, half: trial.half, targetSide: trial.targetSide, band: trial.band, inset: trial.inset,
        presentedMs, measured, outsideWindow, duplicate, pairs,
        signals: Object.fromEntries(Object.entries(streams).map(([key, s]) =>
          [key, { frames: s.frames, fixation: summarizeFixations(s.fixation.finalize().perStimulus[0], layout, trial) }])) };
    },
  };
}

function summarizeAoiWindows(rows) {
  const sum = values => values.reduce((total, n) => total + n, 0);
  const measured = sum(rows.map(row => row.measured));
  const signals = Object.fromEntries(AOI_SIGNAL_KEYS.map(key => {
    const windows = rows.map(row => row.signals[key]);
    const frames = Object.fromEntries(Object.keys(freshCounts()).map(label => [label, sum(windows.map(w => w.frames[label]))]));
    const nonempty = rows.filter(row => row.measured);
    const fixation = windows.filter(w => !w.fixation.truncated);
    const observation = sum(fixation.map(w => w.fixation.validObservationMs));
    const targetDwellMs = sum(fixation.map(w => w.fixation.targetDwellMs));
    return [key, { frames, measured, presentedWindows: rows.length, windowsWithFrames: nonempty.length,
      equalWindowTargetHitFraction: fraction(sum(nonempty.map(r => r.signals[key].frames.target / r.measured)), nonempty.length),
      targetHitFractionOfAccepted: fraction(frames.target, measured - frames.missing),
      missingFraction: fraction(frames.missing, measured),
      reachedTargetWindows: fixation.filter(w => w.fixation.reachedTarget).length,
      truncatedWindows: windows.length - fixation.length, targetDwellMs, validObservationMs: observation,
      otherDwellMs: sum(fixation.map(w => w.fixation.otherDwellMs)),
      outsideAoiDwellMs: sum(fixation.map(w => w.fixation.outsideAoiDwellMs)),
      targetDwellFractionOfValidObservation: fraction(targetDwellMs, observation) }];
  }));
  const pairs = Object.fromEntries(['raw', 'corrected'].map(type => {
    const p = Object.fromEntries(Object.keys(freshPair()).map(key => [key, sum(rows.map(r => r.pairs[type][key]))]));
    const comparable = rows.filter(r => r.pairs[type].common > 0);
    return [type, { ...p, comparableWindows: comparable.length, equalWindowTargetHitDelta: fraction(sum(comparable.map(r =>
      (r.pairs[type].onlyPatchHit - r.pairs[type].onlyBaselineHit) / r.pairs[type].common)), comparable.length),
      equalWindowBaselineErrorPx: fraction(sum(comparable.map(r => r.pairs[type].baselineErrorSumPx / r.pairs[type].common)), comparable.length),
      equalWindowPatchErrorPx: fraction(sum(comparable.map(r => r.pairs[type].patchErrorSumPx / r.pairs[type].common)), comparable.length) }];
  }));
  return { measured, presentations: rows.length, signals, pairs };
}

export function summarizeAoiBlock(rows) {
  return Object.fromEntries([
    ['all', rows], ['early', rows.filter(row => row.half === 'early')], ['late', rows.filter(row => row.half === 'late')],
    ['lowerEarly', rows.filter(row => row.half === 'early' && row.band >= 3)],
    ['lowerLate', rows.filter(row => row.half === 'late' && row.band >= 3)],
  ].map(([key, entries]) => [key, summarizeAoiWindows(entries)]));
}
