import test from 'node:test';
import assert from 'node:assert/strict';
import {filterAudienceStudents,addAudienceSelection,audienceClassIds,activityAudienceClassIds} from '../src/components/teacher/student-audience.ts';
const students=[{id:'alice',name:'Alice',number:'S001',classIds:['class-a','class-b']},{id:'bob',name:'Bob',number:'S002',classIds:['class-b']},{id:'none',name:'未分班同学',number:'S003',classIds:[]},{id:'old',name:'Historical',number:'',historical:true}];
test('class and unassigned filters search identities without changing the selected set',()=>{
 const selected=['alice'];
 assert.deepEqual(filterAudienceStudents(students,'class-b','',selected).map(s=>s.id),['alice','bob']);
 assert.deepEqual(filterAudienceStudents(students,'unassigned','S003',selected).map(s=>s.id),['none']);
 assert.deepEqual(filterAudienceStudents(students,'selected','',selected).map(s=>s.id),['alice']);
 assert.deepEqual(selected,['alice']);
});
test('adding another class or unassigned results preserves earlier selections and deduplicates',()=>{
 const first=['alice'];
 const next=addAudienceSelection(first,['alice','bob','none'],new Set(['bob']));
 assert.deepEqual(next,['alice','none']);
 assert.deepEqual(first,['alice']);
 assert.throws(()=>addAudienceSelection(['a'],['b'],new Set(),1),/AUDIENCE_LIMIT/);
});
test('optional class tags deduplicate selected students memberships and exclude foreign classes',()=>{
 assert.deepEqual(audienceClassIds(students,['alice','bob','none'],['class-b']),['class-b']);
 assert.deepEqual(audienceClassIds(students,['none'],['class-a','class-b']),[]);
});

test('existing activity class tags survive membership drift and append only on explicit recipient changes',()=>{
 const moved=[{id:'alice',name:'Alice',number:'S001',classIds:['new-class']}];
 assert.deepEqual(activityAudienceClassIds(moved,['alice'],['new-class'],['archived-class'],['alice']),['archived-class']);
 assert.deepEqual(activityAudienceClassIds(moved,['alice','none'],['new-class'],['archived-class'],['alice']),['archived-class','new-class']);
 assert.deepEqual(activityAudienceClassIds(moved,['alice','none'],[],['archived-class'],['alice']),['archived-class']);
 assert.deepEqual(activityAudienceClassIds(moved,['alice'],['new-class']),['new-class']);
});
