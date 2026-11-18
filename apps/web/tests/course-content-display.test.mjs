import test from 'node:test';
import assert from 'node:assert/strict';
import {contentBlocks,inlineTokens} from '../src/components/content-parser.ts';
import {contentCodeLanguage} from '../src/components/content-code-language.ts';

test('course headings keep all six authored levels',()=>{
  assert.deepEqual(contentBlocks('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six').map(x=>x.level),[1,2,3,4,5,6]);
});
test('explicit blank lines stack but remain literal inside code',()=>{
  assert.deepEqual(contentBlocks('a\n[blank]\n[blank]\nb').map(x=>x.kind),['paragraph','blank','blank','paragraph']);
  assert.equal(contentBlocks('```python\n[blank]\n```')[0].text,'[blank]');
  assert.equal(contentBlocks('| a |\n|---|\n| b |\n[blank]')[1].kind,'blank');
});
test('known language aliases highlight and unknown fences remain plain',()=>{
  for(const alias of ['python','py','Python3'])assert.equal(contentCodeLanguage(alias),'python');
  assert.equal(contentCodeLanguage('c++'),'cpp');assert.equal(contentCodeLanguage('js'),'javascript');
  assert.equal(contentCodeLanguage('text'),undefined);assert.equal(contentCodeLanguage(),undefined);
});
test('strong content can contain inline code',()=>{
  const strong=inlineTokens('**`xxx`**')[0];assert.equal(strong.kind,'strong');assert.deepEqual(inlineTokens(strong.text),[{kind:'code',text:'xxx'}]);
});
