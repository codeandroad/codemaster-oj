import assert from 'node:assert/strict';
import test from 'node:test';
import { courseSearchHref, courseSearchMaxLength, courseSearchQuery, filterCourseCatalog } from '../src/components/student/learning-course-search-model.ts';

const courses = [
  { title: 'Introduction to Python', description: 'Loops and text.', sourceSchool: 'Alpha' },
  { title: '网页开发', description: 'HTML 和结构。', sourceSchool: 'Beta' },
  { title: 'General programming', description: 'Use Python for projects.', sourceSchool: 'Alpha' },
];

test('course search matches titles and descriptions case-insensitively and preserves catalog order', () => {
  assert.deepEqual(filterCourseCatalog(courses, '  PYTHON '), [courses[0], courses[2]]);
  assert.deepEqual(filterCourseCatalog(courses, '结构'), [courses[1]]);
  assert.deepEqual(filterCourseCatalog(courses, 'beta'), []);
  assert.equal(filterCourseCatalog(courses, '   '), courses);
});

test('the course query can follow a course entry without changing scope or unrelated route parameters', () => {
  const href = '/schools?schoolId=alpha&section=courses&scope=public&publicCourseId=course#top';
  const result = new URL(courseSearchHref(href, ' 列表 & 函数 '), 'https://test.invalid');
  assert.equal(result.searchParams.get('courseQ'), '列表 & 函数');
  assert.equal(result.searchParams.get('scope'), 'public');
  assert.equal(result.searchParams.get('publicCourseId'), 'course');
  assert.equal(result.hash, '#top');
  assert.equal(courseSearchHref(result.pathname + result.search + result.hash, ' '), href);
  assert.equal(courseSearchHref('/practice/courses?courseQ=test', ''), '/practice/courses');
  assert.equal(courseSearchQuery('x'.repeat(200)).length, courseSearchMaxLength);
});
