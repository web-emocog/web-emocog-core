const express = require('express');
const sessionFeature = require('../../../packages/shared/contracts/session-feature.v1.schema.json');
const sessionEvent = require('../../../packages/shared/contracts/session-event.v1.schema.json');
const sessionLifecycle = require('../../../packages/shared/contracts/session-lifecycle.v1.schema.json');
const ingestResponse = require('../../../packages/shared/contracts/ingest-session-feature-response.v1.schema.json');

const router = express.Router();
const schemas = {
  [sessionFeature.$id]: sessionFeature,
  [sessionEvent.$id]: sessionEvent,
  [sessionLifecycle.$id]: sessionLifecycle,
  [ingestResponse.$id]: ingestResponse,
};
const aliases = {
  'session-feature.v1': sessionFeature.$id,
  'session-event.v1': sessionEvent.$id,
  'session-lifecycle.v1': sessionLifecycle.$id,
  'ingest-session-feature-response.v1': ingestResponse.$id,
};

router.get('/', (req, res) => {
  res.json({
    versions: Object.keys(schemas),
    ingest: {
      method: 'POST',
      path: '/ingest',
      request: 'session_feature.v1',
      idempotency_header: 'Idempotency-Key',
      response: 'ingest_session_feature_response.v1',
    },
  });
});

router.get('/:name', (req, res) => {
  const contractName = String(req.params.name).replace(/\.schema\.json$/, '');
  const schema = schemas[contractName] || schemas[aliases[contractName]];
  if (!schema) return res.status(404).json({ error: 'Unknown contract' });
  return res.json(schema);
});

module.exports = router;
