export type CampusRole = "student" | "teacher" | "admin";
export type CampusGender = "male" | "female" | "other" | "undisclosed";
export interface CampusUser {
  id: string;
  showNicknameOnLeaderboard?:boolean;nickname?:string;bio?:string;avatar?:string;
  identityId: string;
  name: string;
  gender: CampusGender | null;
  username: string;
  roles: CampusRole[];
  platformAdmin?: boolean;
  defaultSchoolId?: string | null;
  number: string;
  email?: string | null;
}
export interface Person {
  id: string;
  kind: "student" | "teacher";
  number: string;
  name: string;
  gender?: CampusGender | null;
  activated?: boolean;
  accountId?: string | null;
}
export interface SchoolClass {
  description?:string;
  id: string;
  name: string;
  studentIds: string[];
  teacherIds: string[];
  type?: string;
}
export interface CampusAccount {
  id: string;
  identityId: string;
  name: string;
  number: string;
  gender?: CampusGender | null;
  username: string;
  roles: CampusRole[];
  disabled: boolean;
}
export interface ProblemCase {
  input: string;
  expected: string;
  weight?: number;
}
export interface ProductionProblem {
  id: string;
  solved?: boolean;
  title: string;
  mode: "stdio" | "function";
  statement: string;
  statementLanguage?: "en";
  publicStatementPending?: boolean;
  functionName?: string;
  starterCode: string;
  starterCodes?: Partial<Record<SubmissionLanguage, string>>;
  samples: ProblemCase[];
  tests?: ProblemCase[];
  referenceCode?: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  languageLimits?: Partial<Record<SubmissionLanguage, { effectiveMemoryMb: number; runtimeMemoryFloorMb?: number }>>;
  versionId?: string;
  editRevision?: number;
  publishedRevision?: number;
  draftReviewStatus?: "pending" | "rejected" | null;
  draftReviewReason?: string | null;
  canRequestReview?: boolean;
  published: boolean;
  validationStatus?: string;
  validationMessage?: string;
  canPublish?: boolean;
  publishedVersionId?: string | null;
  publishedTitle?: string | null;
  publishedDifficulty?: string | null;
  bankId?: string | null;
  bankName?: string | null;
  tags?: string[];
  difficulty?: string;
  objective?: string;
  parameters?: (string | { name: string; type?: string; description?: string })[];
  returnType?: string;
  source?: string;
  canEdit?: boolean;
  canManageTutorial?: boolean;
  firstAcPoints?: number;
  bankVisibility?: "school" | "private";
  schoolVisibleAt?: string | null;
  rankReviewStatus?: "pending" | "approved" | "rejected" | "revoked" | null;
  rankApprovedAt?: string | null;
}
export interface AssignmentCompletion {
  completedAt: string;
  elapsedMs: number | null;
  completedProblems: number;
  totalProblems: number;
  rewards: { firstAc: number; assignment: number; total: number };
}
export interface Assignment {
  id: string;
  title: string;
  archived?: boolean;
  className?: string;
  classId: string | null;
  classIds?: string[];
  classNames?: string[];
  classes?: { id: string; name: string }[];
  course?: string;
  coursePathId?: string | null;
  courseTitle?: string | null;
  courseAvailable?: boolean;
  requiredLanguage?: SubmissionLanguage | null;
  problemOrder?: "course" | "custom";
  dueAt: string;
  completion?: AssignmentCompletion | null;
  problems: { problemId: string; points: number; title?: string; versionId?: string; position?: number; firstAcPoints?: number; rewardPoints?: number; difficulty?: string | null }[];
  participants: string[];
  participantDetails?: { identityId: string; name: string; exempt: boolean; hasActivity?: boolean }[];
  grades?: {
    identityId: string;
    name: string;
    score: number | null;
    pending?: boolean;
    maxScore: number;
    problems: {
      problemId: string;
      submissionId: string | null;
      completionSource?: "other_entry" | null;
      creditedAt?: string | null;
      hasAssignmentSubmission?: boolean;
      assignmentAttempts?: number;
      score: number | null;
      status: string;
    }[];
  }[];
}
export interface Submission {
  id: string;
  problemId: string;
  problemTitle: string;
  versionId?: string;
  studentName?: string;
  kind: "submit" | "samples" | "custom" | "correction";
  status: string;
  score: number | null;
  passed: number | null;
  total: number | null;
  createdAt: string;
  code: string;
  language?: SubmissionLanguage;
  requiredLanguage?: SubmissionLanguage | null;
  publicOutput?: string | null;
  message?: string | null;
  assignmentId?: string | null;
  originalSubmissionId?: string | null;
  timedPracticeId?: string | null;
  resultsVisible?: boolean;
}
export type SubmissionLanguage = "python" | "cpp" | "javascript";
export interface ReviewEntry {
  id: string;
  originalStatus?: string;
  teacherFeedback?: boolean;
  submissionId: string;
  problemId: string;
  problemTitle?: string;
  note: string;
  createdAt?: string;
  originalSubmissionId?: string;
  versionId?: string;
  authorName?: string;
}
export interface AuthResponse {
  user: CampusUser;
  csrfToken: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const productionSessionExpiredEvent = "codemaster:session-expired";

let csrfToken = "";
export function clearProductionSession() {
  csrfToken = "";
}

/** Same-origin session cookies; credentials and activation codes never enter browser storage. */
export async function productionApi<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const route = path.replace(/^\//, "");
  const method = options.method ?? "GET";
  const requestToken = csrfToken;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && requestToken) headers["X-CSRF-Token"] = requestToken;
  const response = await fetch(`/api/v1/${route}`, {
    method,
    headers,
    credentials: "same-origin",
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const payload = await response.json().catch(() => null);
  const currentSession = requestToken === csrfToken && !options.signal?.aborted;
  if (!response.ok) {
    const code = payload?.error?.code;
    if (typeof window !== "undefined" && currentSession && response.status === 401
      && code === "UNAUTHENTICATED" && route !== "auth/logout") {
      window.dispatchEvent(new Event(productionSessionExpiredEvent));
    }
    // A missing school resource may mean that the membership was revoked.
    // Confirm with the school list before switching workspaces.
    if (typeof window !== "undefined" && (code === "LEGACY_WORKSPACE_REQUIRED"
      || response.status === 404 && /^\/?schools\/[^/]+\//.test(path))) {
      window.dispatchEvent(new Event("codemaster:school-access-check"));
    }
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ??
        (response.status === 401 ? "登录已失效，请重新登录。" : "请求失败，请稍后重试。"),
    );
  }
  if (currentSession && payload?.csrfToken) csrfToken = payload.csrfToken;
  return payload as T;
}

export function apiMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "操作失败，请稍后重试。";
  // Present the current name without changing API codes or historical ledger data.
  const scholarshipMessages: Record<string, string> = {
    "Luq 余额不足": "奖学金余额不足",
    "只能全额退还原 Luq 消费": "只能全额退还原奖学金消费",
    "Luq 余额超过上限": "奖学金余额超过上限",
    "Luq 账户必须关联学生身份": "奖学金账户必须关联学生身份",
  };
  return scholarshipMessages[message] ?? message.replace(
    /^(额外 Luq|初始 Luq|首次 AC Luq|Luq 数量)(须为 .+ 的整数)$/,
    (_, label: string, detail: string) => `${label.replace("Luq", "奖学金")}${detail}`,
  );
}
export function isPending(status: string) {
  return ["waiting", "queued", "judging", "running", "pending"].includes(status.toLowerCase());
}
export function roleHome(user: CampusUser) {
  return !user.roles.length
    ? user.platformAdmin ? "/platform" : "/practice"
    : user.roles.includes("admin")
    ? "/admin"
    : user.roles.includes("teacher")
      ? "/teacher"
      : "/";
}
export function productionId() {
  return crypto.randomUUID();
}
