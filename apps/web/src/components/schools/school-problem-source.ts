import type { EditorProblem } from "../teacher/problem-editor";
import type { Definition, Problem } from "./school-practice-types";

// The published version stays active while a separately revisioned school draft is edited.
export function schoolEditorProblem(problem: Problem, admin: boolean): EditorProblem {
  if (!problem.canManage || !problem.definition) throw new Error("Editable school problem required.");
  const draft = problem.definition;
  const job = problem.validation;
  const validationStatus = job?.status ?? (job?.state === "queued" ? "Waiting" : job?.state === "leased" ? "Judging" : "Draft");
  return {
    ...draft,
    id: problem.id,
    bankId: problem.bankId,
    bankName: problem.bankName,
    published: problem.published,
    editRevision: problem.revision,
    publishedRevision: problem.publishedRevision ?? undefined,
    versionId: problem.versionId ?? undefined,
    canEdit: true,
    canManageTutorial: problem.canManageTutorial,
    validationStatus,
    canPublish: admin && validationStatus === "AC" && (!problem.published || problem.hasDraftChanges === true),
  };
}

export function schoolEditorDefinition(problem: EditorProblem): Definition {
  const { title, statement, mode, functionName, starterCode, starterCodes, referenceCode, referenceLanguage,
    objective, inputDescription, outputDescription, parameters, returnType, timeLimitMs, memoryLimitMb,
    tags, difficulty, source, editorial, hints, hintPolicy } = problem;
  return {
    title, statement, mode, functionName, starterCode, starterCodes, referenceCode, referenceLanguage,
    objective, inputDescription, outputDescription, parameters, returnType, timeLimitMs, memoryLimitMb,
    tags, difficulty, source, editorial, hints, hintPolicy,
    comparator: mode === "function" ? "json" : problem.comparator ?? "tokens",
    samples: problem.samples.map(({ input, expected }) => ({ input, expected })),
    tests: (problem.tests ?? []).map(({ input, expected, weight }) => ({ input, expected, weight: weight ?? 1 })),
  };
}
