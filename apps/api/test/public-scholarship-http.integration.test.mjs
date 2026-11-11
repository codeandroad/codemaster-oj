import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';
import {hashPassword} from '../../../packages/domain/src/security.mjs';
import {seedPublicScholarshipProblem} from '../../../packages/domain/test/helpers/public-scholarship.mjs';

test('public scholarship HTTP uses shared purchase rules without exposing private school content',
 {skip:!process.env.TEST_DATABASE_URL,timeout:120000},async t=>{
 const baseUrl=new URL(process.env.TEST_DATABASE_URL);
 assert.match(baseUrl.pathname,/^\/campus_qa(?:_[a-z0-9_]+)?$/);
 assert.ok(['localhost','127.0.0.1'].includes(baseUrl.hostname));
 const manager=createPool(baseUrl.href),schema='public_aid_http_'+randomBytes(6).toString('hex');
 await manager.query(`CREATE SCHEMA ${schema}`);
 const schemaUrl=new URL(baseUrl);schemaUrl.searchParams.set('options',`-csearch_path=${schema}`);
 const owner=createPool(schemaUrl.href);let app;
 try {
  await migrate(owner);
  const problem=await seedPublicScholarshipProblem(owner);
  const draft=await seedPublicScholarshipProblem(owner,{publishContent:false});
  const grants=(await readFile(new URL('../../../packages/domain/grants.mjs',import.meta.url),'utf8')).match(/await pool\.query\(`([\s\S]*?)`\);/)[1];
  await owner.query(grants.replaceAll('SCHEMA public',`SCHEMA ${schema}`));
  const appUrl=new URL(baseUrl);appUrl.searchParams.set('options',`-crole=campus_app -csearch_path=${schema}`);
  const origin='http://public-aid.test',password=randomBytes(24).toString('base64url');
  await owner.query("UPDATE accounts SET username='public-aid-author',password_hash=$2 WHERE id=$1",[problem.authorId,await hashPassword(password)]);
  await owner.query("INSERT INTO account_roles(account_id,role) VALUES($1,'teacher')",[problem.authorId]);
  app=await createApiApplication({databaseUrl:appUrl.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(32).toString('base64url'),APP_ORIGIN:origin,COOKIE_SECURE:'false'})});
  await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  async function request(path,{auth,body,method='GET',status=200,csrf=true}={}) {
   const res=await fetch(base+'/api/v1'+path,{method,headers:{Origin:origin,...(body!==undefined&&{'Content-Type':'application/json'}),...(auth&&{Cookie:auth.cookie,...(csrf&&{'X-CSRF-Token':auth.csrf})})},body:body===undefined?undefined:JSON.stringify(body)});
   const data=await res.json();assert.equal(res.status,status,`${method} ${path}: ${JSON.stringify(data.error??{})}`);
   return {data,headers:res.headers,cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const register=async username=>{
   const r=await request('/auth/register-personal',{method:'POST',status:201,body:{username,displayName:username,password,email:''}});
   return {id:r.data.user.id,identityId:r.data.user.identityId,csrf:r.data.csrfToken,cookie:r.cookie};
  };
  const learner=await register('public-aid-learner'),other=await register('public-aid-other');
  const input={problemId:problem.problemId,versionId:problem.versionId,kind:'FULL_TRANSLATION',language:'zh-CN'};
  const aid=(action,body=input,options={})=>request('/practice/scholarship/assistance/'+action,{auth:learner,method:'POST',body,...options});
  const wallet=async (auth=learner)=>(await request('/practice/scholarship/me',{auth})).data;
  const purchase=async (value,quote)=>aid('unlock',{...value,requestKey:randomUUID(),confirmedContentId:quote.contentId,confirmedPrice:quote.price});
  await t.test('authentication, CSRF and explicit wallet use; one stable initial allowance',async()=>{
   await request('/practice/scholarship/me',{status:401});
   await aid('quote',input,{auth:null,status:401});
   await aid('quote',input,{csrf:false,status:403});
   await request('/scholarship/me',{auth:learner,status:403});
   assert.equal((await owner.query('SELECT count(*)::int n FROM luq_ledger WHERE identity_id=$1',[learner.identityId])).rows[0].n,0);
   assert.deepEqual((await request('/practice/preferences',{auth:learner})).data,{scholarshipEnabled:false,rankingEnabled:false});
   assert.equal((await wallet()).balance,0);
   assert.equal((await aid('quote')).data.balance,0);
   const enable={method:'PATCH',auth:learner,body:{scholarshipEnabled:true}};
   await request('/practice/preferences',{...enable,csrf:false,status:403});
   const results=await Promise.all([request('/practice/preferences',enable),request('/practice/preferences',enable)]);
   assert.ok(results.every(r=>r.data.scholarshipEnabled&&!r.data.rankingEnabled));
   const wallets=await Promise.all([wallet(),wallet()]);
   assert.ok(wallets.every(w=>w.balance===100&&w.total===1));
   assert.deepEqual((await request('/practice/luq/me',{auth:learner})).data,await wallet());
  });
  await t.test('quote and public problem projection never preload reviewed body or private fields',async()=>{
   const shown=(await request('/practice/problems/'+problem.problemId,{auth:learner})).data;
   const quoted=await aid('quote');
   const oldQuote='/practice/luq/assistance/quote';
   await request(oldQuote,{auth:learner,method:'POST',body:input,csrf:false,status:403});
   assert.deepEqual((await request(oldQuote,{auth:learner,method:'POST',body:input})).data,quoted.data);
   const raw=JSON.stringify([shown,quoted.data]);
   for(const secret of ['PRIVATE_REFERENCE','PRIVATE_HIDDEN_INPUT','PRIVATE_TEACHER_NOTE','输出数字五。','Return the required constant.'])assert.ok(!raw.includes(secret));
   assert.equal(quoted.data.price,3);assert.equal(quoted.data.requiresConfirmation,true);
   assert.equal(quoted.data.balanceAfter,97);assert.equal(quoted.data.affectsFirstAcLuq,false);
   assert.equal(quoted.data.affectsFirstAcScholarship,false);
   await aid('provide',input,{status:403});
   await aid('unlock',{...input,requestKey:randomUUID(),confirmedContentId:quoted.data.contentId,confirmedPrice:0},{status:409});
   await aid('quote',{...input,versionId:randomUUID()},{status:404});
   await aid('quote',{...input,assignmentId:randomUUID()},{status:400});
   assert.equal((await wallet()).balance,100);
  });
  await t.test('concurrent repeated purchase charges once; translation credit reduces solution cost',async()=>{
   const quote=(await aid('quote')).data;
   const body={...input,requestKey:randomUUID(),confirmedContentId:quote.contentId,confirmedPrice:quote.price};
   const purchases=await Promise.all([aid('unlock',body),aid('unlock',body)]);
   assert.equal(purchases.reduce((sum,r)=>sum+r.data.charged,0),3);
   assert.equal((await wallet()).balance,97);
   assert.equal((await aid('provide')).data.body,'输出数字五。');
   const solution={...input,kind:'FULL_SOLUTION',language:''};
   const sq=(await aid('quote',solution)).data;
   assert.equal(sq.basePrice,8);assert.equal(sq.translationCredit,3);assert.equal(sq.price,5);
   assert.equal(sq.affectsFirstAcLuq,true);
   assert.equal(sq.affectsFirstAcScholarship,true);
   assert.equal((await purchase(solution,sq)).data.charged,5);
   const delivered=(await aid('provide',solution)).data;
   assert.match(delivered.body,/```python\nprint\(5\)\n```/);
   assert.ok(!JSON.stringify(delivered).includes('PRIVATE_'));
   await request('/practice/preferences',{method:'PATCH',auth:learner,body:{scholarshipEnabled:false}});
   assert.equal((await aid('quote',solution)).data.price,0);
   await aid('provide',solution);assert.equal((await wallet()).balance,92);
   assert.equal((await wallet(other)).balance,0);
   await aid('provide',solution,{auth:other,status:403});
   assert.equal((await owner.query("SELECT count(*)::int n FROM luq_ledger WHERE identity_id=$1 AND kind='purchase'",[learner.identityId])).rows[0].n,2);
  });
  await t.test('public delivery adds reviewed alternatives to the existing entitlement',async()=>{
   const login=await request('/auth/login',{method:'POST',body:{username:'public-aid-author',password}});
   const auth={cookie:login.cookie,csrf:login.data.csrfToken};
   const solution={...input,kind:'FULL_SOLUTION',language:''};
   const contents='/scholarship/contents';
   const {data:{items}}=await request(contents+'?'+new URLSearchParams({problemId:problem.problemId,versionId:problem.versionId}),{auth});
   const primary=items.find(item=>item.kind==='FULL_SOLUTION');
   const solutions=[
    {title:'Literal output',body:primary.body},
    {title:'Arithmetic expression',body:'Evaluate the sum.\n```python\nprint(2 + 3)\n```'},
   ];
   const edit=await request(contents,{auth,method:'POST',status:201,body:{...solution,body:primary.body,solutions,expectedHash:primary.contentHash}});
   assert.equal((await aid('provide',solution)).data.solutions,undefined);
   await request(`${contents}/${primary.id}/publish`,{auth,method:'POST',body:{reviewed:true,expectedHash:edit.data.contentHash}});
   const {data:quoted}=await aid('quote',solution);
   assert.equal(quoted.solutions,undefined);
   assert.ok(!JSON.stringify(quoted).includes('Arithmetic expression'));
   const {data:delivered}=await aid('provide',solution);
   assert.deepEqual(delivered.solutions.map(({title,body})=>({title,body})),solutions);
   await aid('provide',solution,{auth:other,status:403});
   assert.equal((await wallet()).balance,92);
  });
  await t.test('drafts, withdrawn aid and revoked publication block even previously paid rights',async()=>{
   const pending={...input,problemId:draft.problemId,versionId:draft.versionId};
   const q=(await aid('quote',pending)).data;assert.equal(q.available,false);assert.equal(q.contentId,null);
   await aid('unlock',{...pending,requestKey:randomUUID(),confirmedContentId:randomUUID(),confirmedPrice:3},{status:404});
   assert.equal((await wallet()).balance,92);
   await owner.query("UPDATE luq_assistance_contents SET status='withdrawn' WHERE id=$1",[problem.contentIds.FULL_TRANSLATION]);
   await aid('provide',input,{status:404});
   await owner.query("UPDATE luq_assistance_contents SET status='published' WHERE id=$1",[problem.contentIds.FULL_TRANSLATION]);
   assert.equal((await aid('provide')).data.body,'输出数字五。');
   await owner.query('UPDATE school_problem_publications SET withdrawn_at=clock_timestamp() WHERE problem_id=$1',[problem.problemId]);
   await aid('quote',input,{status:404});await aid('provide',input,{status:404});
   assert.equal((await wallet()).balance,92);
  });
 } finally {
  if(app)await app.close();await owner.end();
  await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();
 }
});
