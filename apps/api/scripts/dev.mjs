import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const compiler=path.join(root,'node_modules/typescript/bin/tsc');
const children=new Set();
let stopping=false;
function start(args){
 const child=spawn(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit'});
 children.add(child);child.once('exit',()=>children.delete(child));return child;
}
function stop(signal='SIGTERM'){
 if(stopping)return;stopping=true;
 for(const child of children)child.kill(signal);
 setTimeout(()=>{for(const child of children)child.kill('SIGKILL');},10000).unref();
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(signal));
const build=start([compiler,'-p','tsconfig.json']);
const result=await new Promise((resolve,reject)=>{build.once('exit',resolve);build.once('error',reject);});
if(result!==0||stopping){process.exitCode=result||1;}else{
 const watch=start([compiler,'-p','tsconfig.json','--watch','--preserveWatchOutput']);
 const server=start(['--watch','dist/main.js']);
 for(const child of [watch,server])child.once('exit',code=>{if(!stopping){process.exitCode=code||1;stop();}});
}
