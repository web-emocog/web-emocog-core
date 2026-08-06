/**
 * Analytics API (Фаза 3): групповой дашборд, QC дашборд, сырые фичи для связанности.
 * Новый файл — исходные routes не удаляем.
 */
const express = require('express');
const { query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, requireRole, requireOperation, OPERATIONS, isPlatformAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'PI', 'researcher', 'analyst', 'developer'));
router.use(requireOperation(OPERATIONS.ANALYTICS_READ));
router.use('/v1', require('../analytics/v1-router'));

function scopedJoinAndWhere(userParamIdx, user) {
  if (isPlatformAdmin(user)) return '';
  return `
    LEFT JOIN protocols sp ON sp.id = s.protocol_id
    INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
    INNER JOIN user_organizations uo_scope ON uo_scope.organization_id = p_scope.organization_id AND uo_scope.user_id = $${userParamIdx}
    INNER JOIN user_projects up_scope ON up_scope.project_id = p_scope.id AND up_scope.user_id = uo_scope.user_id
  `;
}

function toFiniteNumber(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function roundTo(v, digits) {
  const n = toFiniteNumber(v);
  if (n == null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function normalizeBlocks(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (!Array.isArray(payload.blocks)) return [];
  return payload.blocks
    .filter(b => b && typeof b === 'object')
    .map((b, idx) => ({
      name: b.name || `Block_${idx + 1}`,
      attention: toFiniteNumber(b.attention),
      arousal: toFiniteNumber(b.arousal),
      valence: toFiniteNumber(b.valence),
      blinks: toFiniteNumber(b.blinks),
      rt: toFiniteNumber(b.rt),
      omissions: toFiniteNumber(b.omissions),
    }));
}

// GET /analytics/group — средние и 95% CI по метрикам по протоколу/группе; кол-во valid/borderline/invalid
router.get(
  '/group',
  [
    query('project_id').optional().isInt(),
    query('protocol_id').optional().isInt(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      let sql = `
        SELECT s.id, s.session_id, s.participant_id, s.protocol_id, s.started_at,
               q.qc_score, q.validity AS qc_validity,
               f.payload AS features_payload
        FROM sessions s
        LEFT JOIN session_qc_summary q ON q.session_id = s.id
        LEFT JOIN session_features f ON f.session_id = s.id
        ${scopedJoinAndWhere(1, req.user)}
        WHERE 1=1
      `;
      const params = isPlatformAdmin(req.user) ? [] : [req.user.sub];
      let i = params.length + 1;
      if (req.query.project_id) { params.push(req.query.project_id); sql += ` AND s.project_id = $${i++}`; }
      if (req.query.protocol_id) { params.push(req.query.protocol_id); sql += ` AND s.protocol_id = $${i++}`; }
      if (req.query.date_from) { params.push(req.query.date_from); sql += ` AND s.started_at >= $${i++}`; }
      if (req.query.date_to) { params.push(req.query.date_to); sql += ` AND s.started_at <= $${i++}`; }
      sql += ' ORDER BY s.started_at DESC NULLS LAST LIMIT 2000';

      const r = await pool.query(sql, params);
      const rows = r.rows;

      const summary = { total: rows.length, valid: 0, borderline: 0, invalid: 0, avgQc: null };
      let qcSum = 0;
      let qcCount = 0;
      rows.forEach(row => {
        const v = (row.qc_validity || '').toLowerCase();
        if (v === 'valid') summary.valid++;
        else if (v === 'borderline') summary.borderline++;
        else if (v === 'invalid') summary.invalid++;
        if (row.qc_score != null) { qcSum += Number(row.qc_score); qcCount++; }
      });
      if (qcCount > 0) summary.avgQc = Math.round((qcSum / qcCount) * 10) / 10;

      const byProtocol = new Map();
      rows.forEach(row => {
        const pid = row.protocol_id != null ? String(row.protocol_id) : 'unknown';
        if (!byProtocol.has(pid)) byProtocol.set(pid, []);
        byProtocol.get(pid).push(row);
      });

      const protocols = [];
      for (const [protocolId, sessions] of byProtocol.entries()) {
        const blocks = [];
        const conditions = {};
        const payloads = sessions.map(s => s.features_payload).filter(Boolean);
        const normalizedBlocks = payloads.map(normalizeBlocks);
        const payloadsWithBlocks = normalizedBlocks.filter(b => b.length > 0).length;
        const contractWarnings = [];
        if (payloads.length > 0 && payloadsWithBlocks === 0) {
          contractWarnings.push('payload.blocks missing for all sessions');
        } else if (payloads.length > 0 && payloadsWithBlocks < payloads.length) {
          contractWarnings.push('payload.blocks missing for part of sessions');
        }
        // Contract: each payload is expected to have `blocks: [{name, attention, arousal, valence, blinks, rt, omissions}]`.
        // Harden against missing/partial blocks by:
        // - selecting the first non-empty blocks array among payloads (stable block count)
        // - averaging each metric over the sessions where the metric value is finite.
        let firstBlocks = null;
        for (const p of normalizedBlocks) {
          if (Array.isArray(p) && p.length > 0) {
            firstBlocks = p;
            break;
          }
        }

        if (Array.isArray(firstBlocks) && firstBlocks.length > 0) {
          for (let idx = 0; idx < firstBlocks.length; idx++) {
            const name = firstBlocks[idx] && firstBlocks[idx].name ? firstBlocks[idx].name : `Block_${idx + 1}`;

            let attentionSum = 0, attentionN = 0;
            let arousalSum = 0, arousalN = 0;
            let valenceSum = 0, valenceN = 0;
            let blinksSum = 0, blinksN = 0;
            let rtSum = 0, rtN = 0;
            let omissionsSum = 0, omissionsN = 0;

            normalizedBlocks.forEach(p => {
              const bl = p && p.length > idx ? p[idx] : null;
              if (!bl || typeof bl !== 'object') return;

              const a = toFiniteNumber(bl.attention);
              if (a != null) { attentionSum += a; attentionN++; }

              const ar = toFiniteNumber(bl.arousal);
              if (ar != null) { arousalSum += ar; arousalN++; }

              const v = toFiniteNumber(bl.valence);
              if (v != null) { valenceSum += v; valenceN++; }

              const b = toFiniteNumber(bl.blinks);
              if (b != null) { blinksSum += b; blinksN++; }

              const r = toFiniteNumber(bl.rt);
              if (r != null) { rtSum += r; rtN++; }

              const o = toFiniteNumber(bl.omissions);
              if (o != null) { omissionsSum += o; omissionsN++; }
            });

            blocks.push({
              name,
              attention: attentionN ? Math.round((attentionSum / attentionN) * 10) / 10 : null,
              arousal: arousalN ? Math.round((arousalSum / arousalN) * 1000) / 1000 : null,
              valence: valenceN ? Math.round((valenceSum / valenceN) * 1000) / 1000 : null,
              blinks: blinksN ? Math.round((blinksSum / blinksN) * 10) / 10 : null,
              rt: rtN ? Math.round(rtSum / rtN) : null,
              omissions: omissionsN ? Math.round((omissionsSum / omissionsN) * 100) / 100 : null,
            });
          }
        }

        if (blocks.length === 0) {
          blocks.push({ name: 'Session', attention: null, arousal: null, valence: null, blinks: null, rt: null, omissions: null });
        }

        protocols.push({
          protocol_id: protocolId === 'unknown' ? null : parseInt(protocolId, 10),
          contract: {
            blocks_expected: true,
            blocks_present_in_sessions: payloadsWithBlocks,
            sessions_with_features_payload: payloads.length,
            fallback_used: blocks.length === 1 && blocks[0].name === 'Session',
            warnings: contractWarnings,
          },
          summary: {
            total: sessions.length,
            valid: sessions.filter(s => (s.qc_validity || '').toLowerCase() === 'valid').length,
            borderline: sessions.filter(s => (s.qc_validity || '').toLowerCase() === 'borderline').length,
            invalid: sessions.filter(s => (s.qc_validity || '').toLowerCase() === 'invalid').length,
            avgQc: (() => {
              const scores = sessions.map(s => s.qc_score).filter(x => x != null);
              return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null;
            })(),
          },
          blocks,
          conditions,
        });
      }

      res.json({
        meta: { project_id: req.query.project_id || null, protocol_id: req.query.protocol_id || null },
        summary,
        protocols,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Analytics group failed' });
    }
  }
);

// GET /analytics/qc — распределение qc_score, доли valid/borderline/invalid по протоколу, топ причин брака
router.get(
  '/qc',
  [
    query('project_id').optional().isInt(),
    query('protocol_id').optional().isInt(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      let sql = `
        SELECT s.id, s.session_id, s.protocol_id, s.started_at,
               q.qc_score, q.validity AS qc_validity, q.fail_reasons,
               f.payload AS features_payload
        FROM sessions s
        LEFT JOIN session_qc_summary q ON q.session_id = s.id
        LEFT JOIN session_features f ON f.session_id = s.id
        ${scopedJoinAndWhere(1, req.user)}
        WHERE 1=1
      `;
      const params = isPlatformAdmin(req.user) ? [] : [req.user.sub];
      let i = params.length + 1;
      if (req.query.project_id) { params.push(req.query.project_id); sql += ` AND s.project_id = $${i++}`; }
      if (req.query.protocol_id) { params.push(req.query.protocol_id); sql += ` AND s.protocol_id = $${i++}`; }
      if (req.query.date_from) { params.push(req.query.date_from); sql += ` AND s.started_at >= $${i++}`; }
      if (req.query.date_to) { params.push(req.query.date_to); sql += ` AND s.started_at <= $${i++}`; }
      sql += ' ORDER BY s.started_at DESC NULLS LAST LIMIT 2000';

      const r = await pool.query(sql, params);
      const rows = r.rows;

      const histBins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const histCounts = new Array(histBins.length - 1).fill(0);
      const byProtocol = new Map();
      const reasonCount = {};

      rows.forEach(row => {
        const score = row.qc_score != null ? Number(row.qc_score) : null;
        if (score != null) {
          for (let j = 0; j < histBins.length - 1; j++) {
            const isLastBin = j === histBins.length - 2;
            if (score >= histBins[j] && (score < histBins[j + 1] || (isLastBin && score <= histBins[j + 1]))) {
              histCounts[j]++;
              break;
            }
          }
        }
        const pid = row.protocol_id != null ? String(row.protocol_id) : 'unknown';
        if (!byProtocol.has(pid)) byProtocol.set(pid, []);
        byProtocol.get(pid).push(row);
        const reasons = row.fail_reasons;
        if (Array.isArray(reasons)) {
          reasons.forEach(reason => {
            const key = typeof reason === 'string' ? reason : (reason.key || reason.label || JSON.stringify(reason));
            reasonCount[key] = (reasonCount[key] || 0) + 1;
          });
        } else if (reasons && typeof reasons === 'object') {
          Object.keys(reasons).forEach(key => { reasonCount[key] = (reasonCount[key] || 0) + (reasons[key] || 0); });
        }
      });

      const byDevice = [];
      const deviceMap = new Map();
      rows.forEach(row => {
        const payload = row.features_payload || {};
        const device = payload.device || payload.meta?.device || 'Unknown';
        if (!deviceMap.has(device)) deviceMap.set(device, { valid: 0, total: 0 });
        const d = deviceMap.get(device);
        d.total++;
        if ((row.qc_validity || '').toLowerCase() === 'valid') d.valid++;
      });
      deviceMap.forEach((v, name) => {
        byDevice.push({ name, validPct: v.total ? Math.round((v.valid / v.total) * 100) : 0 });
      });

      const protocolDist = Array.from(byProtocol.entries()).map(([name, arr]) => ({
        protocol_id: name === 'unknown' ? null : parseInt(name, 10),
        sessions: arr,
        mean: (() => {
          const scores = arr.map(a => a.qc_score).filter(x => x != null);
          return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        })(),
        n: arr.length,
      }));

      const topReasons = Object.entries(reasonCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([key, count]) => ({ key, count }));

      res.json({
        histBins,
        histCounts,
        byDevice,
        byProtocol: protocolDist,
        topReasons,
        summary: {
          total: rows.length,
          valid: rows.filter(x => (x.qc_validity || '').toLowerCase() === 'valid').length,
          borderline: rows.filter(x => (x.qc_validity || '').toLowerCase() === 'borderline').length,
          invalid: rows.filter(x => (x.qc_validity || '').toLowerCase() === 'invalid').length,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Analytics QC failed' });
    }
  }
);

// GET /analytics/features — сырые SessionFeatures для выбранных сессий (корреляционная матрица)
router.get(
  '/features',
  [
    query('project_id').optional().isInt(),
    query('protocol_id').optional().isInt(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('qc_validity').optional().isIn(['valid', 'borderline', 'invalid']),
    query('limit').optional().isInt({ min: 1, max: 5000 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);

      let sql = `
        SELECT s.id, s.session_id, s.participant_id, s.protocol_id, s.started_at,
               q.qc_score, q.validity AS qc_validity,
               f.payload AS features_payload
        FROM sessions s
        LEFT JOIN session_qc_summary q ON q.session_id = s.id
        LEFT JOIN session_features f ON f.session_id = s.id
        ${scopedJoinAndWhere(1, req.user)}
        WHERE f.payload IS NOT NULL AND f.payload != 'null'::jsonb
      `;
      const params = isPlatformAdmin(req.user) ? [] : [req.user.sub];
      let i = params.length + 1;
      if (req.query.project_id) { params.push(req.query.project_id); sql += ` AND s.project_id = $${i++}`; }
      if (req.query.protocol_id) { params.push(req.query.protocol_id); sql += ` AND s.protocol_id = $${i++}`; }
      if (req.query.date_from) { params.push(req.query.date_from); sql += ` AND s.started_at >= $${i++}`; }
      if (req.query.date_to) { params.push(req.query.date_to); sql += ` AND s.started_at <= $${i++}`; }
      if (req.query.qc_validity) { params.push(req.query.qc_validity); sql += ` AND q.validity = $${i++}`; }
      sql += ` ORDER BY s.started_at DESC NULLS LAST LIMIT $${i}`;
      params.push(limit);

      const r = await pool.query(sql, params);
      const sessions = r.rows.map(row => {
        const p = row.features_payload || {};
        const normBlocks = normalizeBlocks(p);
        const flat = {
          session_id: row.session_id,
          participant_id: row.participant_id,
          protocol_id: row.protocol_id,
          started_at: row.started_at,
          qc_score: row.qc_score,
          qc_validity: row.qc_validity,
        };
        if (p.attentionMetrics) Object.assign(flat, p.attentionMetrics);
        if (normBlocks.length > 0) {
          normBlocks.forEach((b, idx) => {
            if (b.name) flat[`block_${idx}_name`] = b.name;
            const a = toFiniteNumber(b.attention);
            if (a != null) flat[`block_${idx}_attention`] = a;
            const ar = toFiniteNumber(b.arousal);
            if (ar != null) flat[`block_${idx}_arousal`] = ar;
            const v = toFiniteNumber(b.valence);
            if (v != null) flat[`block_${idx}_valence`] = v;
            const bl = toFiniteNumber(b.blinks);
            if (bl != null) flat[`block_${idx}_blinks`] = bl;
            const rtt = toFiniteNumber(b.rt);
            if (rtt != null) flat[`block_${idx}_rt`] = rtt;
            const om = toFiniteNumber(b.omissions);
            if (om != null) flat[`block_${idx}_omissions`] = om;
          });
        }
        return flat;
      });

      res.json({ sessions, count: sessions.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Analytics features failed' });
    }
  }
);

module.exports = router;
