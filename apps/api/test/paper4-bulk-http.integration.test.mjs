import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createApiApplication} from '../dist/application.js';
import {createPool} from '../../../packages/domain/src/db.mjs';
import {migrate} from '../../../packages/domain/src/migrate.mjs';
import {bootstrap} from '../../../packages/domain/src/bootstrap.mjs';
import {loadConfig} from '../../../packages/domain/src/application.mjs';

test('real Nest Paper 4 bulk transport accepts all 32 packages while preserving ordinary limits and mutation guards',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL),schema=`paper4_bulk_http_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);const connection=new URL(process.env.TEST_DATABASE_URL);connection.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(connection.href);let app;
  try{
   await migrate(pool);const password=randomBytes(24).toString('base64url');
   await bootstrap(pool,{name:'Bulk administrator',number:'BULK-ADMIN',username:'bulk-admin',password});
   app=await createApiApplication({databaseUrl:connection.href,logger:false,config:loadConfig({SESSION_SECRET:randomBytes(48).toString('base64url'),APP_ORIGIN:'http://paper4.test',COOKIE_SECURE:'false'})});
   await app.listen(0,'127.0.0.1');const base=await app.getUrl();let cookie='',csrf='';
   async function request(path,body,{token=csrf}={}){
    const response=await fetch(`${base}/api/v1${path}`,{method:'POST',headers:{Origin:'http://paper4.test','Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':token},body:JSON.stringify(body)});
    const data=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(data.csrfToken)csrf=data.csrfToken;
    return {status:response.status,data};
   }
   assert.equal((await request('/auth/login',{username:'bulk-admin',password})).status,200);
   const files=[],source=new URL('../../../content/paper4-pastpapers/',import.meta.url);
   for(const year of ['2021','2022','2023','2024','2025','2026'])for(const filename of (await readdir(new URL(`${year}/`,source))).filter(n=>/^9618_[sw]\d\d_4[123]\.json$/.test(n)).sort())
    files.push({filename,contentBase64:(await readFile(new URL(`${year}/${filename}`,source))).toString('base64')});
   const body={files};assert.ok(Buffer.byteLength(JSON.stringify(body))>2*1024*1024);
   assert.equal((await request('/paper4/imports/preview',body)).status,413,'ordinary single imports keep their 2 MiB limit');
   const denied=await request('/paper4/imports/batch-preview',body,{token:'incorrect'});assert.equal(denied.status,403);assert.equal(denied.data.error.code,'CSRF');
   const preview=await request('/paper4/imports/batch-preview',body);assert.equal(preview.status,200);assert.equal(preview.data.totalPapers,32);
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_papers')).rows[0].n,0);
   assert.equal((await request('/paper4/papers/batch-import',body,{token:'incorrect'})).status,403);
   const created=await request('/paper4/papers/batch-import',body);assert.equal(created.status,201);assert.equal(created.data.count,32);
   const paperIds=created.data.items.map(p=>p.id);
   assert.equal((await request('/paper4/papers/batch-export',{paperIds},{token:'incorrect'})).status,403);
   const exported=await request('/paper4/papers/batch-export',{paperIds});assert.equal(exported.status,200);assert.equal(exported.data.filename,'paper4-papers.zip');
   assert.equal(exported.data.contentType,'application/zip');
   const tooLarge=await request('/paper4/imports/batch-preview',{padding:'x'.repeat(12*1024*1024)});assert.equal(tooLarge.status,413);
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_papers WHERE status=\'published\'')).rows[0].n,0);
  }finally{if(app)await app.close();await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
 });
