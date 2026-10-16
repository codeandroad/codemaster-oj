export interface Paper4Stage {
  id: string;
  title: string;
  description: string;
  maxMarks: number;
  judgeMode?: "auto" | "manual" | "evidence";
}

export interface Paper4Question {
  key: string;
  title: string;
  statement: string;
  starterCode: string;
  initialFiles: Record<string, string>;
  outputFiles?: string[];
  stages: Paper4Stage[];
}

export interface Paper4RunnerCase {
  id: string;
  stdin: string;
  inputFiles: Record<string, string>;
  expectedStdout: string;
  expectedFiles: Record<string, string>;
  public: boolean;
  driverCode?: string;
}

export interface Paper4Paper {
  id: string;
  title: string;
  description: string;
  classId: string | null;
  status: string;
  archivedAt?: string | null;
  canExport?: boolean;
  startsAt: string | null;
  endsAt: string | null;
  totalMarks: number;
  firstAcPointsPerQuestion?: number;
  questions: Paper4Question[];
  runnerCases?: Record<string, Paper4RunnerCase[]>;
  referenceSolutions?: Record<string, string>;
  referenceValidation?: Record<string, { status: "unverified" | "queued" | "AC" | "WA" | "error"; taskId?: string | null }>;
  hasDraft?: boolean;
  versionId?: string;
  versionNumber?: number;
}

export type Paper4PaperSummary = Omit<Paper4Paper, "questions" | "runnerCases"> & {
  questionCount: number;
  className?: string | null;
};

export interface Paper4File {
  fileKey: string;
  content: string;
  revision: number;
}

export interface Paper4Snapshot {
  id: string;
  stageId: string;
  fileKey: string;
  sourceCode?: string;
  createdAt: string;
  revision?: number;
}

export interface Paper4Mark {
  stageId: string;
  marks: number;
  note: string;
}

export interface Paper4Attempt {
  id: string;
  paperId: string;
  status: string;
  files: Paper4File[];
  snapshots: Paper4Snapshot[];
  marks: Paper4Mark[];
  score: number | null;
  totalMarks: number;
  firstAcPointsPerQuestion?: number;
  rankAwards?: Array<{ questionKey: string; points: number; versionId: string; createdAt: string }>;
  formalJudging?: { total: number; pending: number; completed: number; failed: number };
  releasedAt: string | null;
  paper: Paper4Paper;
  studentName?: string;
  studentIdentityId?: string;
  submittedAt?: string | null;
  canEdit?: boolean;
}

export interface Paper4AttemptSummary {
  id: string;
  paperId: string;
  status: string;
  studentName?: string;
  studentIdentityId?: string;
  identityId?: string;
  score?: number | null;
  submittedAt?: string | null;
  releasedAt?: string | null;
  versionNumber?: number;
  versionId?: string;
}

export interface Paper4Run {
  id: string;
  state: string;
  stageId?: string | null;
  result?: {
    status: string;
    publicOutput?: string;
    publicMessage?: string;
    publicResults?: Array<{
      caseId: string;
      stageId?: string;
      status: string;
      stdout?: string;
      stderr?: string;
      generatedFiles?: Record<string, string>;
      checks?: Array<{ kind: string; name: string; passed: boolean }>;
    }>;
    stageResults?: Array<{ stageId: string; status: string }>;
    pendingManualStageIds?: string[];
    evidenceStageIds?: string[];
    questionStatus?: "AC" | "NeedsReview" | string;
  } | null;
}

export const paper4Status = (status: string, locale: "zh" | "en") => {
  const names: Record<string, [string, string]> = {
    draft: ["草稿", "Draft"],
    published: ["已发布", "Published"],
    in_progress: ["作答中", "In progress"],
    active: ["作答中", "In progress"],
    submitted: ["已交卷", "Submitted"],
    reviewed: ["已批阅", "Reviewed"],
    released: ["成绩已公布", "Result released"],
    queued: ["排队中", "Queued"],
    leased: ["运行中", "Running"],
    running: ["运行中", "Running"],
    completed: ["运行结束", "Run complete"],
    failed: ["运行失败", "Run failed"],
  };
  return names[status]?.[locale === "en" ? 1 : 0] ?? status;
};

export function paper4Date(value: string | null | undefined, locale: "zh" | "en") {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(value));
}
