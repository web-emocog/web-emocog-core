async function withTransaction(pool, callback, options = {}) {
  const client = await pool.connect();
  let completed = false;
  try {
    await client.query('BEGIN');
    if (options.isolationLevel) {
      const allowed = new Set(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']);
      if (!allowed.has(options.isolationLevel)) {
        throw new Error('Unsupported transaction isolation level');
      }
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    completed = true;
    return result;
  } catch (error) {
    if (!completed) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

async function lockSessionKey(client, sessionId) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`session:${String(sessionId)}`]
  );
}

module.exports = {
  withTransaction,
  lockSessionKey,
};
