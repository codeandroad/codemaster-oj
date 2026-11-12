import test from 'node:test';
import assert from 'node:assert/strict';
import {courseAudiencePolicy,courseAudiencePolicyForSave,activeAdmissionRules,validCourseInvitation} from '../src/components/schools/platform-course-admission-model.ts';
const school='11111111-1111-4111-8111-111111111111',identity='22222222-2222-4222-8222-222222222222';
const base={schoolIds:[school],studentIds:[identity]};
test('legacy scopes do not add independent accounts or requirements',()=>{
 for(const scope of ['all','schools','students']){
  const policy=courseAudiencePolicy({...base,audienceScope:scope});assert.equal(policy.independentRule,null);assert.equal(policy.scope,scope==='all'?'all':'custom');assert.equal(policy.schoolRules.length,scope==='schools'?1:0);assert.equal(policy.accountRules.length,scope==='students'?1:0);
  assert.deepEqual(activeAdmissionRules(policy).map(({admissionMode,minimumPoints,prerequisiteCourseIds})=>({admissionMode,minimumPoints,prerequisiteCourseIds})),[{admissionMode:'direct',minimumPoints:0,prerequisiteCourseIds:[]}]);
 }
});
test('audience mode changes preserve draft choices while sending only active rules',()=>{
 const rule={admissionMode:'invite',minimumPoints:25,prerequisiteCourseIds:[school],ruleId:identity,generation:school,invitation:{active:true,expiresAt:'2030-01-01T00:00:00Z'}};
 const draft={scope:'all',allRule:{admissionMode:'application',minimumPoints:0,prerequisiteCourseIds:[]},independentRule:rule,schoolRules:[{...rule,schoolId:school}],accountRules:[{...rule,identityId:identity}]};
 const before=structuredClone(draft),all=courseAudiencePolicyForSave(draft);assert.equal(all.independentRule,null);assert.deepEqual(all.schoolRules,[]);assert.deepEqual(all.accountRules,[]);assert.deepEqual(draft,before);
 const custom=courseAudiencePolicyForSave({...draft,scope:'custom'});assert.equal(custom.allRule,null);assert.deepEqual(custom.independentRule,rule);assert.equal(custom.accountRules[0].generation,school);assert.equal(custom.schoolRules[0].ruleId,identity);
});
test('existing policies retain rule identity and school-specific thresholds',()=>{
 const policy={scope:'custom',allRule:null,independentRule:null,schoolRules:[{schoolId:school,ruleId:identity,generation:school,admissionMode:'application',minimumPoints:100,prerequisiteCourseIds:[]}],accountRules:[]};
 assert.equal(courseAudiencePolicy({...base,audienceScope:'all',audiencePolicy:policy}),policy);assert.equal(activeAdmissionRules(policy)[0].minimumPoints,100);assert.equal(activeAdmissionRules({...policy,schoolRules:[]}).length,0);
});
test('course invitation validation accepts exactly six unambiguous uppercase letters or digits',()=>{
 for(const code of ['ABC234','789XYZ','JKMNPQ'])assert.equal(validCourseInvitation(code),true,code);
 for(const code of ['ABC23','ABC2345','AB0C23','ABOC23','AB1C23','ABIC23','ABLC23','abc234','AB C23','ABC23\n'])assert.equal(validCourseInvitation(code),false,JSON.stringify(code));
});
