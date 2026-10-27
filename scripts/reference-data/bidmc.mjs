// Numeric-core benchmark, NOT a webcam respiration accuracy benchmark.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateFile, fingerprint, validateRoundedClock } from './reference.mjs';
import { estimateRespirationRate } from '../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/signal/respiration.js';

const root = process.env.WECOG_BIDMC_ROOT;
if (!root) throw new Error('Set WECOG_BIDMC_ROOT to the private BIDMC 1.0.0 directory');
const sums = (await fs.readFile(await privateFile(root, 'SHA256SUMS.txt', 1000000), 'utf8')).trim().split('\n');
const locked = [];
async function csv(name, maxRows) {
  const file = await privateFile(root, name, 15000000), actual = await fingerprint(file);
  const expected = sums.map(line => line.trim().split(/\s+/)).find(([, filename]) => filename?.replace(/^\*?\.\//, '') === `bidmc_csv/${name}`)?.[0];
  if (actual.sha256 !== expected) throw new Error('bidmc_checksum_mismatch');
  locked.push({ path: name, ...actual });
  const lines = (await fs.readFile(file, 'utf8')).trim().split(/\r?\n/);
  if (lines.length > maxRows) throw new Error('oversized_csv');
  return { header: lines.shift().split(',').map(s => s.trim()),
    rows: lines.map(line => line.split(',').map(s => s.trim() === '' ? null : Number(s))) };
}
const signal = await csv('bidmc_01_Signals.csv', 61000), annotations = await csv('bidmc_01_Breaths.csv', 1000);
const tIndex = signal.header.indexOf('Time [s]'), respIndex = signal.header.indexOf('RESP');
if (tIndex < 0 || respIndex < 0 || signal.rows.length !== 60001) throw new Error('bidmc_schema_mismatch');
// CSV timestamps are rounded (e.g. 100.02 twice), not a missing sample. Use the
// documented 125 Hz sample clock, bounded by half a sample of CSV quantization.
const clockQuantization = validateRoundedClock(signal.rows.map(row => row[tIndex]), 125);
for (let i = 0; i < signal.rows.length; i++) {
  const row = signal.rows[i];
  if (!Number.isFinite(row[respIndex])) throw new Error('bidmc_timing_or_signal_gap');
}
const reference = [0, 1].map(index => annotations.rows.map(r => r[index]).filter(Number.isFinite));
if (reference.some(values => values.length < 20 || values.some((v, i) => !Number.isSafeInteger(v) || v <= 0 || (i && v <= values[i - 1])))) throw new Error('invalid_breath_annotations');
const rate = samples => samples.length < 3 ? null : 60 * 125 * (samples.length - 1) / (samples.at(-1) - samples[0]);
const windows = [];
for (let start = 0; start + 20 <= 480; start += 20) {
  const from = start * 125, to = (start + 20) * 125;
  const refs = reference.map(samples => rate(samples.filter(s => s >= from && s < to)));
  const estimate = estimateRespirationRate(signal.rows.slice(from, to).map(row => row[respIndex]), 125);
  const eligible = refs.every(v => Number.isFinite(v) && v >= 6 && v <= 24);
  const published = Number.isFinite(estimate.bpm) && estimate.bpm >= 6 && estimate.bpm <= 24 && estimate.conf >= .20;
  windows.push({ start, end: start + 20, referenceBpm: refs, estimateBpm: published ? estimate.bpm : null,
    confidence: estimate.conf, eligible, absoluteErrorBpm: eligible && published ? Math.abs(estimate.bpm - (refs[0] + refs[1]) / 2) : null });
}
const errors = windows.map(w => w.absoluteErrorBpm).filter(Number.isFinite), eligible = windows.filter(w => w.eligible).length;
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const report = { method: 'bidmc-impedance-numeric-core.v1', dataset: 'BIDMC PPG and Respiration Dataset 1.0.0',
  source: 'https://physionet.org/content/bidmc/1.0.0/', license: 'ODC-By-1.0',
  attribution: 'Contains information from BIDMC PPG and Respiration Dataset, available under the ODC Attribution License. Pimentel et al., doi:10.1109/TBME.2016.2613124; PhysioNet.',
  files: locked, windowSeconds: 20, strideSeconds: 20, totalWindows: windows.length,
  clock: { method: 'documented_125Hz_sample_index', maxCsvRoundingSeconds: clockQuantization },
  eligibleReferenceWindows: eligible, scoredWindows: errors.length, missingWindows: eligible - errors.length,
  coverage: eligible ? errors.length / eligible : 0, maeBpm: mean(errors),
  rmseBpm: errors.length ? Math.sqrt(mean(errors.map(v => v * v))) : null,
  annotatorDisagreementBpm: mean(windows.filter(w => w.eligible).map(w => Math.abs(w.referenceBpm[0] - w.referenceBpm[1]))),
  interpretation: 'Direct impedance respiration input tests numeric core only. No webcam/rPPG extraction, person-generalization or clinical accuracy claim.',
  acceptance: 'descriptive_baseline_not_a_validated_accuracy_gate', windows };
const baseline = JSON.parse(await fs.readFile(new URL('./bidmc-01-baseline.json', import.meta.url), 'utf8'));
if (baseline.signalSha256 !== locked[0].sha256 || baseline.annotationSha256 !== locked[1].sha256
    || ['totalWindows', 'eligibleReferenceWindows', 'scoredWindows'].some(key => baseline[key] !== report[key])
    || ['maeBpm', 'rmseBpm'].some(key => !Number.isFinite(report[key]) || Math.abs(baseline[key] - report[key]) > 1e-8)) throw new Error('bidmc_numeric_regression');
report.regression = 'pinned_implementation_baseline_passed';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
await fs.mkdir(path.join(repo, 'test-results/reference-data'), { recursive: true });
await fs.writeFile(path.join(repo, 'test-results/reference-data/bidmc-numeric.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ windows: report.totalWindows, scored: report.scoredWindows, coverage: report.coverage,
  maeBpm: report.maeBpm, rmseBpm: report.rmseBpm, scope: 'numeric_core_not_webcam_accuracy' }, null, 2));
