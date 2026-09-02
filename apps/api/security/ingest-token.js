const jwt = require('jsonwebtoken');
const config = require('../config');

const INGEST_TOKEN_ISSUER = 'wecog-api';
const INGEST_TOKEN_AUDIENCE = 'wecog-participant-ingest';
const DEFAULT_EXPIRES_IN = '15m';

function issueIngestToken({ sessionId, invitation }) {
  if (!sessionId || !invitation?.id || !invitation?.code) {
    throw new Error('session and invitation are required for ingest token');
  }
  return jwt.sign(
    {
      scope: 'participant:ingest',
      sid: String(sessionId),
      invitation_id: Number(invitation.id),
      invitation_code: String(invitation.code),
      protocol_id: invitation.protocol_id == null ? null : Number(invitation.protocol_id),
      project_id: invitation.project_id == null ? null : Number(invitation.project_id),
    },
    config.jwt.secret,
    {
      algorithm: 'HS256',
      issuer: INGEST_TOKEN_ISSUER,
      audience: INGEST_TOKEN_AUDIENCE,
      expiresIn: config.jwt.ingestExpiresIn || DEFAULT_EXPIRES_IN,
    }
  );
}

function verifyIngestToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    algorithms: ['HS256'],
    issuer: INGEST_TOKEN_ISSUER,
    audience: INGEST_TOKEN_AUDIENCE,
  });
}

function getBearerToken(req) {
  const auth = req.headers.authorization;
  return auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function verifyParticipantIngestRequest(req, { sessionId, invitationCode, invitation }) {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Participant ingest token required' };
  }

  let claims;
  try {
    claims = verifyIngestToken(token);
  } catch (_) {
    return { ok: false, status: 401, error: 'Invalid or expired participant ingest token' };
  }

  const mismatch =
    claims.scope !== 'participant:ingest'
    || String(claims.sid) !== String(sessionId)
    || String(claims.invitation_code) !== String(invitationCode)
    || Number(claims.invitation_id) !== Number(invitation?.id)
    || Number(claims.protocol_id) !== Number(invitation?.protocol_id)
    || Number(claims.project_id) !== Number(invitation?.project_id);

  if (mismatch) {
    return {
      ok: false,
      status: 409,
      error: 'Ingest token does not match session or invitation',
    };
  }

  return { ok: true, claims };
}

module.exports = {
  INGEST_TOKEN_ISSUER,
  INGEST_TOKEN_AUDIENCE,
  issueIngestToken,
  verifyIngestToken,
  verifyParticipantIngestRequest,
};
