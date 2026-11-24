export type ProblemEditorTab = "statement" | "interface" | "tests" | "judge" | "solutions" | "tutorial" | "publication";

export type ProblemEditorTarget = {
  title: string;
  select: (tab?: ProblemEditorTab) => void | Promise<void>;
};

export type ProblemEditorNavigation = {
  previous?: ProblemEditorTarget;
  next?: ProblemEditorTarget;
  repeatAfterSolutions?: boolean;
};

export function adjacentProblemRows<T extends { id: string }>(rows: readonly T[], currentId: string) {
  const index = rows.findIndex(row => row.id === currentId);
  if (index < 0) return {};
  return { previous: index > 0 ? rows[index - 1] : undefined, next: rows[index + 1] };
}

export type CourseProblemEditorEntry = { id: string; chapterId: string; problemId: string; title: string; ownerScope?: "school" | "platform" };

export function courseProblemEditorEntryId(chapterId: string, problemId: string) {
  return `${chapterId}:${problemId}`;
}

export function courseProblemEditorEntries(chapters: readonly {
  id: string;
  problems: readonly { problemId: string; title: string; canEdit?: boolean; ownerScope?: "school" | "platform" }[];
}[]): CourseProblemEditorEntry[] {
  return chapters.flatMap(chapter => chapter.problems
    .filter(problem => problem.canEdit === true)
    .map(problem => ({
      id: courseProblemEditorEntryId(chapter.id, problem.problemId),
      chapterId: chapter.id,
      problemId: problem.problemId,
      title: problem.title,
      ownerScope: problem.ownerScope,
    })));
}
