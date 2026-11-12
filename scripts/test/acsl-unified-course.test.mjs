import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readUnifiedAcslCourse} from '../lib/acsl-unified-course.mjs';
import {readAcslBilingualTutorial} from '../lib/acsl-tutorial-document.mjs';
import {matchesTutorialDraft} from '../import-acsl-tutorials.mjs';

const keys=['number-systems','recursion','program-tracing','expressions','bit-strings','lisp','boolean-algebra','data-structures','automata-regex','graphs'];
const referenceKey=ref=>`${ref.paperSlug}/${ref.kind??'question'}/${ref.questionId}`;
const runCli=(name,args=[],options={})=>execFileSync(process.execPath,[fileURLToPath(new URL(`../${name}.mjs`,import.meta.url)),...args],{encoding:'utf8',stdio:'pipe',...options});

test('unified Intermediate course contains all authored topics and preserves every bilingual lesson and practice reference',async()=>{
 const {document,units}=await readUnifiedAcslCourse();
 const manifest=JSON.parse(readFileSync(new URL('../../content/acsl-tutorials/curriculum.json',import.meta.url),'utf8'));
 const authored=manifest.units.filter(unit=>unit.documents);
 assert.deepEqual(units.map(unit=>unit.id),keys);assert.deepEqual(document.sections.map(section=>section.key),keys);
 assert.equal(document.chapters.length,33);assert.deepEqual(units.map(unit=>unit.chapterCount),[4,3,3,3,3,3,3,4,4,3]);
 assert.deepEqual(document.sections.map(section=>section.groupKey),['contest-1','contest-1','contest-1','contest-2','contest-2','contest-2','contest-3','contest-3','contest-3','contest-4']);
 assert.equal(document.localizations.en.title,document.title);assert.match(document.localizations.zh.title,/Intermediate/);
 assert.ok(!manifest.units.filter(unit=>!unit.documents).some(unit=>document.sections.some(section=>section.key===unit.id)),'Planned topics do not become empty published-looking sections.');
 let offset=0,totalMinutes=0;
 for(const [index,unit] of units.entries()){
  const source=await readAcslBilingualTutorial(unit.id),chapters=document.chapters.slice(offset,offset+unit.chapterCount);
  assert.deepEqual(unit.document,source);assert.equal(unit.chapterCount,source.chapters.length);
  assert.ok(chapters.every(chapter=>chapter.sectionKey===unit.id));
  assert.deepEqual(chapters.map(({sectionKey,...chapter})=>chapter),source.chapters,`${unit.id}: canonical content, both localizations, self-checks and links must remain byte-identical.`);
  assert.equal(document.sections[index].localizations.en.title,authored[index].title.en);
  assert.equal(document.sections[index].localizations.zh.title,authored[index].title.zh);
  assert.deepEqual(chapters.flatMap(chapter=>chapter.acslLinks).map(referenceKey).sort(),authored[index].practiceReferences.map(referenceKey).sort(),`${unit.id}: every intended past-paper link survives.`);
  offset+=unit.chapterCount;totalMinutes+=source.estimatedMinutes;
 }
 assert.equal(document.estimatedMinutes,totalMinutes);
 const references=document.chapters.flatMap(chapter=>chapter.acslLinks);assert.equal(references.length,108);assert.equal(new Set(references.map(referenceKey)).size,108);
 assert.deepEqual(references.map(referenceKey).sort(),authored.flatMap(unit=>unit.practiceReferences).map(referenceKey).sort());
});

test('draft reconciliation refuses altered directory metadata or lesson placement without losing legacy compatibility',async()=>{
 const {document}=await readUnifiedAcslCourse();
 const course={...structuredClone(document),id:randomUUID(),canEdit:true,published:false,archived:false,
  chapters:document.chapters.map(chapter=>({...structuredClone(chapter),id:randomUUID(),problems:[],paper4Links:[],acslLinks:chapter.acslLinks.map(ref=>({...ref,versionId:randomUUID(),available:true,status:'not_started',completed:false}))}))};
 assert.equal(matchesTutorialDraft(course,document),true);
 const mutations=[
  value=>{delete value.sections;},value=>{value.sections.reverse();},value=>{value.sections.pop();},
  value=>{value.sections[0].title+=' changed';},value=>{value.sections[0].key='renamed-topic';},
  value=>{value.sections[0].groupKey='contest-2';},value=>{value.sections[0].groupTitle='Other round';},
  value=>{value.sections[0].localizations.zh.title+='改';},value=>{value.sections[0].localizations.en.groupTitle='Other round';},
  value=>{value.chapters[0].sectionKey='recursion';},value=>{delete value.chapters[0].sectionKey;},
  value=>{value.chapters[0].sectionKey=null;},value=>{value.chapters.find(chapter=>chapter.acslLinks.length).acslLinks.pop();},
 ];
 for(const mutate of mutations){const changed=structuredClone(course);mutate(changed);assert.equal(matchesTutorialDraft(changed,document),false,mutate.toString());}
 const old=await readAcslBilingualTutorial('recursion'),oldCourse={...structuredClone(old),id:randomUUID(),canEdit:true,published:false,archived:false,sections:[],chapters:old.chapters.map(chapter=>({...structuredClone(chapter),id:randomUUID(),sectionKey:null}))};
 assert.equal(matchesTutorialDraft(oldCourse,old),true,'Legacy missing grouping fields and explicit empty/null values are equivalent.');
});

test('unified import validates the complete course without credentials, API access or journal writes',()=>{
 const directory=mkdtempSync(join(tmpdir(),'acsl-unified-cli-'));
 try{
  const output=runCli('import-acsl-course',[],{cwd:directory});
  assert.deepEqual(JSON.parse(output),{validated:true,course:'ACSL Intermediate Course',topics:10,lessons:33,practiceLinks:108});
  assert.deepEqual(readdirSync(directory),[],'Validation alone must not create import state.');
  for(const args of [['--auth-file'],['--origin'],['--unit','recursion'],['--import','--import'],['--apply']]){
   assert.throws(()=>runCli('import-acsl-course',args,{cwd:directory}),error=>{
    assert.match(error.stderr,/Missing value|Unknown option|Repeated option/);assert.doesNotMatch(error.stdout,/courseId|published/);return true;
   });
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('individual topic imports are retired before authentication while local topic validation still works',()=>{
 const directory=mkdtempSync(join(tmpdir(),'acsl-retired-cli-'));
 try{
  assert.throws(()=>runCli('import-acsl-tutorials',['--import','--unit','lisp','--origin','http://127.0.0.1:1','--auth-file',join(directory,'missing-auth.json')],{cwd:directory}),error=>{
   assert.match(error.stderr,/Individual topic imports are retired/);assert.match(error.stderr,/import-acsl-course\.mjs/);assert.match(error.stderr,/merge-acsl-tutorials\.mjs/);
   assert.doesNotMatch(error.stderr,/ENOENT|ECONNREFUSED|fetch failed/);assert.doesNotMatch(error.stdout,/courseId|published/);return true;
  });
  assert.match(runCli('import-acsl-tutorials',['--unit','lisp'],{cwd:directory}),/Validated only.*lisp/);
  assert.deepEqual(readdirSync(directory),[]);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
