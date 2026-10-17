import test from 'node:test';
import assert from 'node:assert/strict';
import {courseSettingsInput,CourseSettingsInputError,courseCoverByteLength,courseCoverMaxBytes} from '../src/components/teacher/course-settings-input.ts';
const draft={title:' Course ',description:'',category:' Python ',estimatedMinutes:60,difficulty:'beginner',coverKey:'general',coverImage:'',authorName:' Teacher ',authoredAt:'2030-01-01T09:00',accessScope:'school',classIds:['old-class'],availableFrom:'',availableUntil:'',listed:true};
const fails=(patch,code,section)=>assert.throws(()=>courseSettingsInput({...draft,...patch}),reason=>reason instanceof CourseSettingsInputError&&reason.code===code&&reason.section===section);

test('properties are fully validated regardless of which settings tab is displayed',()=>{
 for(const category of ['', ' ', 'x'.repeat(101)])fails({category},'CATEGORY','details');
 for(const estimatedMinutes of [0,10081,1.5,NaN,Infinity])fails({estimatedMinutes},'MINUTES','details');
 fails({title:' '},'TITLE','details');fails({title:'x'.repeat(201)},'TITLE','details');
 fails({authorName:'x'.repeat(121)},'AUTHOR','details');fails({description:'x'.repeat(4001)},'DESCRIPTION','details');
 for(const authoredAt of ['', 'not a date', '2030-02-30T09:00'])fails({authoredAt},'AUTHORED_AT','details');
 const result=courseSettingsInput(draft);assert.equal(result.title,'Course');assert.equal(result.category,'Python');assert.equal(result.authorName,'Teacher');assert.equal(result.authoredAt,'2030-01-01T01:00:00.000Z');
});

test('access failures identify the access tab and school access clears class restrictions',()=>{
 fails({accessScope:'classes',classIds:[]},'CLASSES','access');
 fails({availableFrom:'bad'},'AVAILABLE_FROM','access');fails({availableUntil:'2030-02-30T09:00'},'AVAILABLE_UNTIL','access');
 fails({availableFrom:'2030-01-01T10:00',availableUntil:'2030-01-01T10:00'},'WINDOW','access');
 assert.deepEqual(courseSettingsInput(draft).classIds,[]);
 assert.deepEqual(courseSettingsInput({...draft,accessScope:'classes',classIds:['a','a','b']}).classIds,['a','b']);
 assert.equal(courseSettingsInput({...draft,availableUntil:'2030-01-01T11:00'}).availableFrom,null);
});

test('cover limits count decoded bytes exactly and reject malformed or unsupported base64',()=>{
 const cover=size=>'data:image/jpeg;base64,'+Buffer.alloc(size,1).toString('base64');
 assert.equal(courseCoverByteLength(cover(courseCoverMaxBytes)),courseCoverMaxBytes);
 assert.doesNotThrow(()=>courseSettingsInput({...draft,coverImage:cover(courseCoverMaxBytes)}));
 fails({coverImage:cover(courseCoverMaxBytes+1)},'COVER_LIMIT','details');
 for(const coverImage of ['https://example.com/image.jpg','data:image/svg+xml;base64,AAAA','data:image/jpeg;base64,AB==','data:image/jpeg;base64,','data:image/jpeg;base64,###'])fails({coverImage},'COVER','details');
});
