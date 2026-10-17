export interface CoursePaper4Reference {
  paperId: string;
  versionId?: string;
  questionKey?: string | null;
}

export interface CoursePaper4Question {
  key: string;
  title: string;
  completed?: boolean;
  pending?: boolean;
}

export interface CoursePaper4Link extends CoursePaper4Reference {
  versionId: string;
  questionKey: string | null;
  title: string;
  shortTitle?: string;
  questionTitle?: string;
  versionNumber?: number;
  questionCount?: number;
  completedQuestions?: number;
  pendingQuestions?: number;
  completed?: boolean;
  available?: boolean;
  readyForCourse?: boolean;
  readiness?: string;
  questions: CoursePaper4Question[];
}

export function coursePaper4LinkKey(link: CoursePaper4Reference): string {
  return `${link.paperId}:${link.versionId ?? "current"}:${link.questionKey ?? "*"}`;
}

export function coursePaper4References(links: CoursePaper4Reference[] = []): CoursePaper4Reference[] {
  return links.map(({paperId, versionId, questionKey}) => ({paperId, ...(versionId ? {versionId} : {}), questionKey: questionKey ?? null}));
}

/** Whole-paper links include each question once, even if another chapter links it separately. */
export function coursePaper4UnitCount(links: CoursePaper4Link[] = []): number {
  const units = new Set<string>();
  for (const link of links) {
    if (link.available === false) continue;
    const questions = link.questionKey ? link.questions.filter(q => q.key === link.questionKey) : link.questions;
    for (const question of questions) units.add(`${link.versionId}:${question.key}`);
  }
  return units.size;
}

/** Within one chapter, a whole paper replaces overlapping individual-question shortcuts. */
export function mergeCoursePaper4Links(existing: CoursePaper4Link[], additions: CoursePaper4Link[]): CoursePaper4Link[] {
  const links = new Map(existing.map(link => [coursePaper4LinkKey(link), link]));
  for (const link of additions) {
    const sameVersion = (item: CoursePaper4Link) => item.paperId === link.paperId && item.versionId === link.versionId;
    if (link.questionKey === null) {
      for (const [key, item] of links) if (sameVersion(item)) links.delete(key);
    } else if ([...links.values()].some(item => sameVersion(item) && item.questionKey === null)) continue;
    links.set(coursePaper4LinkKey(link), link);
  }
  return [...links.values()];
}
