import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createPool } from './db.mjs';
import { issueDeploymentReset } from './platform-governance.mjs';

const [username] = process.argv.slice(2);
if (!username || process.argv.length !== 3) {
  console.error('Usage: node src/recover-platform-admin.mjs <existing-platform-admin-username>');
  process.exitCode = 1;
} else {
  const input = createInterface({input:stdin,output:stdout});
  const pool = createPool();
  try {
    const note = await input.question('核验方式或工单号（请勿填写密码、证件号）: ');
    const issued = await issueDeploymentReset(pool,username,note);
    stdout.write(`\n账号 ${issued.username} 的一次性重置码（30 分钟有效，请私下交给本人）\n${issued.resetCode}\n`);
  } catch (error) {
    console.error('Recovery failed:',error.code ?? error.name);
    process.exitCode = 1;
  } finally {
    input.close();
    await pool.end();
  }
}
