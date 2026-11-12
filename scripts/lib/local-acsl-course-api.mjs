import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

export function localCourseOptions(argv,{merging=false}={}) {
 const values=new Set(['--origin','--auth-file']),flags=new Set(merging?['--apply']:['--import']),options={};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];assert.ok(values.has(key)||flags.has(key),`Unknown option: ${key}`);assert.ok(!(key in options),`Repeated option: ${key}`);
  if(flags.has(key))options[key]=true;
  else{assert.ok(argv[i+1]&&!argv[i+1].startsWith('--'),`Missing value for ${key}`);options[key]=argv[++i];}
 }
 return {origin:options['--origin'],authFile:options['--auth-file'],apply:Boolean(options[merging?'--apply':'--import'])};
}
export const unifiedJournalKey=(origin,username)=>createHash('sha256').update(`${origin}\0${username}\0acsl-intermediate-unified`).digest('hex');
export async function localCourseApi(options){
 assert.ok(options.origin&&options.authFile,'Local origin and private auth file are required.');
 const origin=new URL(options.origin);
 assert.ok(origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname)&&origin.port&&origin.pathname==='/'&&!origin.search&&!origin.hash&&!origin.username&&!origin.password,'Only an explicit local HTTP origin is allowed.');
 const auth=JSON.parse(await readFile(resolve(options.authFile),'utf8'));
 assert.ok(typeof auth.username==='string'&&auth.username&&typeof auth.password==='string'&&auth.password,'Private auth file requires username and password.');
 let cookie='',csrf='';
 async function request(path,body){
  assert.ok(/^[a-z0-9/-]+$/i.test(path));
  const response=await fetch(`${origin.origin}/api/v1/${path}`,{method:body===undefined?'GET':'POST',redirect:'error',headers:{Origin:origin.origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw Error(`${path}: HTTP ${response.status} (${value.error?.code??'REQUEST_FAILED'})`);
  if(path==='auth/login'){cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');csrf=value.csrfToken;assert.ok(value.user.roles.some(r=>['teacher','admin'].includes(r)),'A teacher account is required.');}
  return value;
 }
 await request('auth/login',auth);
 const directory=resolve('.campus-local/acsl-tutorial-import');await mkdir(directory,{recursive:true,mode:0o700});
 const journal=resolve(directory,`${unifiedJournalKey(origin.origin,auth.username)}.json`);
 return {request,origin:origin.origin,journal};
}
export function unifiedState(course,document,origin){
 return {hash:createHash('sha256').update(JSON.stringify(document)).digest('hex'),origin,courseId:course.id,
  chapterIds:course.chapters.map(c=>c.id),acslReferences:course.chapters.map(c=>(c.acslLinks??[]).map(({paperSlug,kind,questionId,versionId})=>({paperSlug,kind,...(questionId?{questionId}:{}),...(versionId?{versionId}:{})}))) };
}
export const saveUnifiedState=(journal,state)=>writeFile(journal,JSON.stringify(state,null,2)+'\n',{mode:0o600});
