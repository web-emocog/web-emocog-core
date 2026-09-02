const MAX_POSTGRES_PARAMETERS = 65_535;

function boundedBatchSize(requested, columnsPerRow) {
  const columns = Number.isInteger(columnsPerRow) && columnsPerRow > 0
    ? columnsPerRow
    : 1;
  const parameterBound = Math.floor(MAX_POSTGRES_PARAMETERS / columns);
  const parsed = Number.parseInt(requested, 10);
  const candidate = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  return Math.max(1, Math.min(candidate, parameterBound));
}

async function insertEventPayloadsInChunks(queryable, options) {
  const sessionId = options.sessionId;
  const events = Array.isArray(options.events) ? options.events : [];
  const batchSize = boundedBatchSize(options.batchSize, 2);
  let inserted = 0;

  for (let start = 0; start < events.length; start += batchSize) {
    const batch = events.slice(start, start + batchSize);
    const values = batch.map((event, index) => {
      const offset = index * 2;
      return `($${offset + 1}, $${offset + 2}::jsonb)`;
    }).join(', ');
    const parameters = batch.flatMap(event => [sessionId, JSON.stringify(event)]);
    await queryable.query(
      `INSERT INTO events (session_id, payload) VALUES ${values}`,
      parameters
    );
    inserted += batch.length;
  }

  return inserted;
}

module.exports = {
  MAX_POSTGRES_PARAMETERS,
  boundedBatchSize,
  insertEventPayloadsInChunks,
};
