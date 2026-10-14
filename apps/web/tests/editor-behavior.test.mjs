import {test} from 'node:test';import assert from 'node:assert/strict';
import {editKey,matchingBrackets} from '../src/components/student/editor-behavior.ts';
const options={language:'python',tabSize:4,autoIndent:true,autoClose:true};
const edit=(text,key,extra={})=>{const start=text.indexOf('|'),value=text.replace('|','');return editKey({value,start,end:start},key,{...options,...extra});};
test('Python suites add one indentation level, including inline comments',()=>{
 for(const source of ['def solve():|','if ready: # explain|','    for row in grid:|']){const result=edit(source,'Enter');assert.ok(result.value.endsWith(source.startsWith('    ')?'\n        ':'\n    '));}
});
test('ordinary lines inherit indent without blindly adding another level',()=>{assert.equal(edit('    result = 0|','Enter').value,'    result = 0\n    ');assert.equal(edit('    # comment:|','Enter').value,'    # comment:\n    ');});
test('Enter between paired delimiters creates an indented body and correctly positioned closing line',()=>{
 for(const language of ['cpp','javascript']){const result=edit('    if (ready) {|}', 'Enter',{language});assert.equal(result.value,'    if (ready) {\n        \n    }');assert.equal(result.start,result.value.indexOf('\n')+9);}
 assert.equal(edit('values = [|]','Enter').value,'values = [\n    \n]');
});
test('parentheses, brackets, braces, quotes and template quotes auto-close',()=>{for(const [key,pair] of Object.entries({'(':'()','[':'[]','{':'{}',"'":"''",'"':'""','`':'``'})){const result=edit('|',key,{language:'javascript'});assert.equal(result.value,pair);assert.equal(result.start,1);}});
test('selected code is wrapped and remains selected',()=>{const result=editKey({value:'value',start:0,end:5},'(',options);assert.deepEqual(result,{value:'(value)',start:1,end:6});});
test('closer skips an existing closing character rather than doubling it',()=>{assert.deepEqual(edit('(|)',')'),{value:'()',start:2,end:2});assert.equal(edit('"hi|"','"').start,4);});
test('Backspace removes an empty auto-pair as one action',()=>{for(const text of ['(|)','[|]','{|}','"|"',"'|'",'`|`'])assert.equal(edit(text,'Backspace',{language:'javascript'}).value,'');});
test('do not auto-pair inside comments or string contents, or apostrophes in words',()=>{for(const source of ['# note |','text = "abc|"'])assert.equal(edit(source,'('),null);assert.equal(edit('can|',"'"),null);assert.equal(edit('// note |','(',{language:'cpp'}),null);});
test('Tab and Shift Tab support selected multi-line indentation',()=>{const original={value:'alpha\nbeta',start:0,end:10},indented=editKey(original,'Tab',options);assert.equal(indented.value,'    alpha\n    beta');assert.equal(editKey(indented,'Tab',{...options,shift:true}).value,original.value);});
test('Shift Tab on the current line removes existing indentation',()=>{const result=edit('    |code','Tab',{shift:true});assert.equal(result.value,'code');assert.equal(result.start,0);});
test('Backspace removes one indentation stop and respects tab size',()=>{assert.equal(edit('      |','Backspace').value,'    ');assert.equal(edit('    |','Backspace',{tabSize:2}).value,'  ');});
test('typed closing curly brace dedents to its matching opening line',()=>{assert.equal(edit('if (ready) {\n    |','}',{language:'cpp'}).value,'if (ready) {\n}');});
test('matching brackets ignore strings and comments, and respect nested pairs',()=>{assert.deepEqual(matchingBrackets('([1])',1,'python'),[0,4]);assert.equal(matchingBrackets('"()"',2,'python'),null);assert.equal(matchingBrackets('# ()',3,'python'),null);assert.deepEqual(matchingBrackets('x = "()"; [1]',11,'javascript'),[10,12]);});
test('triple-quoted Python and C++ block comments suppress pairing',()=>{assert.equal(edit('s = """inside |','('),null);assert.equal(edit('/* inside |','(',{language:'cpp'}),null);});
test('settings disable automatic behavior while Tab remains available',()=>{assert.equal(edit('|','(',{autoClose:false}),null);assert.equal(edit('if x:|','Enter',{autoIndent:false}),null);assert.equal(edit('|','Tab',{autoClose:false,autoIndent:false}).value,'    ');});
