/**
 * Export Service (Фаза 2.7): фильтры, CSV.
 */
const express = require('express');
const { query, validationResult } = require('express-validator');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin', 'PI', 'researcher', 'analyst'));

function scopedJoinAndWhere(userParamIdx) {
  return `
    LEFT JOIN protocols sp ON sp.id = s.protocol_id
    INNER JOIN projects p_scope ON p_scope.id = COALESCE(s.project_id, sp.project_id)
    INNER JOIN user_organizations uo_scope ON uo_scope.organization_id = p_scope.organization_id AND uo_scope.user_id = $${userParamIdx}
  `;
}

function escapeCsv(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function normalizeBlocks(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (!Array.isArray(payload.blocks)) return [];
  return payload.blocks.filter(b => b && typeof b === 'object').map((b, idx) => ({
    name: b.name || `Block_${idx + 1}`,
    attention: b.attention,
    arousal: b.arousal,
    valence: b.valence,
    blinks: b.blinks,
    rt: b.rt,
    omissions: b.omissions,
  }));
}

function normalizeQcSummary(row) {
  const payload = row && row.qc_summary_payload && typeof row.qc_summary_payload === 'object'
    ? row.qc_summary_payload
    : {};
  const failReasons = Array.isArray(row.fail_reasons)
    ? row.fail_reasons
    : (Array.isArray(payload.fail_reasons)
      ? payload.fail_reasons
      : (Array.isArray(payload.failReasons) ? payload.failReasons : []));
  const checksSrc = payload && payload.checks && typeof payload.checks === 'object' ? payload.checks : {};
  return {
    qc_score: row.qc_score ?? payload.qc_score ?? payload.qcScore ?? payload.gazeValidPct ?? null,
    validity: row.qc_validity ?? payload.validity ?? null,
    fail_reasons: failReasons,
    checks: {
      duration: checksSrc.duration ?? null,
      face_visible: checksSrc.face_visible ?? checksSrc.faceVisible ?? null,
      face_ok: checksSrc.face_ok ?? checksSrc.faceOk ?? null,
      pose_ok: checksSrc.pose_ok ?? checksSrc.poseOk ?? null,
      illumination_ok: checksSrc.illumination_ok ?? checksSrc.illuminationOk ?? null,
      eyes_open: checksSrc.eyes_open ?? checksSrc.eyesOpen ?? null,
      occlusion: checksSrc.occlusion ?? null,
      gaze_valid: checksSrc.gaze_valid ?? checksSrc.gazeValid ?? null,
      gaze_on_screen: checksSrc.gaze_on_screen ?? checksSrc.gazeOnScreen ?? null,
      low_fps: checksSrc.low_fps ?? checksSrc.lowFps ?? null,
    },
  };
}

router.get(
  '/',
  [
    query('project_id').optional().isInt(),
    query('protocol_id').optional().isInt(),
    query('date_from').optional().isISO8601(),
    query('date_to').optional().isISO8601(),
    query('qc_validity').optional().isIn(['valid', 'borderline', 'invalid']),
    query('format').optional().isIn(['json', 'csv']),
    query('limit').optional().isInt({ min: 1, max: 5000 }),
    query('offset').optional().isInt({ min: 0, max: 1000000 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const format = (req.query.format || 'json') === 'csv' ? 'csv' : 'json';
      const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 5000);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      let sql = `
        SELECT s.id, s.session_id, s.participant_id, s.project_id, s.protocol_id, s.started_at, s.stopped_at,
               q.qc_score, q.validity AS qc_validity, q.fail_reasons,
               q.payload AS qc_summary_payload,
               f.payload AS features_payload
        FROM sessions s
        LEFT JOIN session_qc_summary q ON q.session_id = s.id
        LEFT JOIN session_features f ON f.session_id = s.id
        ${scopedJoinAndWhere(1)}
        WHERE 1=1
      `;
      const params = [req.user.sub];
      let i = 2;
      if (req.query.project_id) { params.push(req.query.project_id); sql += ` AND s.project_id = $${i++}`; }
      if (req.query.protocol_id) { params.push(req.query.protocol_id); sql += ` AND s.protocol_id = $${i++}`; }
      if (req.query.date_from) { params.push(req.query.date_from); sql += ` AND s.started_at >= $${i++}`; }
      if (req.query.date_to) { params.push(req.query.date_to); sql += ` AND s.started_at <= $${i++}`; }
      if (req.query.qc_validity) { params.push(req.query.qc_validity); sql += ` AND q.validity = $${i++}`; }
      params.push(limit);
      sql += ` ORDER BY s.started_at DESC NULLS LAST LIMIT $${i++}`;
      params.push(offset);
      sql += ` OFFSET $${i++}`;

      const r = await pool.query(sql, params);
      const rows = r.rows;
      const normalizedRows = rows.map(row => {
        const payload = row.features_payload && typeof row.features_payload === 'object' ? row.features_payload : {};
        const blocks = normalizeBlocks(payload);
        const qcSummary = normalizeQcSummary(row);
        return { ...row, _blocks: blocks, _blocks_count: blocks.length, _qc_summary: qcSummary };
      });

      if (format === 'csv') {
        const maxBlocks = normalizedRows.reduce((acc, row) => Math.max(acc, row._blocks_count), 0);
        const headers = ['id', 'session_id', 'participant_id', 'project_id', 'protocol_id', 'started_at', 'stopped_at', 'qc_score', 'qc_validity', 'fail_reasons', 'qc_summary', 'blocks_count'];
        for (let i = 0; i < maxBlocks; i++) {
          headers.push(
            `block_${i}_name`,
            `block_${i}_attention`,
            `block_${i}_arousal`,
            `block_${i}_valence`,
            `block_${i}_blinks`,
            `block_${i}_rt`,
            `block_${i}_omissions`
          );
        }
        const lines = [headers.map(escapeCsv).join(',')];
        for (const row of normalizedRows) {
          const toStr = (h, v) => {
            if (h === 'fail_reasons' && v != null) return Array.isArray(v) ? v.join(';') : JSON.stringify(v);
            if (h === 'qc_summary' && v != null) return JSON.stringify(v);
            return v;
          };
          const flat = {
            ...row,
            qc_summary: row._qc_summary,
            blocks_count: row._blocks_count,
          };
          row._blocks.forEach((b, idx) => {
            flat[`block_${idx}_name`] = b.name;
            flat[`block_${idx}_attention`] = b.attention;
            flat[`block_${idx}_arousal`] = b.arousal;
            flat[`block_${idx}_valence`] = b.valence;
            flat[`block_${idx}_blinks`] = b.blinks;
            flat[`block_${idx}_rt`] = b.rt;
            flat[`block_${idx}_omissions`] = b.omissions;
          });
          lines.push(headers.map(h => escapeCsv(toStr(h, flat[h]))).join(','));
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=sessions_export.csv');
        return res.send('\uFEFF' + lines.join('\n'));
      }

      res.json({
        contract_version: '2026-03-export-v1',
        count: rows.length,
        pagination: { limit, offset },
        filters: {
          project_id: req.query.project_id || null,
          protocol_id: req.query.protocol_id || null,
          date_from: req.query.date_from || null,
          date_to: req.query.date_to || null,
          qc_validity: req.query.qc_validity || null,
        },
        rows: normalizedRows.map(row => ({
          id: row.id,
          session_id: row.session_id,
          participant_id: row.participant_id,
          project_id: row.project_id,
          protocol_id: row.protocol_id,
          started_at: row.started_at,
          stopped_at: row.stopped_at,
          qc_score: row.qc_score,
          qc_validity: row.qc_validity,
          fail_reasons: row.fail_reasons,
          qc_summary: row._qc_summary,
          blocks_count: row._blocks_count,
          blocks: row._blocks,
          features_payload: row.features_payload,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Export failed' });
    }
  }
);

module.exports = router;
