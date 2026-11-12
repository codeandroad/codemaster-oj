import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readAcslBilingualTutorial} from './acsl-tutorial-document.mjs';
import {validateLearningDocument} from '../../packages/domain/src/learning-document.mjs';

// Authoring stays modular; importing creates a single course and stable topic keys.
export async function readUnifiedAcslCourse({unitIds}={}) {
 const manifest=JSON.parse(await readFile(new URL('../../content/acsl-tutorials/curriculum.json',import.meta.url),'utf8'));
 const authored=manifest.units.filter(unit=>unit.documents);
 if(unitIds)assert.deepEqual(unitIds,authored.slice(0,unitIds.length).map(unit=>unit.id),'Only an authored curriculum prefix can describe an earlier course.');
 const units=unitIds?authored.slice(0,unitIds.length):authored;
 const documents=await Promise.all(units.map(unit=>readAcslBilingualTutorial(unit.id)));
 const sections=units.map(unit=>({key:unit.id,title:unit.title.en,groupKey:`contest-${unit.round}`,groupTitle:`Contest ${unit.round}`,
  localizations:{en:{title:unit.title.en,groupTitle:`Contest ${unit.round}`},zh:{title:unit.title.zh,groupTitle:`第 ${unit.round} 轮`}}}));
 const lessons=documents.reduce((n,doc)=>n+doc.chapters.length,0);
 const en={title:'ACSL Intermediate Course',description:`Learn ACSL Intermediate through structured topics, worked examples and original self-checks, then practice with linked past-paper questions. ${units.length} topics and ${lessons} lessons are currently available; further topics will be added after review.`};
 const zh={title:'ACSL Intermediate 系统课程',description:`按专题学习概念、完整例题与原创自测，再进入关联真题练习。目前已编写 ${units.length} 个专题、${lessons} 节课，后续专题验收完成后逐步加入。`};
 const document={format:'codemaster-learning-path',version:1,...en,category:'ACSL · Intermediate',difficulty:'intermediate',coverKey:'general',
  estimatedMinutes:documents.reduce((n,doc)=>n+doc.estimatedMinutes,0),localizations:{en,zh},sections,
  chapters:documents.flatMap((doc,index)=>doc.chapters.map(chapter=>({...chapter,sectionKey:units[index].id})))};
 const validated=validateLearningDocument(document);
 assert.deepEqual(validated.sections,document.sections);
 assert.deepEqual(validated.chapters.map(c=>c.sectionKey),document.chapters.map(c=>c.sectionKey));
 assert.equal(new Set(document.chapters.flatMap(c=>c.acslLinks.map(r=>`${r.paperSlug}/${r.questionId}`))).size,document.chapters.reduce((n,c)=>n+c.acslLinks.length,0));
 return {document,units:units.map((unit,index)=>({id:unit.id,document:documents[index],chapterCount:documents[index].chapters.length}))};
}
