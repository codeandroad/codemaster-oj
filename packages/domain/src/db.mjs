import pg from 'pg';
export function createPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required; there is no demo database fallback.');
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  // Network loss can invalidate idle clients between requests. pg removes that
  // client; handle its notification so the process survives and can reconnect.
  pool.on('error', error => {
    const code = /^[A-Z0-9_]{1,32}$/.test(error?.code ?? '') ? error.code : 'CONNECTION_LOST';
    console.error(JSON.stringify({ event: 'database_idle_connection_error', code }));
  });
  return pool;
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
