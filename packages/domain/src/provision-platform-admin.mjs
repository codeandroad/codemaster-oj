import { createPool } from './db.mjs';
import { provisionPlatformAdministrator } from './platform-governance.mjs';

const [username] = process.argv.slice(2);
if (!username || process.argv.length !== 3) {
  console.error('Usage: node src/provision-platform-admin.mjs <existing-username>');
  process.exitCode = 1;
} else {
  const pool = createPool();
  try {
    const result = await provisionPlatformAdministrator(pool, { username });
    console.log(JSON.stringify({ accountId: result.accountId, created: result.created }));
  } catch (error) {
    console.error('Platform administrator provisioning failed:', error.code ?? error.name);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
