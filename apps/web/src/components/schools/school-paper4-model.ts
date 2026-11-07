import type {
  Paper4Question,
  Paper4RunnerCase,
  Paper4Paper,
} from "@/components/paper4/model";

export type SchoolPaper4Exam = {
  examYear?: number | null;
  examSession?: "summer" | "autumn" | null;
  examVariant?: 41 | 42 | 43 | null;
};
export type SchoolPaper4Definition = {
  language: "python";
  questions: Paper4Question[];
  exam: SchoolPaper4Exam;
  totalMarks: number;
};
export type SchoolPaper4Paper = {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  revision: number;
  published: boolean;
  versionId: string | null;
  archived: boolean;
  questionCount: number;
  totalMarks: number;
  exam: SchoolPaper4Exam;
  canManage: boolean;
  validation?: { state: string; status?: string | null } | null;
  definition?: SchoolPaper4Definition;
  questions?: Paper4Question[];
  runnerCases?: Record<string, Paper4RunnerCase[]>;
  referenceSolutions?: Record<string, string>;
};
export type SchoolPaper4Activity = {
  id: string;
  paperId: string;
  title: string;
  kind: "practice" | "exam";
  startsAt: string | null;
  endsAt: string | null;
  resultsPublished: boolean;
  canConfigureRule?: boolean;
  canManage: boolean;
  participantCount: number;
};
export type SchoolPaper4Job = {
  id: string;
  state: string;
  createdAt?: string;
  status?: string | null;
  kind?: string;
  publicMessage?: string;
  publicOutput?: string;
  questions?: {
    key: string;
    status: string;
    publicOutput?: string;
    publicMessage?: string;
    stages?: {
      stageKey: string;
      status: string;
      marks: number;
      maxMarks: number;
    }[];
  }[];
};
export type SchoolPaper4Attempt = {
  id: string;
  paperId: string;
  activityId: string | null;
  versionId: string;
  state: string;
  revision: number;
  definition: SchoolPaper4Definition;
  paper: Pick<
    SchoolPaper4Paper,
    "id" | "title" | "shortTitle" | "description" | "exam"
  >;
  files: Record<string, { code: string; revision: number }>;
  resultsVisible: boolean;
  canManage?: boolean;
  canEdit?: boolean;
  jobs: SchoolPaper4Job[];
  marks?: {
    stageKey: string;
    questionKey: string;
    title: string;
    judgeMode: string;
    maxMarks: number;
    marks: number | null;
    note?: string;
  }[];
  studentName?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  activityKind?: "practice" | "exam" | null;
  submittedAt?: string | null;
  releasedAt?: string | null;
  activity?: SchoolPaper4Activity | null;
};
export type SchoolPaper4AttemptSummary = Pick<
  SchoolPaper4Attempt,
  "id" | "state" | "studentName" | "submittedAt" | "activityId"
> & { score?: number | null };
export function originalPaper(
  paper: SchoolPaper4Attempt["paper"],
  definition: SchoolPaper4Definition,
): Paper4Paper {
  return {
    ...paper,
    ...paper.exam,
    questions: definition.questions,
    totalMarks: definition.totalMarks,
    status: "published",
    classId: null,
    startsAt: null,
    endsAt: null,
  };
}
export function schoolPaper4Location(
  search: string,
  patch: Record<string, string | null>,
): string {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return `?${next.toString()}`;
}
export function navigateSchoolPaper4(
  patch: Record<string, string | null>,
  replace = false,
) {
  const href =
    window.location.pathname +
    schoolPaper4Location(window.location.search, patch) +
    window.location.hash;
  if (replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}
export function paper4DraftFrom(paper: SchoolPaper4Paper | null) {
  return {
    title: paper?.title ?? "",
    shortTitle: paper?.shortTitle ?? "",
    description: paper?.description ?? "",
    exam: paper?.exam ?? {},
    questions: paper?.definition?.questions ??
      paper?.questions ?? [
        {
          key: "Q1",
          title: "Question 1",
          statement: "",
          starterCode: "",
          initialFiles: {},
          outputFiles: [],
          stages: [
            {
              id: "Q1a",
              title: "1(a)",
              description: "",
              maxMarks: 75,
              judgeMode: "auto" as const,
            },
          ],
        },
      ],
    runnerCases: paper?.runnerCases ?? {},
    referenceSolutions: paper?.referenceSolutions ?? {},
  };
}
export function paper4VisiblePapers(
  items: SchoolPaper4Paper[],
  year: string,
  session: string,
) {
  return items
    .filter(
      (p) =>
        (!year || String(p.exam?.examYear ?? "") === year) &&
        (!session || p.exam?.examSession === session),
    )
    .sort(
      (a, b) =>
        (b.exam?.examYear ?? 0) - (a.exam?.examYear ?? 0) ||
        (a.exam?.examSession ?? "z").localeCompare(
          b.exam?.examSession ?? "z",
        ) ||
        (a.exam?.examVariant ?? 99) - (b.exam?.examVariant ?? 99) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}
