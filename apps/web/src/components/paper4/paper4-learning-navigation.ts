import type { CoursePaper4Link } from "@/components/course-paper4";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface Paper4LearningContext { learningPathId: string; chapterId: string; }
export function paper4LearningContext(search: { get: (key: string) => string | null }): Paper4LearningContext | null {
  const learningPathId = search.get("learningPathId"), chapterId = search.get("chapterId");
  return learningPathId && chapterId && uuid.test(learningPathId) && uuid.test(chapterId) ? { learningPathId, chapterId } : null;
}
export function paper4ChapterHref(context: Paper4LearningContext) {
  return `/student/learning-paths/${encodeURIComponent(context.learningPathId)}/chapters/${encodeURIComponent(context.chapterId)}`;
}
export function coursePaper4Href(link: Pick<CoursePaper4Link, "paperId" | "versionId" | "questionKey">, context: Paper4LearningContext, questionKey = link.questionKey) {
  const query = new URLSearchParams({ versionId: link.versionId, learningPathId: context.learningPathId, chapterId: context.chapterId });
  if (questionKey) query.set("question", questionKey);
  if (link.questionKey) query.set("courseQuestion", link.questionKey);
  return `/student/paper4/${encodeURIComponent(link.paperId)}?${query}`;
}
export function paper4EntryKey(userId: string, paperId: string, versionId?: string) { return `${userId}:${paperId}:${versionId || "current"}`; }
export function paper4InitialQuestion<T extends { key: string }>(questions: T[], requested?: string | null) { return questions.find(question => question.key === requested) ?? questions[0]; }
export function coursePaper4Progress(link: CoursePaper4Link) {
  const questions = link.questionKey ? link.questions.filter(question => question.key === link.questionKey) : link.questions;
  const total = link.questionKey ? 1 : questions.length || link.questionCount || 0;
  const completed = Math.min(total, Math.max(0, link.completedQuestions ?? questions.filter(question => question.completed).length));
  return { total, completed, done: total > 0 && completed === total, available: link.available !== false && link.readyForCourse !== false, pending: Math.max(0, link.pendingQuestions ?? questions.filter(question => question.pending).length) };
}
