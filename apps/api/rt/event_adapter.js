/**
 * Maps participant session events + cognitiveResults to rt_mvp JSONL-shaped events.
 */
const { mapWebTaskToAnalyzer } = require('../../shared/rt-registry');

function normalizeButtonId(key) {
  if (key == null) return '';
  const k = String(key).trim();
  if (!k) return '';
  if (k === 'Space' || k.toLowerCase() === 'space') return 'space';
  // Align with rt_component Tk KEYMAP: Left->left, Right->right (choice/flanker)
  if (k === 'ArrowLeft' || k === 'arrow_left') return 'left';
  if (k === 'ArrowRight' || k === 'arrow_right') return 'right';
  if (k === 'ArrowDown' || k === 'arrow_down') return 'down';
  if (k === 'ArrowUp' || k === 'arrow_up') return 'up';
  if (k.startsWith('Arrow')) return k.replace('Arrow', 'arrow_').toLowerCase();
  return k.toLowerCase();
}

function parseTrialIndex(trialId, fallback) {
  if (trialId == null) return fallback;
  const m = String(trialId).match(/(\d+)\s*$/);
  if (m) return parseInt(m[1], 10);
  const n = parseInt(String(trialId), 10);
  return Number.isFinite(n) ? n : fallback;
}

function blockIdToInt(blockId, fallback = 1) {
  if (blockId == null) return fallback;
  const n = parseInt(String(blockId).replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function conditionToIsGo(condition) {
  if (condition == null) return null;
  const c = String(condition).toLowerCase();
  if (c.includes('nogo') || c.includes('no-go') || c === 'nogo') return false;
  if (c.includes('go') || c === 'target') return true;
  return null;
}

function eventsToRtJsonl(sessionEvents, cognitiveResults, blockCtx) {
  const events = Array.isArray(sessionEvents) ? sessionEvents : [];
  const rows = Array.isArray(cognitiveResults) ? cognitiveResults : [];
  const blockId = blockCtx?.blockId;
  const taskType = blockCtx?.taskType || 'other';
  const analyzerTask = blockCtx?.analyzerTask || mapWebTaskToAnalyzer(taskType);
  const rtWindowMs = Number.isFinite(blockCtx?.rtWindowMs) ? blockCtx.rtWindowMs : 2500;

  const stimEvents = events.filter((e) => e && e.type === 'stimulus_on' && (blockId == null || String(e.blockId) === String(blockId)));
  const responseEvents = events.filter((e) => e && e.type === 'response' && (blockId == null || String(e.blockId) === String(blockId)));

  const stimByIndex = new Map();
  stimEvents.forEach((e, i) => {
    const idx = Number.isFinite(e.trialIndex) ? e.trialIndex : i;
    stimByIndex.set(idx, e);
  });

  const out = [];
  let trialNum = 0;

  const maxLen = Math.max(rows.length, stimEvents.length, 1);
  for (let i = 0; i < maxLen; i++) {
    const row = rows[i] || null;
    const stim = stimByIndex.get(i) || stimEvents[i] || null;
    const resp = responseEvents.find((r) => r.trialIndex === i) || responseEvents[i] || null;

    trialNum += 1;
    const tid = parseTrialIndex(row?.trialId ?? stim?.trialId, trialNum);
    const bid = blockIdToInt(row?.blockId ?? blockId ?? stim?.blockId, 1);
    const t0 = (stim?.tRelMs != null ? Number(stim.tRelMs) : (row?.timestamp != null ? 0 : i * 3000)) / 1000.0;

    const condition = row?.condition ?? stim?.condition ?? '';
    const isGo = conditionToIsGo(condition);
    const expected = normalizeButtonId(row?.expectedResponse ?? stim?.expectedResponse ?? 'space');

    out.push({
      schema_version: 1,
      instrument: 'rt',
      session_id: blockCtx?.sessionId || 'web',
      run_id: blockCtx?.runId || 'web',
      event_type: 'stimulus_on',
      t_mono: t0,
      trial_id: tid,
      block_id: bid,
      stimulus_type: row?.stimulusType || condition || 'stimulus',
      expected_response: expected || 'space',
      is_go: isGo,
      timeout_ms: rtWindowMs,
      task_id: taskType,
    });

    const rtMs = row?.rt != null ? Number(row.rt) : (resp?.rtMs != null ? Number(resp.rtMs) : null);
    if (rtMs != null && Number.isFinite(rtMs)) {
      const key = normalizeButtonId(row?.response ?? resp?.key ?? 'space');
      out.push({
        schema_version: 1,
        instrument: 'rt',
        session_id: blockCtx?.sessionId || 'web',
        run_id: blockCtx?.runId || 'web',
        event_type: 'keypress',
        t_mono: t0 + rtMs / 1000.0,
        trial_id: tid,
        block_id: bid,
        button_id: key || 'space',
        task_id: taskType,
      });
    }
  }

  return { events: out, analyzerTask };
}

module.exports = { eventsToRtJsonl, normalizeButtonId, conditionToIsGo };
