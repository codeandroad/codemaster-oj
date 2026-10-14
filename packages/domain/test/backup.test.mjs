import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {inspectBackupArchive} from '../record-backup.mjs';
test('backup receipts inspect PostgreSQL custom dumps and gzip bytes; reject filename/header substitution',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'campus-backup-evidence-'));try{
  const custom=join(directory,'campus.dump'),gzip=join(directory,'campus.sql.gz');await writeFile(custom,Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(40)]));await writeFile(gzip,gzipSync(Buffer.from('database contents for verification')));
  const a=await inspectBackupArchive(custom),b=await inspectBackupArchive(gzip);assert.equal(a.format,'postgres-custom');assert.equal(a.name,'campus.dump');assert.equal(a.sizeBytes,45);assert.equal(a.sha256.length,64);assert.equal(b.format,'gzip');assert.equal(Object.hasOwn(a,'path'),false);
  const wrong=join(directory,'wrong.dump');await writeFile(wrong,gzipSync(Buffer.from('incorrect filename/header')));await assert.rejects(inspectBackupArchive(wrong),/header/);
  const empty=join(directory,'empty.dump');await writeFile(empty,'PGDMP');await assert.rejects(inspectBackupArchive(empty),/nonempty/);await assert.rejects(inspectBackupArchive(directory),/regular file/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
