// Retrospective posture-only envelopes. No per-frame reconstruction,
// classifier fitting or accuracy claim from the aggregate inputs.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeGradientReport } from './issue143-summarize-gradient.mjs';

export function summarizeGeometrySeparation(report) {
  if (!summarizeGradientReport(report).stages) throw Error('not_a_completed_posture_report');
  const envelope = rows => {
    const heights = rows.map(row => {
      const profile = row.baselineNuisance;
      const k = profile?.fields?.indexOf('eyeMidY');
      const mean = profile?.mean?.[k], sd = profile?.sd?.[k];
      if (!(Number.isSafeInteger(profile?.frames) && profile.frames > 0 && k >= 0
        && Number.isFinite(mean) && mean >= 0 && mean <= 1 && Number.isFinite(sd) && sd >= 0)) throw Error('missing_geometry_summary');
      const width = Math.max(.001, 2 * sd);
      return { low: mean - width, high: mean + width };
    });
    return { low: Math.min(...heights.map(h => h.low)), high: Math.max(...heights.map(h => h.high)) };
  };
  const [natural, lowered, returned] = report.poseProbe.stages.map(stage => envelope(stage.rows));
  return { version: 'issue143_geometry_audit.v1', scope: 'aggregate_mean_sd_envelopes_not_frame_classifier_validation',
    loweredMinusNaturalEnvelopeGap: lowered.low - natural.high,
    loweredMinusReturnedEnvelopeGap: lowered.low - returned.high,
    guardedGap: lowered.low - Math.max(natural.high, returned.high) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('expected_one_report');
    console.log(JSON.stringify(summarizeGeometrySeparation(JSON.parse(await readFile(process.argv[2], 'utf8'))), null, 2));
  } catch {
    console.error('Cannot audit: expected one complete posture summary containing eyeMidY aggregates.');
    process.exitCode = 1;
  }
}
