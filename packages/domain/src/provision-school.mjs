import { createPool } from './db.mjs';
import { provisionSchool } from './schools.mjs';

const [slug, name, adminUsername] = process.argv.slice(2);
if (!slug || !name || !adminUsername || process.argv.length !== 5) {
  console.error('Usage: node src/provision-school.mjs <slug> <name> <existing-admin-username>');
  process.exitCode = 1;
} else {
  const pool = createPool();
  try {
    console.log(JSON.stringify(await provisionSchool(pool, { slug, name, adminUsername })));
  } catch (error) {
    console.error('School provisioning failed:', error.code ?? error.name);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
