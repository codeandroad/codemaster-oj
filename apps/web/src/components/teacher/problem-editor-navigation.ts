export type ProblemEditorTarget = {
  title: string;
  select: () => void | Promise<void>;
};

export type ProblemEditorNavigation = {
  previous?: ProblemEditorTarget;
  next?: ProblemEditorTarget;
};

export function adjacentProblemRows<T extends { id: string }>(rows: readonly T[], currentId: string) {
  const index = rows.findIndex(row => row.id === currentId);
  if (index < 0) return {};
  return { previous: index > 0 ? rows[index - 1] : undefined, next: rows[index + 1] };
}
