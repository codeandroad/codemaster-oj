import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createPool, transaction } from './db.mjs';
import { field, username, hashPassword } from './security.mjs';
export async function bootstrap(pool,{name,number,username:login,password}) {
 const passwordHash=await hashPassword(password);
 return transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(798944)');
  if((await db.query("SELECT 1 FROM account_roles WHERE role='admin' LIMIT 1")).rowCount) throw new Error('An administrator already exists; use administrator invitation instead.');
  const identity=(await db.query("INSERT INTO identities(kind,number,name) VALUES('admin',$1,$2) RETURNING id",[field(number,'工号'),field(name,'姓名')])).rows[0];
  const account=(await db.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identity.id,username(login),passwordHash])).rows[0];
  await db.query("INSERT INTO account_roles(account_id,role) VALUES($1,'admin')",[account.id]);
  await db.query("INSERT INTO audit_events(actor_account_id,action,resource_type,resource_id) VALUES($1,'admin.bootstrap','account',$2)",[account.id,account.id]);return account.id;
 });
}
async function hiddenPassword() {
 if(!stdin.isTTY) throw new Error('Non-interactive bootstrap requires BOOTSTRAP_PASSWORD from a secret manager.');
 stdout.write('Password (hidden): ');stdin.setRawMode(true);stdin.resume();
 return new Promise((resolve,reject)=>{
  let value='';const finish=()=>{stdin.off('data',onData);stdin.setRawMode(false);stdin.pause();stdout.write('\n');};
  const onData=chunk=>{for(const ch of chunk.toString('utf8')){if(ch==='\r'||ch==='\n'){finish();resolve(value);return;}if(ch==='\u0003'){finish();reject(new Error('Bootstrap cancelled.'));return;}if(ch==='\u007f'||ch==='\b')value=value.slice(0,-1);else if(ch>=' ')value+=ch;}};
  stdin.on('data',onData);
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const pool=createPool();const rl=createInterface({input:stdin,output:stdout});
 try {
  const name=process.env.BOOTSTRAP_NAME||await rl.question('Administrator name: ');
  const number=process.env.BOOTSTRAP_NUMBER||await rl.question('Staff number: ');
  const login=process.env.BOOTSTRAP_USERNAME||await rl.question('Username: ');
  rl.close();
  const secret=process.env.BOOTSTRAP_PASSWORD||await hiddenPassword();
  console.log(`Administrator created: ${await bootstrap(pool,{name,number,username:login,password:secret})}`);
 } finally { rl.close();await pool.end(); }
}
