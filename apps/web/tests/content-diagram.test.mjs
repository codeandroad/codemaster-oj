import test from 'node:test';
import assert from 'node:assert/strict';
import {parseContentDiagram} from '../src/components/content-diagram.ts';
import {contentBlocks} from '../src/components/content-parser.ts';
import {parseLearningMarkdown,serializeLearningMarkdown} from '../src/components/teacher/learning-document.ts';

const diagram={id:'tree',width:400,height:160,alt:{en:'Root P with left child Q.',zh:'根 P 的左子节点为 Q。'},elements:[
 {type:'line',x1:200,y1:40,x2:100,y2:120},
 {type:'text',x:200,y:40,text:'P',anchor:'middle'},
]};
test('native diagram data survives parsing and course Markdown export without becoming code',()=>{
 const content='Before.\n\n```diagram\n'+JSON.stringify(diagram)+'\n```\n\nAfter.';
 const blocks=contentBlocks(content);assert.deepEqual(blocks.map(b=>b.kind),['paragraph','code','paragraph']);
 assert.equal(blocks[1].language,'diagram');assert.deepEqual(parseContentDiagram(blocks[1].text),diagram);
 const doc={format:'codemaster-learning-path',version:1,title:'Lesson',description:'Description',category:'ACSL',estimatedMinutes:30,chapters:[{title:'Tree',content,objective:'Build a tree',checkpoint:'Find the root.',checkpointAnswer:'P',problemIds:[]}]};
 assert.equal(parseLearningMarkdown(serializeLearningMarkdown(doc)).chapters[0].content,content);
});
test('invalid diagram geometry and executable SVG/HTML/URLs cannot enter the renderer',()=>{
 const changed=mutate=>{const value=structuredClone(diagram);mutate(value);return JSON.stringify(value);};
 for(const source of ['<svg onload="alert(1)"/>','{','null','[]',' '.repeat(100001),
  changed(d=>d.onclick='alert(1)'),changed(d=>d.width=Infinity),changed(d=>d.elements.push({type:'script',text:'alert(1)'})),
  changed(d=>d.elements[0].stroke='url(https://invalid.test/a)'),changed(d=>d.elements.push({type:'image',href:'https://invalid.test/a'})),
  changed(d=>d.elements[0].x1=20000),changed(d=>d.elements.push({type:'path',d:'M 0 0 L javascript:alert(1)'})),
  changed(d=>delete d.alt.zh),changed(d=>d.elements=Array.from({length:1001},()=>d.elements[0])),
 ])assert.equal(parseContentDiagram(source),null);
 // Text labels remain plain React text, even when they resemble markup.
 assert.equal(parseContentDiagram(changed(d=>d.elements[1].text='<script>plain text</script>')).elements[1].text,'<script>plain text</script>');
});
