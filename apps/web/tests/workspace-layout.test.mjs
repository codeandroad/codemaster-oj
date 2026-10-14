import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultLayout,restoreLayout,workspaceLayoutReducer as reduce,panelIds} from '../src/components/student/workspace-layout-model.ts';

test('all panels maximize, restore, collapse, reopen, hide and show independently',()=>{
 for(const panel of panelIds){let state=defaultLayout();state=reduce(state,{type:'toggle-maximize',panel});assert.equal(state.maximized,panel);state=reduce(state,{type:'toggle-maximize',panel});assert.equal(state.maximized,null);state=reduce(state,{type:'toggle-collapse',panel});assert.equal(state.panels[panel],'collapsed');state=reduce(state,{type:'show',panel});assert.equal(state.panels[panel],'open');state=reduce(state,{type:'hide',panel});assert.equal(state.panels[panel],'hidden');state=reduce(state,{type:'mobile',panel});assert.equal(state.panels[panel],'open');assert.equal(state.mobilePanel,panel);}
});
test('cannot hide or collapse the last open panel',()=>{
 let state=reduce(defaultLayout(),{type:'hide',panel:'statement'});state=reduce(state,{type:'toggle-collapse',panel:'testing'});const before=state;assert.equal(reduce(state,{type:'hide',panel:'editor'}),before);assert.equal(reduce(state,{type:'toggle-collapse',panel:'editor'}),before);
});
test('maximize opens a hidden panel and restores body content',()=>{
 let state=reduce(defaultLayout(),{type:'hide',panel:'testing'});state=reduce(state,{type:'toggle-maximize',panel:'testing'});assert.equal(state.panels.testing,'open');assert.equal(state.maximized,'testing');assert.equal(reduce(state,{type:'exit-maximize'}).maximized,null);
});
test('restoration tolerates corrupt saved data and keeps an open panel',()=>{
 for(const value of [null,[],42,'bad',{panels:{statement:'hidden',editor:'hidden',testing:'hidden'},editorPercent:Infinity}]){const state=restoreLayout(value);assert.ok(panelIds.some(p=>state.panels[p]==='open'));assert.ok(Number.isFinite(state.editorPercent));}
 assert.equal(restoreLayout({editorPercent:-100}).editorPercent,20);assert.equal(restoreLayout({editorPercent:999}).editorPercent,85);
});
test('vertical resize clamps finite values and rejects NaN',()=>{
 const state=defaultLayout();assert.equal(reduce(state,{type:'resize',percent:NaN}),state);assert.equal(reduce(state,{type:'resize',percent:900}).editorPercent,85);assert.equal(reduce(state,{type:'resize',percent:0}).editorPercent,20);
});
test('sequences never lose access to all workspace panels',()=>{
 const actions=panelIds.flatMap(panel=>['hide','toggle-collapse','toggle-maximize','show','mobile'].map(type=>({type,panel})));
 for(const a of actions)for(const b of actions)for(const c of actions){const state=[a,b,c].reduce(reduce,defaultLayout());assert.ok(panelIds.some(p=>state.panels[p]==='open'));if(state.maximized)assert.equal(state.panels[state.maximized],'open');assert.equal(state.panels[state.mobilePanel],'open');}
});
