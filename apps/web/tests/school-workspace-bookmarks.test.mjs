import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schoolBookmarkQuery} from '../src/components/schools/school-workspace-location.ts';
import {publicPracticeReturnHref} from '../src/components/schools/public-workspace-model.ts';

test('saved school URLs retain the school, resource and authorized workspace action', () => {
  for (const [url, section, params] of [
    ['/admin/settings','system-settings',{}], ['/admin/accounts','members',{}],
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
});
