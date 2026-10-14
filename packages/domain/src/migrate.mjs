import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, transaction } from './db.mjs';

// SECURITY DEFINER functions must resolve application tables in their own
// schema, never in a caller-controlled search_path (or an implicit temp schema).
// The SQL files use public for the production schema; isolated tests migrate
// into another schema and need that same fixed, trusted path at creation time.
const definerPath = 'SECURITY DEFINER SET search_path=public,pg_temp';
function quoteIdentifier(value) { return `"${value.replaceAll('"', '""')}"`; }

export async function migrate(pool) {
 const path = fileURLToPath(new URL('../migrations/',import.meta.url));
 await transaction(pool, async db => {
  await db.query("SELECT pg_advisory_xact_lock(798943)");
  const schema = (await db.query('SELECT current_schema() AS name')).rows[0]?.name;
  if (!schema || schema.startsWith('pg_temp_')) throw new Error('Migrations require a persistent application schema.');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const name of (await readdir(path)).filter(n=>n.endsWith('.sql')).sort()) {
   if (!(await db.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rowCount) {
    const sql = await readFile(`${path}${name}`,'utf8');
    const fixedPath = `SECURITY DEFINER SET search_path=${quoteIdentifier(schema)},pg_temp`;
    await db.query(schema === 'public' ? sql : sql.replaceAll(definerPath, fixedPath));
    await db.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
   }
  }
 });
}
if (process.argv[1]===fileURLToPath(import.meta.url)) { const pool=createPool(); try { await migrate(pool); console.log('Database migrations complete.'); } finally { await pool.end(); } }
