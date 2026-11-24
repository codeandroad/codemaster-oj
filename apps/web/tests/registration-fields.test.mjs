import test from 'node:test';
import assert from 'node:assert/strict';
import {activationSchoolLabel,activationSchoolName,invalidAccountField} from '../src/components/auth/registration-fields.ts';

const values={username:'student.name',password:' passphrase ',confirmation:' passphrase ',email:''};
test('activation school options use localized names and disambiguate identical school names',()=>{
 const alpha={id:'a',slug:'alpha',name:'Alpha',nameEn:'Alpha School',nameZh:'甲学校'};
 const beta={id:'b',slug:'beta',name:'Beta',nameEn:'Alpha School',nameZh:'乙学校'};
 assert.equal(activationSchoolName(alpha,'en'),'Alpha School');
 assert.equal(activationSchoolName(alpha,'zh'),'甲学校');
 assert.equal(activationSchoolLabel(alpha,[alpha,beta],'en'),'Alpha School (alpha)');
 assert.equal(activationSchoolLabel(beta,[alpha,beta],'en'),'Alpha School (beta)');
 assert.equal(activationSchoolLabel(alpha,[alpha,beta],'zh'),'甲学校');
 assert.equal(activationSchoolName({...alpha,nameEn:''},'en'),'甲学校');
 assert.equal(activationSchoolName({...alpha,nameEn:'',nameZh:''},'en'),'Alpha');
});
test('optional email remains optional; only a supplied invalid email is rejected',()=>{
 for(const email of ['', '   ', 'student@example.test',' student@example.test '])assert.equal(invalidAccountField({...values,email}),null);
 for(const email of ['invalid','student @example.test','student@example'])assert.deepEqual(invalidAccountField({...values,email}),'email');
});
test('account format matches existing username and password bounds, without trimming passwords',()=>{
 for(const username of ['Ab1', 'a'.repeat(40),' Student.Name '])assert.equal(invalidAccountField({...values,username}),null);
 for(const username of ['ab','a'.repeat(41),'_abc','学生','abc def'])assert.equal(invalidAccountField({...values,username}),'username');
 for(const password of ['a'.repeat(7),'a'.repeat(129)])assert.equal(invalidAccountField({...values,password,confirmation:password}),'password');
 for(const password of ['a'.repeat(8),'a'.repeat(128),'  abcdef  '])assert.equal(invalidAccountField({...values,password,confirmation:password}),null);
 assert.equal(invalidAccountField({...values,confirmation:values.password.trim()}),'confirmation');
});
