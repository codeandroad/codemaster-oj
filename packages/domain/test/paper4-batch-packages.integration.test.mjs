import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createPool } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { handlePaper4 } from '../src/paper4.mjs';
import { parsePaper4BatchImport } from '../src/paper4-collection.mjs';
const source=new URL('../../../content/paper4-pastpapers/',import.meta.url);
test('Paper 4 bulk import is atomic and private exports roundtrip all 32 papers without publishing or overwriting',
 {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
  const manager=createPool(process.env.TEST_DATABASE_URL),schema=`paper4_packages_${randomBytes(6).toString('hex')}`;
  await manager.query(`CREATE SCHEMA ${schema}`);const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-csearch_path=${schema}`);
  const pool=createPool(url.href);
  try{
   await migrate(pool);
   async function account(role){
    const identityId=(await pool.query('INSERT INTO identities(kind,number,name) VALUES($1,$2,$3) RETURNING id',[role,randomUUID(),role])).rows[0].id;
    const id=(await pool.query('INSERT INTO accounts(identity_id,username,password_hash) VALUES($1,$2,$3) RETURNING id',[identityId,randomUUID(),'fixture-hash'])).rows[0].id;
    await pool.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',[id,role]);return{id,identityId,roles:[role]};
   }
   const teacher=await account('teacher'),other=await account('teacher'),student=await account('student'),admin=await account('admin');
   async function request(user,route,body,expected=200){
    const result=await handlePaper4({pool,user,route,method:'POST',body,url:new URL(`http://test/api/v1${route}`)});
    assert.ok(result);assert.equal(result.status,expected);return result.body;
   }
   const denied=(user,route,body,status)=>assert.rejects(request(user,route,body),error=>error.status===status);
   const files=[];
   for(const year of ['2021','2022','2023','2024','2025','2026'])for(const filename of (await readdir(new URL(`${year}/`,source))).filter(name=>/^9618_[sw]\d\d_4[123]\.json$/.test(name)).sort())
    files.push({filename,contentBase64:(await readFile(new URL(`${year}/${filename}`,source))).toString('base64')});
   const body={files};assert.equal(files.length,32);
   const count=async()=>Number((await pool.query('SELECT count(*) n FROM paper4_papers')).rows[0].n);
   for(const route of ['/paper4/imports/batch-preview','/paper4/papers/batch-import'])await denied(student,route,body,403);
   const preview=await request(teacher,'/paper4/imports/batch-preview',body);assert.equal(preview.totalPapers,32);assert.equal(await count(),0);
   const imported=await request(teacher,'/paper4/papers/batch-import',body,201);assert.equal(imported.count,32);
   for(const paper of imported.items){
    assert.equal(paper.status,'draft');assert.equal(paper.deliveryKind,'catalog');assert.equal(paper.classId,null);assert.equal(paper.startsAt,null);assert.equal(paper.endsAt,null);
    assert.equal(paper.canManage,true);assert.ok(Object.values(paper.referenceValidation).every(v=>v.status==='unverified'));
   }
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_run_tasks')).rows[0].n,0);
   // Include both a published paper and drafts in the same export. Publication
   // behaviour itself is covered by the separate Paper 4 integration suite.
   const first=imported.items[0];
   await pool.query('UPDATE paper4_versions SET published_at=now() WHERE id=$1',[first.versionId]);
   await pool.query("UPDATE paper4_papers SET status='published',published_at=now(),draft_version_id=NULL WHERE id=$1",[first.id]);
   const ids=imported.items.map(p=>p.id),existing=(await pool.query('SELECT * FROM paper4_papers ORDER BY id')).rows;
   await denied(student,'/paper4/papers/batch-export',{paperIds:ids},403);
   await denied(other,'/paper4/papers/batch-export',{paperIds:ids},403);
   const foreign=await request(other,'/paper4/papers/batch-import',{files:[files[0]]},201);
   const auditBefore=(await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='paper4.batch_export'")).rows[0].n;
   await denied(teacher,'/paper4/papers/batch-export',{paperIds:[ids[0],foreign.items[0].id]},403);
   assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='paper4.batch_export'")).rows[0].n,auditBefore);
   for(const user of [teacher,admin]){
    const exported=await request(user,'/paper4/papers/batch-export',{paperIds:ids});
    assert.equal(exported.filename,'paper4-papers.zip');assert.equal(exported.paperCount,32);
    const roundtrip=parsePaper4BatchImport({files:[{filename:exported.filename,contentBase64:exported.contentBase64}]});
    assert.deepEqual(roundtrip.items.map(p=>p.createBody),imported.items.map(p=>({title:p.title,shortTitle:p.shortTitle,description:p.description,examYear:p.examYear,examSession:p.examSession,examVariant:p.examVariant,classId:null,startsAt:null,endsAt:null,questions:p.questions,runnerCases:p.runnerCases,referenceSolutions:p.referenceSolutions})));
   }
   const archive=await request(teacher,'/paper4/papers/batch-export',{paperIds:ids});
   const copies=await request(teacher,'/paper4/papers/batch-import',{files:[{filename:archive.filename,contentBase64:archive.contentBase64}]},201);
   assert.equal(copies.count,32);assert.ok(copies.items.every(p=>p.status==='draft'&&!ids.includes(p.id)));
   assert.deepEqual((await pool.query('SELECT * FROM paper4_papers WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,existing,'imports create fresh drafts and leave every existing paper untouched');
   const beforeInvalid=await count(),bad=JSON.parse(Buffer.from(files[0].contentBase64,'base64'));
   bad.questions[0].stages[0].maxMarks--;
   const invalidBatch={files:[files[1],{filename:'invalid.json',contentBase64:Buffer.from(JSON.stringify(bad)).toString('base64')}]};
   for(const route of ['/paper4/imports/batch-preview','/paper4/papers/batch-import'])await denied(teacher,route,invalidBatch,400);
   assert.equal(await count(),beforeInvalid,'semantic validation does not partially import a valid prefix');
   // A failing later database insert must roll back the earlier paper and audit.
   const rejectedManifest=JSON.parse(Buffer.from(files[0].contentBase64,'base64'));rejectedManifest.paper.title='Reject this fixture only';
   await pool.query(`CREATE FUNCTION reject_import_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.title='Reject this fixture only' THEN RAISE EXCEPTION 'forced batch import failure'; END IF; RETURN NEW; END $$`);
   await pool.query('CREATE TRIGGER reject_import_fixture BEFORE INSERT ON paper4_papers FOR EACH ROW EXECUTE FUNCTION reject_import_fixture()');
   const audits=(await pool.query('SELECT count(*)::int n FROM audit_events')).rows[0].n;
   await assert.rejects(request(teacher,'/paper4/papers/batch-import',{files:[files[1],{filename:'rejected.json',contentBase64:Buffer.from(JSON.stringify(rejectedManifest)).toString('base64')}]},201),/forced batch import failure/);
   assert.equal(await count(),beforeInvalid);assert.equal((await pool.query('SELECT count(*)::int n FROM audit_events')).rows[0].n,audits);
   assert.equal((await pool.query('SELECT count(*)::int n FROM submissions')).rows[0].n,0);
   assert.equal((await pool.query('SELECT count(*)::int n FROM paper4_rank_ledger')).rows[0].n,0);
  }finally{await pool.end();await manager.query(`DROP SCHEMA ${schema} CASCADE`);await manager.end();}
 });
