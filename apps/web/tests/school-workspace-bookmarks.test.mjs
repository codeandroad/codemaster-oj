import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountHomepageHref,isCampusRoute,loginReturnTo} from '../src/lib/campus-routes.ts';
import {schoolBookmarkQuery} from '../src/components/schools/school-workspace-location.ts';
import {publicPracticeReturnHref} from '../src/components/schools/public-workspace-model.ts';

test('saved school URLs retain the school, resource and authorized workspace action', () => {
  for (const [url, section, params] of [
    ['/admin/settings','system-settings',{}], ['/admin/accounts','members',{}],
    ['/admin/profile','me',{schoolRole:'admin',details:'1'}], ['/teacher/profile','me',{schoolRole:'teacher',details:'1'}],
    ['/admin/people/id','leaderboard',{profileId:'id'}], ['/student/classes/id','classes',{classId:'id'}],
    ['/student/submissions/SUB1','submissions',{submissionId:'SUB1'}], ['/student/review-notebook/id','review-notebook',{reviewEntryId:'id'}],
    ['/teacher/problems/id/edit','problems',{problemEdit:'1',problemId:'id'}], ['/teacher/problems/solutions-review','scholarship',{}],
    ['/teacher/learning/id','courses',{courseEdit:'1',courseId:'id'}], ['/teacher/assignments/id/preview','assignments',{activityPreview:'1'}],
    ['/teacher/paper4/p/review/a','paper4',{paper4AttemptId:'a'}], ['/student/exam-preparation/cs/paper1','exam-preparation',{subject:'cs',component:'paper1'}],
  ]) {
    const result=schoolBookmarkQuery(url,new URLSearchParams(),'school-a');
    for (const [key,value] of Object.entries({schoolId:'school-a',section,...params})) assert.equal(result.get(key),value,url);
  }
});

test('returning from a public course exercise inside a school preserves the chapter and workspace', () => {
  const href=publicPracticeReturnHref('schoolId=s&section=problems&scope=public&publicCourseId=c&publicChapterId=h&problemId=p','/schools');
  const url=new URL(href,'http://localhost');
  assert.equal(url.pathname,'/schools');
  assert.deepEqual(Object.fromEntries(url.searchParams),{schoolId:'s',section:'courses',scope:'public',publicCourseId:'c',chapterId:'h'});
  const schoolHref=publicPracticeReturnHref('schoolId=s&section=problems&scope=public&publicCourseId=c&publicChapterId=h&problemId=p&courseScope=school&courseQ=Python','/schools');
  const schoolCourse=new URL(schoolHref,'http://localhost');
  assert.deepEqual(Object.fromEntries(schoolCourse.searchParams),{schoolId:'s',section:'courses',scope:'school',publicCourseId:'c',chapterId:'h',courseQ:'Python'});
});

test('the same account permalink works in each workspace and survives sign-in',()=>{
  const id='00000000-0000-4000-8000-000000000001';
  for (const scope of ['platform','practice','school',undefined]) {
    const href=accountHomepageHref(id,scope,'joined-school','teacher');
    const url=new URL(href,'http://localhost');
    assert.equal(url.pathname,'/people/'+id);
    assert.equal(isCampusRoute(url.pathname),true);
    assert.equal(loginReturnTo(href),href);
    assert.equal(url.searchParams.get('schoolRole'),scope==='school'?'teacher':null);
    assert.equal(url.searchParams.get('schoolId'),scope==='school'?'joined-school':null);
  }
});
