import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationIssue} from '../src/components/auth/registration-fields.ts';

const values={number:'001',name:'Student',activationCode:'one-time-code',username:'student.name',password:' passphrase ',confirmation:' passphrase ',email:''};
test('identity verification checks required fields in visual order without requiring account fields',()=>{
 assert.equal(registrationIssue('verify',{...values,username:'',password:'',confirmation:''}),null);
 for(const [field,cleared] of [['number',{}],['name',{}],['activationCode',{}]]){
  assert.deepEqual(registrationIssue('verify',{...values,...cleared,[field]:'   '}),{field,kind:'required'});
 }
 assert.equal(registrationIssue('verify',{...values,number:'00001',name:'张同学'}),null);
});
test('optional email remains optional; only a supplied invalid email is rejected',()=>{
 for(const email of ['', '   ', 'student@example.test',' student@example.test '])assert.equal(registrationIssue('account',{...values,email}),null);
 for(const email of ['invalid','student @example.test','student@example'])assert.deepEqual(registrationIssue('account',{...values,email}),{field:'email',kind:'email'});
});
test('account format matches existing username and password bounds, without trimming passwords',()=>{
 for(const username of ['Ab1', 'a'.repeat(40),' Student.Name '])assert.equal(registrationIssue('account',{...values,username}),null);
 for(const username of ['ab','a'.repeat(41),'_abc','学生','abc def'])assert.equal(registrationIssue('account',{...values,username}).field,'username');
 for(const password of ['a'.repeat(7),'a'.repeat(129)])assert.equal(registrationIssue('account',{...values,password,confirmation:password}).field,'password');
 for(const password of ['a'.repeat(8),'a'.repeat(128),'  abcdef  '])assert.equal(registrationIssue('account',{...values,password,confirmation:password}),null);
 assert.equal(registrationIssue('account',{...values,confirmation:values.password.trim()}).field,'confirmation');
});
