import type { AcslDiagram, AcslDiagrams } from "./diagram-model";
import type { AcslLanguage, LocalizedText } from "./model";

export type AcslTeacherSummary = {
  id: string;
  versionId: string;
  slug: string;
  title: LocalizedText;
  division: string;
  season: string;
  round: number;
  roundLabel?: LocalizedText;
  hasProgramming: boolean;
  questionCount: number;
  enabled: boolean;
  canEdit: boolean;
  canExport: boolean;
};

export type AcslTeacherQuestion = {
  id: string;
  number: number;
  type: "single" | "multiple";
  topic: LocalizedText;
  statement: LocalizedText;
  statementDiagrams?: AcslDiagrams;
  options: { id: string; text: LocalizedText; diagrams?: AcslDiagrams }[];
  correctOptionIds: string[];
  explanation: LocalizedText;
  explanationDiagrams?: AcslDiagrams;
};

export type AcslTeacherPaper = AcslTeacherSummary & {
  contentHash: string;
  writtenRevision: string;
  writtenRevisionAt: string | null;
  changedQuestionIds: string[];
  questions: AcslTeacherQuestion[];
  programming: null | {
    id: string;
    title: string;
    statement: string;
    statementZh: string;
    statementDiagrams?: AcslDiagrams;
    samples: { input: string; expected: string }[];
    readOnlyJudge: {
      mode: string;
      comparator: string;
      timeLimitMs: number;
      memoryLimitMb: number;
      testCount: number;
    };
  };
};

export type AcslTeacherInput = {
  title: LocalizedText;
  questions: Omit<AcslTeacherQuestion, "number" | "type">[];
  programming?: {
    title: string;
    statement: string;
    statementZh: string;
    statementDiagrams?: AcslDiagrams;
  };
};

export function acslTeacherInput(paper: AcslTeacherPaper): AcslTeacherInput {
  return structuredClone({
    title: paper.title,
    questions: paper.questions.map((question) => ({
      id: question.id,
      topic: question.topic,
      statement: question.statement,
      ...(question.statementDiagrams
        ? { statementDiagrams: question.statementDiagrams }
        : {}),
      options: question.options,
      correctOptionIds: question.correctOptionIds,
      explanation: question.explanation,
      ...(question.explanationDiagrams
        ? { explanationDiagrams: question.explanationDiagrams }
        : {}),
    })),
    ...(paper.programming
      ? {
          programming: {
            title: paper.programming.title,
            statement: paper.programming.statement,
            statementZh: paper.programming.statementZh,
            ...(paper.programming.statementDiagrams
              ? { statementDiagrams: paper.programming.statementDiagrams }
              : {}),
          },
        }
      : {}),
  });
}

export function acslTeacherHref(
  baseHref: string,
  paperId?: string,
  editing = false,
  language?: AcslLanguage,
) {
  const [path, query] = baseHref.split("?");
  const params = new URLSearchParams(query);
  for (const key of ["paperId", "questionId", "coding", "edit", "export"])
    params.delete(key);
  if (paperId) params.set("paperId", paperId);
  if (editing) params.set("edit", "1");
  if (language) params.set("contentLanguage", language);
  return `${path}${params.size ? `?${params}` : ""}`;
}

export type AcslExportEnvelope = {
  filename: string;
  contentType: "application/json";
  contentBase64: string;
};

export type AcslPrintDocument = {
  schemaVersion: 1;
  kind: "questions" | "answers";
  language: AcslLanguage;
  slug: string;
  title: string;
  division: string;
  season: string;
  round: number;
  questions: {
    id: string;
    number: number;
    type: "single" | "multiple";
    topic: string;
    statement: string;
    statementDiagrams: AcslDiagram[];
    options: { id: string; text: string; diagrams: AcslDiagram[] }[];
    correctOptionIds?: string[];
    explanation?: string;
    explanationDiagrams?: AcslDiagram[];
  }[];
  programming: null | {
    title: string;
    statement: string;
    statementDiagrams: AcslDiagram[];
    samples: { input: string; expected: string }[];
  };
};
