// Offline-only diagnostics. These bounds are not predictions: the aggregate
// files do not store the cross-model residual covariance or frame identities.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeGradientZones } from './issue143-summarize-gradient.mjs';

function sameAcceptedFrames(row, left, right) {
  const n = row.signals[left].accepted;
  if (!n || row.signals[right].accepted !== n) return false;
  if (n === row.analyzed) return true;
  const samePair = (a, b) => row.comparisons.some(p => p.commonAccepted === n
    && (p.baseline === a && p.candidate === b || p.baseline === b && p.candidate === a));
  if (samePair(left, right)) return true;
  const baseline = 'baseline.' + left.split('.').at(-1);
  return row.signals[baseline]?.accepted === n && samePair(left, baseline) && samePair(right, baseline);
}

function boundsForRow(row, left, right) {
  if (!sameAcceptedFrames(row, left, right)) return null;
  const a = row.signals[left], b = row.signals[right];
  const bias2 = ((a.biasXPx + b.biasXPx) / 2) ** 2 + ((a.biasYPx + b.biasYPx) / 2) ** 2;
  // Cauchy-Schwarz on each axis. Unknown cross-model covariance is neither
  // presumed zero nor recoverable from marginal errors.
  const v = sign => ((a.withinTargetSdXPx + sign * b.withinTargetSdXPx) / 2) ** 2
    + ((a.withinTargetSdYPx + sign * b.withinTargetSdYPx) / 2) ** 2;
  return { lower: bias2 + v(-1), upper: bias2 + v(1), left: a.rmsErrorPx ** 2, right: b.rmsErrorPx ** 2 };
}

function summarizePair(rows, left, right) {
  const matched = rows.map(row => boundsForRow(row, left, right)).filter(Boolean);
  const n = matched.length;
  const rms = key => n ? Math.sqrt(matched.reduce((sum, row) => sum + row[key], 0) / n) : null;
  const lowerRmsPx = rms('lower'), upperRmsPx = rms('upper'), leftRmsPx = rms('left'), rightRmsPx = rms('right');
  // Rank an entire zone only when all its targets are comparable.
  const relativeToLeft = n !== rows.length || !n ? 'unavailable' : upperRmsPx < leftRmsPx - 1e-6 ? 'lower'
    : lowerRmsPx > leftRmsPx + 1e-6 ? 'higher' : 'undetermined';
  return { left, right, targets: rows.length, matchedTargets: n, lowerRmsPx, upperRmsPx, leftRmsPx, rightRmsPx, relativeToLeft };
}

export function summarizeBlendBounds(report) {
  const validated = summarizeGradientZones(report);
  const left = 'eye_patch.raw';
  const right = ['baseline.raw', 'eye_gradient_all.raw', 'eye_tophat.raw'].filter(id =>
    Object.hasOwn(validated.zones.all.before.signals, id));
  const phases = { before: report.before, ...(validated.protocol === 'temporal.v1' ? { after: report.after } : {}) };
  return { version: 'issue143_blend_bounds.v1', scope: 'fifty_fifty_raw_coordinate_blend_rms_bounds_only_not_a_model',
    protocol: validated.protocol, phases: Object.fromEntries(Object.entries(phases).map(([phase, rows]) => [phase,
      { all: right.map(id => summarizePair(rows, left, id)),
        lower: right.map(id => summarizePair(rows.filter(row => row.targetPercent.y >= 70), left, id)) }])) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('expected one report');
    const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
    console.log(JSON.stringify(summarizeBlendBounds(report), null, 2));
  } catch {
    console.error('Cannot bound blend: expected one complete issue143 JSON with the fixed nine-point spatial/temporal layout.');
    process.exitCode = 1;
  }
}
