import type { AcslDiagrams } from "./diagram-model";
import { parseAcslDiagrams } from "./diagram-validation";
import type { AcslTeacherInput } from "./teacher-model";

const empty = { en: [], zh: [] };
export function acslDiagramDrafts(input: AcslTeacherInput) {
  const drafts: Record<string, string> = {};
  const add = (key: string, diagrams?: AcslDiagrams) => {
    drafts[key] = JSON.stringify(diagrams ?? empty, null, 2);
  };
  for (const question of input.questions) {
    add(`${question.id}:statement`, question.statementDiagrams);
    add(`${question.id}:explanation`, question.explanationDiagrams);
    for (const option of question.options)
      add(`${question.id}:option:${option.id}`, option.diagrams);
  }
  if (input.programming)
    add("programming:statement", input.programming.statementDiagrams);
  return drafts;
}

export function acslInputWithDiagrams(
  input: AcslTeacherInput,
  drafts: Record<string, string>,
) {
  const result = structuredClone(input);
  function value(key: string, original?: AcslDiagrams) {
    const parsed = parseAcslDiagrams(drafts[key]);
    if (!parsed) throw new Error(key);
    return !original && parsed.en.length === 0 && parsed.zh.length === 0
      ? undefined
      : parsed;
  }
  for (const question of result.questions) {
    question.statementDiagrams = value(
      `${question.id}:statement`,
      question.statementDiagrams,
    );
    question.explanationDiagrams = value(
      `${question.id}:explanation`,
      question.explanationDiagrams,
    );
    for (const option of question.options)
      option.diagrams = value(
        `${question.id}:option:${option.id}`,
        option.diagrams,
      );
  }
  if (result.programming)
    result.programming.statementDiagrams = value(
      "programming:statement",
      result.programming.statementDiagrams,
    );
  return result;
}
