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

// Diagnostic mirror of the participant heatmap's fixation grouping (v1.2.0).
// It does not supply metrics to that accumulator. Check against its output
// before reporting counts, so a future grouping change cannot silently mislead.
const grouping = { gapMs: 100, dispersionNorm: .04, minimumMs: 100 };
const rejectionKeys = ['no_prediction', 'low_confidence', 'head_out_of_distribution', 'iris_out_of_distribution',
  'invalid_feature_distribution', 'non_finite_prediction', 'other'];
const splitKeys = ['gapOnly', 'dispersionOnly', 'gapAndDispersion', 'presentationEnd'];
const unavailableKeys = ['missing', 'offScreen', 'outsideBoard', 'withoutObservedLoss'];
const countsFor = keys => Object.fromEntries(keys.map(key => [key, 0]));
const diagnosticVersion = 'aoi_fixation_diagnostics.v1';
const count = n => Number.isSafeInteger(n) && n >= 0;
const sumCounts = (counts, keys) => counts && keys.every(key => count(counts[key]))
  ? keys.reduce((total, key) => total + counts[key], 0) : NaN;

// Older reports have no diagnostic section. When present, validate its fixed
// shape and conservation of frames/groups before recomputing its aggregates.
export function validAoiFixationDiagnostics(d, frames, fixation, presentedMs) {
  if (d === undefined) return true;
  if (d?.version !== diagnosticVersion || sumCounts(d.missingReasons, rejectionKeys) !== frames.missing
    || !count(d.outsideBoardFrames) || d.outsideBoardFrames > frames.outsideAoi) return false;
  const g = d.grouping;
  if (g === null) return true;
  const splits = sumCounts(g?.splits, splitKeys), short = sumCounts(g?.shortGroups, splitKeys);
  return !fixation.truncated && splits - short === fixation.fixationCount && g.splits.presentationEnd <= 1
    && splits <= frames.target + frames.other + frames.outsideAoi - d.outsideBoardFrames
    && splitKeys.every(key => g.shortGroups[key] <= g.splits[key])
    && sumCounts(g.gapContext, unavailableKeys) === g.splits.gapOnly + g.splits.gapAndDispersion
    && Number.isFinite(g.shortGroupMs) && g.shortGroupMs >= 0 && g.shortGroupMs <= presentedMs;
}

function createFixationDiagnostics() {
  const splits = countsFor(splitKeys), shortGroups = countsFor(splitKeys), gapContext = countsFor(unavailableKeys);
  const missingReasons = countsFor(rejectionKeys);
  let group = null, lastFiniteAt = null, outsideBoardFrames = 0, qualifiedGroups = 0, qualifiedMs = 0, shortGroupMs = 0;
  let loss = null;
  const close = reason => {
    if (!group) return;
    splits[reason]++;
    if (group.duration >= grouping.minimumMs && group.last - group.first >= grouping.minimumMs) {
      qualifiedGroups++; qualifiedMs += group.duration;
    } else { shortGroups[reason]++; shortGroupMs += group.duration; }
    group = null;
  };
  return {
    observe(at, label, x, y, point) {
      // The production accumulator's dt clock advances for finite coordinates
      // including off-screen estimates, but not for missing ones.
      const dt = lastFiniteAt === null ? 33 : Math.min(at - lastFiniteAt, 100);
      if (label !== 'missing') lastFiniteAt = at;
      if (label === 'missing') {
        const reason = point == null ? 'no_prediction' : point.rejectionReason;
        missingReasons[rejectionKeys.includes(reason) ? reason : 'other']++;
      }
      const outsideBoard = label !== 'missing' && label !== 'offScreen' && (x < 0 || x > 1 || y < 0 || y > 1);
      if (outsideBoard) outsideBoardFrames++;
      if (label === 'missing' || label === 'offScreen' || outsideBoard) {
        if (group) loss = outsideBoard ? 'outsideBoard' : label;
        return;
      }
      if (group) {
        const gap = at - group.last > grouping.gapMs;
        const dispersed = Math.hypot(x - group.x / group.n, y - group.y / group.n) > grouping.dispersionNorm;
        if (gap) gapContext[loss ?? 'withoutObservedLoss']++;
        if (gap || dispersed) close(gap ? dispersed ? 'gapAndDispersion' : 'gapOnly' : 'dispersionOnly');
      }
      group ??= { x: 0, y: 0, n: 0, first: at, last: at, duration: 0 };
      group.x += x; group.y += y; group.n++; group.last = at; group.duration += dt;
      loss = null;
    },
    finish(entry) {
      close('presentationEnd');
      const actualMs = (entry?.fixationPoints ?? []).reduce((total, f) => total + f.durationMs, 0);
      const parameters = entry?.algorithm?.parameters;
      const groupingMatches = (!entry || (entry.algorithm?.id === 'idt-fixation-heatmap'
        && entry.algorithm?.version === '1.2.0' && parameters?.maxGapMs === grouping.gapMs
        && parameters?.dispersionNorm === grouping.dispersionNorm && parameters?.minDurationMs === grouping.minimumMs))
        && entry?.fixationsTruncated !== true && qualifiedGroups === (entry?.fixationCountTotal ?? 0)
        && Math.abs(qualifiedMs - actualMs) < .001;
      return { version: diagnosticVersion, missingReasons, outsideBoardFrames,
        // For each long gap: the last observed loss type, not a causal diagnosis.
        grouping: groupingMatches ? { splits, shortGroups, gapContext, shortGroupMs } : null };
    },
  };
}

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
    frames: freshCounts(), diagnostics: createFixationDiagnostics(), fixation: createHeatmapAccumulator({ gridWidth: 1, gridHeight: 1,
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
        streams[key].diagnostics.observe(timestamp, label, nx, ny, point);
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
        signals: Object.fromEntries(Object.entries(streams).map(([key, s]) => {
          const entry = s.fixation.finalize().perStimulus[0];
          return [key, { frames: s.frames, fixation: summarizeFixations(entry, layout, trial),
            fixationDiagnostics: s.diagnostics.finish(entry) }];
        })) };
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
    const diagnostics = windows.map(w => w.fixationDiagnostics).filter(Boolean);
    const grouped = diagnostics.map(d => d.grouping).filter(Boolean);
    const sumFields = (items, keys) => Object.fromEntries(keys.map(k => [k, sum(items.map(item => item[k]))]));
    return [key, { frames, measured, presentedWindows: rows.length, windowsWithFrames: nonempty.length,
      equalWindowTargetHitFraction: fraction(sum(nonempty.map(r => r.signals[key].frames.target / r.measured)), nonempty.length),
      targetHitFractionOfAccepted: fraction(frames.target, measured - frames.missing),
      missingFraction: fraction(frames.missing, measured),
      reachedTargetWindows: fixation.filter(w => w.fixation.reachedTarget).length,
      truncatedWindows: windows.length - fixation.length, targetDwellMs, validObservationMs: observation,
      otherDwellMs: sum(fixation.map(w => w.fixation.otherDwellMs)),
      outsideAoiDwellMs: sum(fixation.map(w => w.fixation.outsideAoiDwellMs)),
      targetDwellFractionOfValidObservation: fraction(targetDwellMs, observation),
      ...(diagnostics.length ? { fixationDiagnostics: {
        version: diagnosticVersion, windows: diagnostics.length, groupingWindows: grouped.length,
        missingReasons: sumFields(diagnostics.map(d => d.missingReasons), rejectionKeys),
        outsideBoardFrames: sum(diagnostics.map(d => d.outsideBoardFrames)),
        grouping: grouped.length ? { splits: sumFields(grouped.map(g => g.splits), splitKeys),
          shortGroups: sumFields(grouped.map(g => g.shortGroups), splitKeys),
          gapContext: sumFields(grouped.map(g => g.gapContext), unavailableKeys),
          shortGroupMs: sum(grouped.map(g => g.shortGroupMs)) } : null,
      } } : {}) }];
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
