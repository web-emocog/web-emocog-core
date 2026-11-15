'use strict';

const assert = require('node:assert/strict');

async function verifyAnalyticsLab(fixture, request, { researcher: token, otherResearcher: outsider }) {
  assert(fixture.synthetic === true && token && outsider, 'Use a freshly seeded synthetic lab');
  const snapshot = await (await request('/analytics/v1/snapshots', fixture.query, token, 201)).json();
  const plan = { axis: 'condition', referenceId: 'congruent', comparisonId: 'incongruent', metricId: 'rt.mean',
    secondMetricId: 'physiology.bpm', baselineBlockId: 'baseline', fastThresholdMs: 200, slowThresholdMs: 600,
    familyMetricIds: ['rt.mean', 'rt.median', 'rt.cv'], signalConditions: { signal: ['go'], noise: ['nogo'] },
    surveyScoring: [{ id: 'pleasantness', items: [{ questionId: 'pleasantness', numericText: true, min: -5, max: 5 }] }],
    repeatVisits: fixture.sessions.map(session => ({ sessionId: session.sessionId, visit: session.visit === 1 ? 'A' : 'B' })) };
  const input = { snapshot_id: snapshot.id, plan };
  const started = performance.now();
  const response = await request('/analytics/v1/extensions/run', input, token);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const report = await response.json();
  assert.equal(report.kind, 'extension_report'); assert.equal(report.snapshot.id, snapshot.id);
  assert.equal(report.data.counts.participants, 20); assert.equal(report.data.counts.sessions, 40);
  assert.equal(new Set(report.data.modules.map(module => module.id)).size, 40);
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  const people = new Map();
  for (const session of fixture.sessions) {
    const values = session.payload.cognitiveResults.filter(trial => trial.correct === true && trial.qualityValid !== false && typeof trial.rt === 'number').map(trial => trial.rt);
    if (!values.length) continue;
    if (!people.has(session.participantId)) people.set(session.participantId, []);
    people.get(session.participantId).push(mean(values));
  }
  const expectedMean = mean([...people.values()].map(mean));
  const actualMean = report.data.modules.find(module => module.id === 'R1').metrics.find(item => item.id === 'rt.mean').value;
  assert(Math.abs(actualMean - expectedMean) < 1e-8, 'Independent participant-weighted RT calculation differs');
  await request('/analytics/v1/extensions/run', input, outsider, 404);
  await request('/analytics/v1/extensions/export', { ...input, format: 'csv' }, outsider, 404);
  await request('/analytics/v1/extensions/run', input, null, 401);
  await request('/analytics/v1/extensions/run', { ...input, rows: [] }, token, 422);
  await request('/analytics/v1/extensions/run', { ...input, plan: { rawRows: [] } }, token, 422);
  await request('/analytics/v1/extensions/run', { ...input, plan: null }, token, 422);
  const exported = await (await request('/analytics/v1/extensions/export', { ...input, format: 'json' }, token)).json();
  assert.deepEqual(exported.data, report.data);
  const csv = await (await request('/analytics/v1/extensions/export', { ...input, format: 'csv' }, token)).text();
  assert(!csv.includes(snapshot.id));
  assert(!csv.includes('recordType'));
  // Parse the actual spreadsheet download, including quoted comma-separated headings.
  function csvRecords(text) {
    const records = [], cells = []; let cell = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (!quoted && (char === ',' || char === '\r' || char === '\n')) {
        cells.push(cell); cell = '';
        if (char !== ',') {
          records.push(cells.splice(0));
          if (char === '\r' && text[i + 1] === '\n') i++;
        }
      } else cell += char;
    }
    assert(!quoted, 'CSV contains an unterminated quoted cell');
    if (cell || cells.length) { cells.push(cell); records.push(cells); }
    return records;
  }
  const [header, ...records] = csvRecords(csv);
  assert(records.every(record => record.length === header.length), 'CSV row width differs from the header');
  assert.deepEqual(header.slice(0, 2), ['Участник', 'Сессий в выборке']);
  assert.equal(records.length, exported.data.participants.length);
  assert.equal(new Set(records.map(row => row[0])).size, records.length);
  const rt = header.indexOf('Среднее время реакции, мс');
  assert(rt >= 2);
  for (let i = 0; i < records.length; i++) {
    const participant = exported.data.participants[i];
    assert.equal(records[i][0], participant.id);
    assert.equal(Number(records[i][1]), participant.sessions.length);
    if (Number.isFinite(participant.metrics['rt.mean'])) assert(Math.abs(Number(records[i][rt]) - participant.metrics['rt.mean']) <= 1e-6);
    else assert.equal(records[i][rt], '');
  }
  const independent = await (await request('/analytics/v1/extensions/run', { snapshot_id: snapshot.id,
    plan: { ...plan, design: 'independent', referenceParticipantIds: fixture.dashboard.groups.A,
      comparisonParticipantIds: fixture.dashboard.groups.B } }, token)).json();
  assert.equal(independent.data.modules.find(module => module.id === 'S1').method, 'welch_t');
  assert.equal(independent.data.modules.find(module => module.id === 'S1').status, 'computed');
  const recovery = await (await request('/analytics/v1/extensions/run', { snapshot_id: snapshot.id,
    plan: { ...plan, axis: 'block', referenceId: 'main', comparisonId: 'rest', metricId: 'physiology.bpm',
      secondMetricId: 'physiology.respiration' } }, token)).json();
  assert.equal(recovery.data.modules.find(module => module.id === 'F4').status, 'computed');
  const coverage = new Set([report, recovery].flatMap(result => result.data.modules.filter(module => module.status === 'computed').map(module => module.id)));
  assert.equal(coverage.size, 40, 'Every eligible extension needs a real synthetic-data exercise');
  const firstSession = fixture.sessions[0];
  const singleQuery = { ...fixture.query, mode: 'session', analysisLevel: 'level_1',
    filters: { ...fixture.query.filters, sessionIds: [firstSession.sessionDbId], includeIncompleteSessions: true } };
  const singleSnapshot = await (await request('/analytics/v1/snapshots', singleQuery, token, 201)).json();
  const singleReport = await (await request('/analytics/v1/extensions/run', { snapshot_id: singleSnapshot.id, plan }, token)).json();
  assert.equal(singleReport.data.counts.participants, 1);
  assert.equal(singleReport.data.counts.sessions, 1);
  const validRT = firstSession.payload.cognitiveResults.filter(trial => trial.correct === true && trial.qualityValid !== false && typeof trial.rt === 'number').map(trial => trial.rt);
  assert(Math.abs(singleReport.data.modules.find(module => module.id === 'R1').metrics.find(item => item.id === 'rt.mean').value - mean(validRT)) < 1e-8);
  assert(singleReport.data.featureRows.every(row => row.sessionId === firstSession.sessionId), 'Database selection must retain the public session UUID in exports');
  return { synthetic: true, participants: report.data.counts.participants, sessions: report.data.counts.sessions,
    calculationAndChecksMs: Math.round(performance.now() - started), independentRtGolden: 'passed',
    privacyNegative: 'passed', jsonCsvExport: 'passed', exercisedSummaries: coverage.size,
    modules: report.data.modules.map(module => ({ id: module.id, status: module.status, rows: module.rows?.length || 0 })) };
}

module.exports = { verifyAnalyticsLab };
