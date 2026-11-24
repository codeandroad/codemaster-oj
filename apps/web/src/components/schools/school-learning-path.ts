import type { LearningEditorPath } from "../teacher/learning";
import type { CourseDetail } from "./school-courses-model";
import { courseAcslReferences } from "../course-acsl";

type Chapters = NonNullable<LearningEditorPath["chapters"]>;

export function schoolLearningPath(schoolId: string, course: CourseDetail): LearningEditorPath {
  return {
    ...course,
    schoolData: { schoolId, course },
    ownerScope: "school",
    published: course.status === "published",
    canEdit: course.canManage,
    chapters: course.chapters.map(({body, problems, ...chapter}, position) => ({
      ...chapter,
      position,
      content: body,
      problems: (problems ?? []).map(link => ({
        problemId: link.problemId,
        versionId: link.versionId,
        title: link.title ?? link.problemId,
        readyForCourse: link.available === true,
      })),
    })),
  };
}

// The school endpoint takes a complete draft, even for a settings-only change.
export function schoolChapterPayload(chapters: Chapters) {
  return chapters.map(({id, sectionKey, title, content, objective, checkpoint, checkpointAnswer, localizations, acslLinks, problems}) => ({
    id, sectionKey, title, body: content, objective, checkpoint, checkpointAnswer,
    localizations: localizations ?? null,
    ...(acslLinks && {acslLinks: courseAcslReferences(acslLinks)}),
    problems: problems.map(({problemId, versionId}) => ({problemId, versionId})),
  }));
}
