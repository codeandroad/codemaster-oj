import { createHash } from 'node:crypto';
import { fail, HttpError } from './security.mjs';
import { parsePaper4Import } from './paper4-import.mjs';
import { paper4ShortTitle } from './paper4-catalog.mjs';
import { archiveText, readPaper4Archive, writePaper4Archive } from './paper4-archive.mjs';

export const PAPER4_BATCH_MAX_FILES = 100;
export const PAPER4_BATCH_INPUT_BYTES = 8 * 1024 * 1024;
export const PAPER4_BATCH_EXPANDED_BYTES = 16 * 1024 * 1024;
export const PAPER4_BATCH_BODY_BYTES = 12 * 1024 * 1024;
const MAX_PAPER_BYTES = 1024 * 1024;
const packageError = message => fail(400,'PAPER4_IMPORT',message);
const plain = value => value && typeof value==='object' && !Array.isArray(value) && Object.getPrototypeOf(value)===Object.prototype;
const exactKeys = (value, keys, label) => {
 if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))packageError(`${label} has invalid fields.`);
};
function decodeFile(file){
 exactKeys(file,['filename','contentBase64'],'File');
 if(typeof file.filename!=='string'||file.filename.length>160||/[\\/\x00-\x1f\x7f]/.test(file.filename)||!/^.+\.(json|zip)$/i.test(file.filename))
  packageError('Choose Paper 4 .json or .zip packages.');
 const value=file.contentBase64;
 if(typeof value!=='string'||value.length>Math.ceil(PAPER4_BATCH_INPUT_BYTES/3)*4+4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
  packageError('Package content must be valid base64, with at most 8 MiB across all files.');
 const buffer=Buffer.from(value,'base64');
 if(!buffer.length||buffer.length>PAPER4_BATCH_INPUT_BYTES||buffer.toString('base64')!==value)packageError('Package content is empty, invalid or too large.');
 return buffer;
}
function ordinaryPackage(contents){
 let value;try{value=JSON.parse(archiveText(contents));}catch{return false;}
 return Array.isArray(value)||plain(value)&&value.format!=='codemaster-paper4'&&(Array.isArray(value.problems)||value.format==='codemaster-course');
}
function sourceError(filename,error){
 if(error instanceof HttpError)fail(error.status,error.code,`${filename}: ${error.message}`);throw error;
}

export function parsePaper4BatchImport(body){
 exactKeys(body,['files'],'Batch import');
 if(!Array.isArray(body.files)||!body.files.length||body.files.length>PAPER4_BATCH_MAX_FILES)packageError('Choose 1–100 Paper 4 package files.');
 const files=body.files.map(file=>({file,buffer:decodeFile(file)}));
 const names=new Set();let inputBytes=0,expandedBytes=0;
 for(const {file,buffer} of files){
  const name=file.filename.toLowerCase();if(names.has(name))packageError(`Duplicate input filename: ${file.filename}.`);names.add(name);
  inputBytes+=buffer.length;if(inputBytes>PAPER4_BATCH_INPUT_BYTES)packageError('Combined input files exceed 8 MiB.');
 }
 const items=[];
 const add=(buffer,extension,filename)=>{
  if(items.length>=PAPER4_BATCH_MAX_FILES)packageError('A batch may contain at most 100 papers.');
  if(buffer.length>MAX_PAPER_BYTES)packageError(`${filename}: a single paper package exceeds 1 MiB.`);
  if(extension==='json'&&ordinaryPackage(buffer))packageError(`${filename}: this is an ordinary OJ problem/course package. Import it from Problem banks → Import problems; Paper 4 requires a codemaster-paper4 package.`);
  let parsed;try{parsed=parsePaper4Import({filename:`paper4.${extension}`,contentBase64:buffer.toString('base64')});}catch(error){sourceError(filename,error);}
  const bytes=Buffer.byteLength(JSON.stringify(parsed.createBody));expandedBytes+=bytes;
  if(expandedBytes>PAPER4_BATCH_EXPANDED_BYTES)packageError('Combined expanded paper content exceeds 16 MiB.');
  // Delivery and publication state never travel with content imports.
  const createBody={...parsed.createBody,classId:null,startsAt:null,endsAt:null};
  items.push({sourceFilename:filename,preview:parsed.preview,createBody});
 };
 for(const {file,buffer} of files){
  try{
   if(file.filename.toLowerCase().endsWith('.json')){add(buffer,'json',file.filename);continue;}
   const entries=readPaper4Archive(buffer,{maxEntries:500,maxEntryBytes:MAX_PAPER_BYTES,maxExpandedBytes:PAPER4_BATCH_EXPANDED_BYTES});
   let rootManifest;try{rootManifest=entries.has('manifest.json')?JSON.parse(archiveText(entries.get('manifest.json'))):null;}catch{packageError('manifest.json is not valid JSON.');}
   if(rootManifest?.format==='codemaster-paper4'){add(buffer,'zip',file.filename);continue;}
   const indexName=entries.has('paper4-index.json')?'paper4-index.json':rootManifest?.format==='codemaster-paper4-collection'?'manifest.json':null;
   const used=new Set();let paths;
   if(indexName){
    let index;try{index=JSON.parse(archiveText(entries.get(indexName)));}catch{packageError('The Paper 4 collection index is not valid JSON.');}
    exactKeys(index,['format','version','papers'],'Collection index');
    if(index.format!=='codemaster-paper4-collection'||index.version!==1||!Array.isArray(index.papers)||!index.papers.length||index.papers.length>100)
     packageError('Unsupported Paper 4 collection index.');
    used.add(indexName);const seen=new Set();
    paths=index.papers.map(item=>{
     exactKeys(item,['path'],'Collection paper');
     if(typeof item.path!=='string'||!entries.has(item.path)||!/(\.json|\.zip)$/i.test(item.path)||seen.has(item.path.toLowerCase()))packageError('Collection index contains a missing, duplicate or invalid paper path.');
     seen.add(item.path.toLowerCase());return item.path;
    });
   }else paths=[...entries.keys()].filter(name=>/\.(json|zip)$/i.test(name)&&!/(^|\/)assets\//.test(name));
   if(!paths.length)packageError('ZIP contains no structured Paper 4 packages. Raw PDFs and source/data archives must be converted first.');
   for(const path of paths){
    if(used.has(path))packageError(`Duplicate paper path: ${path}.`);
    used.add(path);
    if(path.toLowerCase().endsWith('/manifest.json')){
     const prefix=path.slice(0,-'manifest.json'.length);
     const nested=[...entries].filter(([name])=>name.startsWith(`${prefix}assets/`));
     for(const [name] of nested)used.add(name);
     const packageEntries=[['manifest.json',entries.get(path)],...nested.map(([name,contents])=>[name.slice(prefix.length),contents])];
     add(writePaper4Archive(packageEntries),'zip',`${file.filename} / ${path}`);
    }else add(entries.get(path),path.toLowerCase().endsWith('.zip')?'zip':'json',`${file.filename} / ${path}`);
   }
   for(const name of entries.keys())if(!used.has(name))packageError(`Unused or unsupported collection entry: ${name}.`);
  }catch(error){if(error instanceof HttpError&&error.message.startsWith(`${file.filename}:`))throw error;sourceError(file.filename,error);}
 }
 return {items,totalPapers:items.length,inputBytes,expandedBytes};
}

export function paper4Manifest(p){
 return {format:'codemaster-paper4',version:1,paper:{title:p.title,shortTitle:paper4ShortTitle(p),description:p.description,
  ...(p.definition?.exam??{})},questions:p.definition.questions,runnerCases:p.runner_cases??{},referenceSolutions:p.reference_solutions??{}};
}
export function exportPaper4Collection(papers){
 if(!papers.length||papers.length>100)fail(400,'VALIDATION','Select 1–100 papers.');
 const entries=[],index={format:'codemaster-paper4-collection',version:1,papers:[]};let expanded=0;
 for(const paper of papers){
  const path=`papers/paper4-${paper.id}-v${paper.version_number}.json`;
  const bytes=Buffer.from(JSON.stringify(paper4Manifest(paper),null,2)+'\n');
  if(bytes.length>MAX_PAPER_BYTES)fail(413,'TOO_LARGE','One paper exceeds the 1 MiB package limit.');
  expanded+=bytes.length;if(expanded>PAPER4_BATCH_EXPANDED_BYTES)fail(413,'TOO_LARGE','The selected papers exceed 16 MiB; export a smaller selection.');
  index.papers.push({path});entries.push([path,bytes]);
 }
 entries.unshift(['paper4-index.json',Buffer.from(JSON.stringify(index,null,2)+'\n')]);
 const zip=writePaper4Archive(entries);
 if(zip.length>PAPER4_BATCH_INPUT_BYTES)fail(413,'TOO_LARGE','The collection exceeds 8 MiB; export a smaller selection.');
 return {filename:'paper4-papers.zip',contentType:'application/zip',contentBase64:zip.toString('base64'),paperCount:papers.length,
  sha256:createHash('sha256').update(zip).digest('hex')};
}
