import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVimState,vimKey} from '../src/components/student/editor-vim.ts';
function editor(value, at=0) {
 let state=createVimState(),snapshot={value,start:at,end:at};
 return {
  get state(){return state;},get snapshot(){return snapshot;},
  key(key,mod={}){const next=vimKey(snapshot,state,{key,...mod});if(next){state=next.state;snapshot=next.snapshot;}return next;},
  keys(keys){for(const key of keys)this.key(key);return this;},
  insert(value){assert.equal(state.mode,'insert');snapshot={value:snapshot.value.slice(0,snapshot.start)+value+snapshot.value.slice(snapshot.end),start:snapshot.start+value.length,end:snapshot.start+value.length};return this;}
 };
}
test('normal, insert, Escape and Ctrl+[ preserve text and consume normal typing',()=>{
 const e=editor('abc');e.key('q');assert.equal(e.snapshot.value,'abc');e.key('i');assert.equal(e.state.mode,'insert');assert.equal(e.key('z'),null);e.insert('XY');e.key('Escape');assert.equal(e.state.mode,'normal');assert.equal(e.snapshot.start,1);assert.equal(e.snapshot.value,'XYabc');e.key('a');e.key('[',{ctrlKey:true});assert.equal(e.state.mode,'normal');
});
test('counts, horizontal, word and line motions',()=>{
 const e=editor('alpha beta gamma\nsecond\nthird');e.keys(['2','w']);assert.equal(e.snapshot.start,11);e.key('b');assert.equal(e.snapshot.start,6);e.key('e');assert.equal(e.snapshot.start,9);e.key('0');assert.equal(e.snapshot.start,0);e.key('$');assert.equal(e.snapshot.start,15);e.keys(['g','g']);assert.equal(e.snapshot.start,0);e.key('G');assert.equal(e.snapshot.start,24);e.keys(['2','g','g']);assert.equal(e.snapshot.start,17);
});
test('vertical motion restores preferred column after a short line',()=>{const e=editor('abcdef\nx\nabcdef',4);e.key('j');assert.equal(e.snapshot.start,7);e.key('j');assert.equal(e.snapshot.start,13);e.key('k');e.key('k');assert.equal(e.snapshot.start,4);});
test('dd, yy, counts, last-line delete and linewise paste',()=>{
 const e=editor('one\ntwo\nthree');e.keys(['y','y','p']);assert.equal(e.snapshot.value,'one\none\ntwo\nthree');e.keys(['2','d','d']);assert.equal(e.snapshot.value,'one\nthree');e.key('G');e.keys(['d','d']);assert.equal(e.snapshot.value,'one');e.key('p');assert.equal(e.snapshot.value,'one\nthree');
});
test('operator counts multiply and deletion cannot escape buffer',()=>{const e=editor('a b c d e f g');e.keys(['2','d','3','w']);assert.equal(e.snapshot.value,'g');e.keys(['9','9','9','x']);assert.equal(e.snapshot.value,'');e.keys(['d','d','p']);assert.equal(e.snapshot.value,'\n');});
test('dw, de, d$, dgg, dG and backwards operators',()=>{
 const e=editor('alpha beta\ngamma\ndelta');e.keys(['d','w']);assert.equal(e.snapshot.value,'beta\ngamma\ndelta');e.keys(['d','e']);assert.equal(e.snapshot.value,'\ngamma\ndelta');e.key('j');e.keys(['d','$']);assert.equal(e.snapshot.value,'\n\ndelta');e.key('G');e.keys(['d','g','g']);assert.equal(e.snapshot.value,'');
 const f=editor('one\ntwo\nthree',4);f.keys(['d','G']);assert.equal(f.snapshot.value,'one');
 const b=editor('alpha beta',6);b.keys(['d','b']);assert.equal(b.snapshot.value,'beta');
});
test('ciw and caw enter insert with the right register and cursor',()=>{const e=editor('alpha beta',2);e.keys(['c','i','w']);assert.equal(e.snapshot.value,' beta');assert.equal(e.state.mode,'insert');assert.equal(e.snapshot.start,0);e.insert('new');e.key('Escape');assert.equal(e.snapshot.value,'new beta');const f=editor('alpha beta',2);f.keys(['d','a','w']);assert.equal(f.snapshot.value,'beta');});
test('cc preserves a separator, O/o inherit indentation without changing original lines',()=>{
 const e=editor('  alpha\nbeta');e.keys(['c','c']);assert.equal(e.snapshot.value,'\nbeta');assert.equal(e.state.mode,'insert');
 const o=editor('  alpha\nbeta');o.key('o');assert.equal(o.snapshot.value,'  alpha\n  \nbeta');assert.equal(o.snapshot.start,10);
 const O=editor('  alpha\nbeta');O.key('O');assert.equal(O.snapshot.value,'  \n  alpha\nbeta');assert.equal(O.snapshot.start,2);
});
test('characterwise and linewise visual selection work in both directions',()=>{
 const e=editor('alpha beta',2);e.keys(['v','h','h']);assert.deepEqual([e.snapshot.start,e.snapshot.end],[0,3]);e.key('y');assert.equal(e.state.register,'alp');e.key('p');assert.equal(e.snapshot.value,'aalplpha beta');
 const v=editor('one\ntwo\nthree',4);v.keys(['V','j','d']);assert.equal(v.snapshot.value,'one');assert.equal(v.state.register,'two\nthree\n');
});
test('replace, find, joins, undo/redo and cancellation',()=>{
 const e=editor('abc def\nghi');e.keys(['f','d']);assert.equal(e.snapshot.start,4);e.keys(['2','r','Z']);assert.equal(e.snapshot.value,'abc ZZf\nghi');e.key('J');assert.equal(e.snapshot.value,'abc ZZf ghi');assert.equal(e.key('u').history,'undo');assert.equal(e.key('r',{ctrlKey:true}).history,'redo');e.keys(['d','Escape']);assert.equal(e.state.operator,'');
});
test('literal search wraps and N finds backwards',()=>{const e=editor('alpha beta alpha');e.keys(['/','a','l','p','h','a','Enter']);assert.equal(e.snapshot.start,11);e.key('n');assert.equal(e.snapshot.start,0);e.key('N');assert.equal(e.snapshot.start,11);e.keys(['/','x','Escape']);assert.equal(e.state.query,null);assert.equal(e.snapshot.value,'alpha beta alpha');});
test('empty lines, trailing newline, non-Latin words, browser shortcuts and Tab',()=>{
 const e=editor('\nalpha\n');e.key('0');assert.equal(e.snapshot.start,0);e.key('G');assert.equal(e.snapshot.start,7);e.key('i');e.insert('尾');e.key('Escape');assert.equal(e.snapshot.start,7);
 const c=editor('中文 变量');c.key('w');assert.equal(c.snapshot.start,3);
 const f=editor('abc');assert.equal(f.key('s',{metaKey:true}),null);assert.equal(f.key('Tab'),null);assert.equal(f.snapshot.value,'abc');
});
test('Unicode supplementary characters are never split by motions, selections or deletion',()=>{
 const e=editor('a😀b');e.key('l');assert.equal(e.snapshot.start,1);e.key('l');assert.equal(e.snapshot.start,3);e.key('h');assert.equal(e.snapshot.start,1);e.key('x');assert.equal(e.snapshot.value,'ab');
 const v=editor('😀x');v.keys(['v','d']);assert.equal(v.snapshot.value,'x');
 const r=editor('😀x');r.keys(['r','a']);assert.equal(r.snapshot.value,'ax');
 const end=editor('😀');end.key('$');assert.equal(end.snapshot.start,0);end.keys(['d','$']);assert.equal(end.snapshot.value,'');
});
test('cw keeps following whitespace and normal-mode EOF clamps to the final character',()=>{
 const e=editor('alpha beta');e.keys(['c','w']);assert.equal(e.snapshot.value,' beta');assert.equal(e.state.mode,'insert');
 const f=editor('abc',3);f.key('x');assert.equal(f.snapshot.value,'ab');assert.equal(f.snapshot.start,1);
});
test('a new literal search wraps from the last line and missing text keeps the caret',()=>{const e=editor('alpha\nbeta\ngamma',14);e.keys(['/','b','e','t','a','Enter']);assert.equal(e.snapshot.start,6);e.keys(['/','z','z','z','Enter']);assert.equal(e.snapshot.start,6);});
