import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contentBlocks,inlineTokens} from '../src/components/content-parser.ts';
import {parseLearningMarkdown} from '../src/components/teacher/learning-document.ts';

const table = source => contentBlocks(source).find(block=>block.kind==='table');

test('course coverage and evidence tables are parsed as three and six columns',()=>{
  const source=readFileSync(new URL('../../../content/9618-paper4-course/course.md',import.meta.url),'utf8');
  const course=parseLearningMarkdown(source);
  const coverage=table(course.chapters[0].content),evidence=table(course.chapters[15].content);
  assert.deepEqual(coverage.headers,['Syllabus skill','Course chapters','Place in this course']);
  assert.equal(coverage.rows.length,5);
  assert.equal(evidence.headers.length,6);
  assert.equal(evidence.rows.length,3);
  assert.ok(evidence.rows.every(row=>row.length===6));
});

test('optional outer pipes, CRLF and delimiter colons define column alignment',()=>{
  const block=table('Name | Score | Note\r\n:-- | :-: | --:\r\nAda | 12 | **Ready**\r\n');
  assert.deepEqual(block.headers,['Name','Score','Note']);
  assert.deepEqual(block.alignments,['left','center','right']);
  assert.deepEqual(block.rows,[['Ada','12','**Ready**']]);
});

test('escaped pipes and pipes within matching code spans remain in a single cell',()=>{
  const block=table(String.raw`| Expression | Notes |
| --- | --- |
| `+'`a|b`'+String.raw` | left \| right |
| `+'``a`|b``'+String.raw` | **x\|y** and $a_i$ |`);
  assert.deepEqual(block.rows[0],['`a|b`','left | right']);
  assert.equal(inlineTokens(block.rows[0][0])[0].text,'a|b');
  assert.equal(inlineTokens(block.rows[1][0])[0].text,'a`|b');
  assert.deepEqual(inlineTokens(block.rows[1][1]).filter(token=>token.kind!=='text').map(token=>token.kind),['strong','math']);
  assert.equal(inlineTokens(block.rows[1][1])[0].text,'x|y');
});

test('odd and even backslashes distinguish escaped pipes from cell separators',()=>{
  const block=table(['| A | B |','| - | - |',String.raw`| a\\| b |`,String.raw`| a\\\|b | c |`].join('\n'));
  assert.deepEqual(block.rows[0],[String.raw`a\\`,'b']);
  assert.equal(inlineTokens(block.rows[0][0])[0].text,'a\\');
  assert.deepEqual(block.rows[1],[String.raw`a\\|b`,'c']);
  assert.equal(inlineTokens(block.rows[1][0])[0].text,String.raw`a\|b`);
});

test('body rows are padded or truncated to the header width, and a body is optional',()=>{
  const block=table('| A | B |\n| --- | --- |\n| one |\n| two | three | ignored |\nfour');
  assert.deepEqual(block.rows,[['one',''],['two','three'],['four','']]);
  assert.deepEqual(table('| Header |\n| --- |').rows,[]);
});

test('tables stop at blank lines, headings, code fences and lists',()=>{
  const blocks=contentBlocks('Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n## Next\n\nAfter\n\n| A |\n| --- |\n```text\nexample\n```\n\n| B |\n| --- |\n- item');
  assert.deepEqual(blocks.map(block=>block.kind),['paragraph','table','heading','paragraph','table','code','table','list']);
  assert.equal(blocks[1].rows.length,1);
  assert.equal(blocks[4].rows.length,0);
  assert.equal(blocks[6].rows.length,0);
});

test('invalid delimiters and mismatched headers remain literal paragraphs',()=>{
  for(const source of ['| A | B |\n| --- |\n| 1 |','| A | B |\n| --- | text |','ordinary | pipe text\nno delimiter']){
    const blocks=contentBlocks(source);
    assert.equal(blocks.length,1);
    assert.equal(blocks[0].kind,'paragraph');
    assert.equal(blocks[0].text,source);
  }
});

test('table-looking code and untrusted cell markup are not interpreted as HTML',()=>{
  const source='| A | B |\n| --- | --- |\n| 1 | 2 |';
  const blocks=contentBlocks('```text\n'+source+'\n```');
  assert.equal(blocks[0].kind,'code');
  assert.equal(blocks[0].text,source);
  const cell=table('| Value |\n| --- |\n| <img src=x onerror=alert(1)> |').rows[0][0];
  assert.deepEqual(inlineTokens(cell),[{kind:'text',text:'<img src=x onerror=alert(1)>'}]);
});

test('a literal backslash does not escape a closing delimiter inside a code span',()=>{
  const value='a'+String.fromCharCode(92),source='`'+value+'`';
  assert.deepEqual(inlineTokens(source),[{kind:'code',text:value}]);
  const block=table('| Code | Note |\n| --- | --- |\n| '+source+' | kept |');
  assert.deepEqual(block.rows[0],[source,'kept']);
  assert.equal(inlineTokens(block.rows[0][0])[0].text,value);
});
