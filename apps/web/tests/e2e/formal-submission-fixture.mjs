// This file runs inside the disposable migration container.
import { randomBytes } from 'node:crypto';
import { createPool } from './src/db.mjs';
import { hashPassword } from './src/security.mjs';
import { provisionSchool } from './src/schools.mjs';

const pool = createPool();
try {
  const password = randomBytes(24).toString('base64url');
  const hash = await hashPassword(password);
  const accounts = ['release-admin', 'release-teacher', 'release-student'];
  const ids = {};
  for (const username of accounts) {
    const {rows: [person]} = await pool.query(
      "INSERT INTO identities(kind,number,name) VALUES('personal',$1,$1) RETURNING id", [username]);
    const {rows: [account]} = await pool.query(
      'INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',
      [person.id, username, hash]);
    ids[username] = account.id;
  }
  const school = await provisionSchool(pool, {slug:'release-check', name:'Release check', adminUsername:accounts[0]});
  await pool.query("INSERT INTO school_memberships(school_id,account_id,role) VALUES($1,$2,'teacher')", [school.id, ids[accounts[1]]]);
  await pool.query('INSERT INTO platform_admins(account_id) VALUES($1)', [ids[accounts[0]]]);
  console.log(JSON.stringify({schoolId:school.id, admin:accounts[0], teacher:accounts[1], learner:accounts[2], password}));
} finally {
  await pool.end();
}
