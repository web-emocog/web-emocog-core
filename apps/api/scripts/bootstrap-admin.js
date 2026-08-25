#!/usr/bin/env node
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function bootstrapAdmin() {
  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  if (!email || !email.includes('@')) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL must contain a valid administrator email');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `bootstrap-admin:${email}`,
    ]);
    const existing = await client.query(
      'SELECT id, email, role FROM users WHERE email = $1 FOR UPDATE',
      [email]
    );

    let user;
    if (existing.rows[0]) {
      const updates = [
        'role = $1',
        'token_version = token_version + 1',
        'updated_at = current_timestamp',
      ];
      const params = ['admin'];
      if (password) {
        if (password.length < 12) {
          throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');
        }
        params.push(await bcrypt.hash(password, 12));
        updates.push(`password_hash = $${params.length}`);
      }
      params.push(existing.rows[0].id);
      const result = await client.query(
        `UPDATE users
         SET ${updates.join(', ')}
         WHERE id = $${params.length}
         RETURNING id, email, role, display_name, updated_at`,
        params
      );
      user = result.rows[0];
    } else {
      if (password.length < 12) {
        throw new Error(
          'BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters when creating an administrator'
        );
      }
      const result = await client.query(
        `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, $2, 'admin', 'Platform administrator')
         RETURNING id, email, role, display_name, created_at`,
        [email, await bcrypt.hash(password, 12)]
      );
      user = result.rows[0];
    }

    await client.query('COMMIT');
    process.stdout.write(`Platform administrator ready: ${user.email} (id=${user.id})\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

bootstrapAdmin()
  .catch((error) => {
    process.stderr.write(`Admin bootstrap failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
