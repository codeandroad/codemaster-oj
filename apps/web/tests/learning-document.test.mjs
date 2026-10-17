import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseLearningMarkdown,serializeLearningMarkdown} from '../src/components/teacher/learning-document.ts';
const sample=fs.readFileSync(new URL('../public/python-learning-path.md',import.meta.url),'utf8');
test('complete Python course has 20 ordered populated chapters with answers',()=>{const d=parseLearningMarkdown(sample);assert.equal(d.chapters.length,20);assert.ok(d.chapters.every(c=>c.content&&c.objective&&c.checkpoint&&c.checkpointAnswer&&!c.problemIds.length));});
test('Markdown export import roundtrip preserves every document field',()=>{const d=parseLearningMarkdown(sample);assert.deepEqual(parseLearningMarkdown(serializeLearningMarkdown(d)),d);});
test('code fences containing chapter markers do not create chapters',()=>{const d=parseLearningMarkdown(sample);d.chapters[0].content+='\n\n```text\n## 章节：不是章节\n### 参考答案\n```';assert.equal(parseLearningMarkdown(serializeLearningMarkdown(d)).chapters.length,20);});
test('UTF8 BOM and Windows newlines are accepted',()=>{assert.equal(parseLearningMarkdown('\uFEFF'+sample.replaceAll('\n','\r\n')).chapters.length,20);});
test('invalid version, oversized file and empty chapter are rejected',()=>{assert.throws(()=>parseLearningMarkdown(sample.replace('version: 1','version: 2')));assert.throws(()=>parseLearningMarkdown('x'.repeat(1572865)));const d=parseLearningMarkdown(sample);d.chapters[0].content='';assert.throws(()=>parseLearningMarkdown(serializeLearningMarkdown(d)));});
test('malformed references and unclosed fences fail before import',()=>{assert.throws(()=>parseLearningMarkdown(sample.replace('[]','["wrong"]')));assert.throws(()=>parseLearningMarkdown(sample+'\n```python\nprint(1)'));});
test('cover and difficulty survive roundtrip, remote covers are rejected',()=>{const d=parseLearningMarkdown(sample);assert.equal(d.coverKey,'python');assert.equal(d.difficulty,'beginner');d.difficulty='advanced';assert.equal(parseLearningMarkdown(serializeLearningMarkdown(d)).difficulty,'advanced');assert.throws(()=>parseLearningMarkdown(sample.replace('coverKey: python','coverKey: https://evil.example/cover.svg')));});

test('course display metadata roundtrips without importing access permissions',()=>{const d=parseLearningMarkdown(sample);d.authorName='Teacher Example';d.authoredAt='2021-06-01T00:00:00.000Z';d.coverImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6n8AAAAASUVORK5CYII=';const parsed=parseLearningMarkdown(serializeLearningMarkdown(d));assert.equal(parsed.authorName,d.authorName);assert.equal(parsed.authoredAt,d.authoredAt);assert.equal(parsed.coverImage,d.coverImage);const augmented=serializeLearningMarkdown({...d,accessScope:'classes',classIds:['foreign-class'],listed:false});const safe=parseLearningMarkdown(augmented);assert.equal(safe.accessScope,undefined);assert.equal(safe.classIds,undefined);assert.equal(safe.listed,undefined);});
test('course preview image rejects remote and disguised active content',()=>{const d=parseLearningMarkdown(sample);for(const coverImage of ['https://example.test/image.png','data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=','data:image/png;base64,PHN2Zz48L3N2Zz4='])assert.throws(()=>parseLearningMarkdown(serializeLearningMarkdown({...d,coverImage})));});

test('whole-paper and pinned-question references survive course Markdown export and import',()=>{
 const d=parseLearningMarkdown(sample);
 d.chapters[0].paper4Links=[{paperId:'11111111-1111-4111-8111-111111111111',versionId:'22222222-2222-4222-8222-222222222222',questionKey:null},{paperId:'33333333-3333-4333-8333-333333333333',versionId:'44444444-4444-4444-8444-444444444444',questionKey:'Q2'}];
 const text=serializeLearningMarkdown(d);
 assert.match(text,/### Paper 4 练习/);
 assert.deepEqual(parseLearningMarkdown(text).chapters[0].paper4Links,d.chapters[0].paper4Links);
 assert.equal(parseLearningMarkdown(sample).chapters[0].paper4Links,undefined);
});
test('invalid and duplicate Paper 4 course references fail before import',()=>{
 const d=parseLearningMarkdown(sample),paperId='11111111-1111-4111-8111-111111111111';
 for(const links of [[{paperId:'wrong'}],[{paperId,versionId:'wrong'}],[{paperId,questionKey:'../Q1'}],[{paperId,questionKey:'Q1'},{paperId,questionKey:'Q1'}]]){
  assert.throws(()=>parseLearningMarkdown(serializeLearningMarkdown({...d,chapters:[{...d.chapters[0],paper4Links:links}]})));
 }
});
