// Invoked by successful server backup/restore scripts, never by HTTP requests.
import {stat,open} from 'node:fs/promises';
import {basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from './src/db.mjs';
export async function inspectBackupArchive(path){
 const info=await stat(path);if(!info.isFile()||info.size<20)throw new Error('Backup archive must be a nonempty regular file.');const name=basename(path);if(name.length>200||!(/\.(dump|gz)$/.test(name)))throw new Error('Backup archive must be a PostgreSQL custom dump or gzip archive.');
 const handle=await open(path,'r');try{const magic=Buffer.alloc(5);await handle.read(magic,0,5,0);const format=name.endsWith('.dump')?'postgres-custom':'gzip';if(format==='postgres-custom'?magic.toString('ascii')!=='PGDMP':magic[0]!==0x1f||magic[1]!==0x8b)throw new Error('Backup archive header does not match its format.');const hash=createHash('sha256');for await(const chunk of handle.createReadStream({start:0,autoClose:false}))hash.update(chunk);return {name,sizeBytes:info.size,sha256:hash.digest('hex'),scope:'database',format};}finally{await handle.close();}
}
export async function recordBackupEvidence(pool,archive,{verified=false,hostKind='unknown'}={}){
 if(!['unknown','local','school'].includes(hostKind))throw new Error('Backup host kind must be unknown, local or school.');
 if(verified){const original=(await pool.query("SELECT metadata FROM audit_events WHERE action='backup.created' AND metadata->>'sha256'=$1 ORDER BY created_at DESC LIMIT 1",[archive.sha256])).rows[0];if(!original)throw new Error('A restore verification must reference a recorded backup archive.');const metadata={...archive,hostKind,backupId:original.metadata.backupId,status:'verified',verifiedAt:new Date().toISOString()};await pool.query("INSERT INTO audit_events(action,resource_type,resource_id,metadata) VALUES('backup.restore_verified','backup',$1,$2)",[metadata.backupId,metadata]);return {id:metadata.backupId,status:'verified'};}
 const metadata={...archive,hostKind,backupId:randomUUID(),status:'created'};await pool.query("INSERT INTO audit_events(action,resource_type,resource_id,metadata) VALUES('backup.created','backup',$1,$2)",[metadata.backupId,metadata]);return {id:metadata.backupId,status:'created'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const action=process.argv[2],path=process.argv[3];if(!['--created','--verified'].includes(action)||!path)throw new Error('Usage: record-backup.mjs --created|--verified archive.dump|archive.sql.gz');
 const archive=await inspectBackupArchive(path),pool=createPool();try{console.log(JSON.stringify(await recordBackupEvidence(pool,archive,{verified:action==='--verified',hostKind:process.env.BACKUP_HOST_KIND||'unknown'})));}finally{await pool.end();}
}
