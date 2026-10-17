import test from 'node:test';
import assert from 'node:assert/strict';
import {paper4ActivityInput,paper4BatchActivityInput} from '../src/components/paper4/paper4-activity-input.ts';
import {paper4ClassNames} from '../src/components/paper4/model.ts';
const draft={title:'  Queue practice  ',activityKind:'practice',participants:['no-class-student'],classIds:[],startsAt:'',endsAt:''};

test('untimed practice targets explicit students without any class',()=>{
 assert.deepEqual(paper4ActivityInput(draft,0),{title:'Queue practice',activityKind:'practice',participants:['no-class-student'],classIds:[],classId:null,startsAt:null,endsAt:null});
});

test('cross-class recipients remain explicit and duplicate selection does not duplicate assignment',()=>{
 const input=paper4ActivityInput({...draft,participants:['class-a-student','no-class-student','class-b-student','class-a-student'],classIds:['owned-a','owned-b','owned-a']},0);
 assert.deepEqual(input.participants,['class-a-student','no-class-student','class-b-student']);
 assert.deepEqual(input.classIds,['owned-a','owned-b']);
 assert.equal(input.classId,'owned-a');
 assert.deepEqual(draft.participants,['no-class-student']);
});

test('an activity requires one to 500 selected identities',()=>{
 assert.throws(()=>paper4ActivityInput({...draft,participants:[]},0),/ACTIVITY_AUDIENCE/);
 assert.throws(()=>paper4ActivityInput({...draft,participants:[' ']},0),/ACTIVITY_AUDIENCE/);
 assert.throws(()=>paper4ActivityInput({...draft,participants:Array.from({length:501},(_,i)=>`student-${i}`)},0),/ACTIVITY_AUDIENCE_LIMIT/);
 assert.equal(paper4ActivityInput({...draft,participants:Array.from({length:500},(_,i)=>`student-${i}`)},0).participants.length,500);
});

test('mock exams require a valid ordered window in Asia/Shanghai',()=>{
 assert.throws(()=>paper4ActivityInput({...draft,activityKind:'exam'},0),/ACTIVITY_EXAM_WINDOW/);
 assert.throws(()=>paper4ActivityInput({...draft,activityKind:'exam',startsAt:'2030-01-01T09:00'},0),/ACTIVITY_EXAM_WINDOW/);
 const result=paper4ActivityInput({...draft,activityKind:'exam',startsAt:'2030-01-01T09:00',endsAt:'2030-01-01T11:30'},0);
 assert.equal(result.startsAt,'2030-01-01T01:00:00.000Z');
 assert.equal(result.endsAt,'2030-01-01T03:30:00.000Z');
 assert.throws(()=>paper4ActivityInput({...draft,startsAt:'2030-01-01T09:00',endsAt:'2030-01-01T09:00'},0),/ACTIVITY_WINDOW_ORDER/);
 assert.throws(()=>paper4ActivityInput({...draft,endsAt:'2020-01-01T09:00'},Date.parse('2021-01-01')),/ACTIVITY_WINDOW_ENDED/);
 assert.throws(()=>paper4ActivityInput({...draft,endsAt:'2030-02-30T09:00'},0),/ACTIVITY_TIME/);
 assert.equal(paper4ActivityInput({...draft,startsAt:'2030-01-01T09:00'},0).endsAt,null);
});

test('activity metadata displays all class tags while direct assignments have no fake class',()=>{
 assert.equal(paper4ClassNames({classes:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'a',name:'A'}],className:'A'}),'A / B');
 assert.equal(paper4ClassNames({className:'Legacy class'}),'Legacy class');
 assert.equal(paper4ClassNames({className:null}), '');
});

test('batch activity preserves one common named audience and optional schedule without imposing a shared title',()=>{
 const common=Object.fromEntries(Object.entries(draft).filter(([key])=>key!=='title'));
 const result=paper4BatchActivityInput(['paper-a','paper-b'],common,0);
 assert.deepEqual(result.paperIds,['paper-a','paper-b']);
 assert.deepEqual(result.participants,['no-class-student']);
 assert.deepEqual(result.classIds,[]);assert.equal(result.classId,null);
 assert.equal(result.startsAt,null);assert.equal(result.endsAt,null);
 assert.equal(Object.hasOwn(result,'title'),false);
 for(const ids of [[],['a','a'],Array.from({length:101},(_,i)=>`paper-${i}`)])assert.throws(()=>paper4BatchActivityInput(ids,common,0),/ACTIVITY_PAPERS/);
 assert.throws(()=>paper4BatchActivityInput(['a'],{...common,participants:[]},0),/ACTIVITY_AUDIENCE/);
 assert.throws(()=>paper4BatchActivityInput(['a'],{...common,activityKind:'exam'},0),/ACTIVITY_EXAM_WINDOW/);
});
