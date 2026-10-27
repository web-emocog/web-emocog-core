import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const DATASET = Object.freeze({
  id: 'kyegorov/mcd_rppg', revision: 'bf59b3cd1414c2a510d83c3125f16bb87d469ebb',
  license: 'CC-BY-4.0', source: 'https://huggingface.co/datasets/kyegorov/mcd_rppg',
  citation: 'Egorov et al. (2025), Gaze into the Heart, doi:10.1145/3746027.3758255'
});
export function parsePpg(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 100 || lines.length > 100000) throw new Error('invalid_reference_length');
  return lines.map(line => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 2 || fields.some(v => v === '' || !Number.isFinite(Number(v)))) throw new Error('invalid_reference_sample');
    // The authors' load_ppg uses column one. Column two is NOT a frame clock.
    return Number(fields[0]);
  });
}
export function assessAlignment({ decodedFrames, referenceSamples, captureTimestamps, decoderErrors = false }) {
  const reasons = [];
  if (![decodedFrames, referenceSamples, captureTimestamps].every(n => Number.isSafeInteger(n) && n > 0)) reasons.push('invalid_counts');
  if (decodedFrames !== referenceSamples) reasons.push('reference_frame_count_mismatch');
  if (decodedFrames !== captureTimestamps) reasons.push('capture_timestamp_count_mismatch');
  if (decoderErrors) reasons.push('decoder_errors');
  return { status: reasons.length ? 'not_scored' : 'requires_clock_verification', reasons,
    // Matching counts alone do not establish clock offset, drift or reference quality.
    accuracyValidated: false };
}
export function validateRoundedClock(times, sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('invalid_reference_clock');
  let maximumError = 0;
  for (let i = 0; i < times.length; i++) {
    const error = Math.abs(times[i] - i / sampleRate);
    if (!Number.isFinite(times[i]) || (i && times[i] < times[i - 1]) || error > .5 / sampleRate + 1e-9) throw new Error('reference_clock_gap');
    maximumError = Math.max(maximumError, error);
  }
  return maximumError;
}
export async function privateFile(root, relative, maxBytes = 256 * 1024 * 1024) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(s => s === '..' || s === '.')) throw new Error('unsafe_data_path');
  const base = await fs.realpath(root), file = path.resolve(base, relative);
  const real = await fs.realpath(file);
  if (!real.startsWith(base + path.sep) || real !== file) throw new Error('unsafe_data_path');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw new Error('invalid_data_size');
  return real;
}
export async function fingerprint(file) {
  const handle = await fs.open(file, 'r');
  try {
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of handle.createReadStream()) { hash.update(chunk); size += chunk.length; }
    return { bytes: size, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
export async function verifyManifest(root, manifest) {
  if (manifest.dataset?.id !== DATASET.id || manifest.dataset?.revision !== DATASET.revision
      || manifest.dataset?.license !== DATASET.license || !Array.isArray(manifest.files)
      || manifest.files.length < 2 || manifest.files.length > 30) throw new Error('invalid_manifest');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) throw new Error('invalid_manifest');
    seen.add(entry.path);
    const actual = await fingerprint(await privateFile(root, entry.path));
    if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) throw new Error('reference_integrity_failed');
  }
  return true;
}
