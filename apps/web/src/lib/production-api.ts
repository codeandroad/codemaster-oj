export type CampusRole = "student" | "teacher" | "admin";
export interface CampusUser {
  id: string;
  nickname?:string;bio?:string;avatar?:string;
  identityId: string;
  name: string;
  username: string;
  roles: CampusRole[];
  number: string;
  email?: string | null;
}
export interface Person {
  id: string;
  kind: "student" | "teacher";
  number: string;
  name: string;
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
  title: string;
  mode: "stdio" | "function";
  statement: string;
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
  published: boolean;
  validationStatus?: string;
  validationMessage?: string;
  canPublish?: boolean;
  publishedVersionId?: string | null;
  publishedTitle?: string | null;
  bankId?: string | null;
  tags?: string[];
  difficulty?: string;
  source?: string;
  canEdit?: boolean;
  firstAcPoints?: number;
  bankVisibility?: "school" | "private";
  schoolVisibleAt?: string | null;
  rankReviewStatus?: "pending" | "approved" | "rejected" | "revoked" | null;
  rankApprovedAt?: string | null;
}
export interface Assignment {
  id: string;
  title: string;
  classId: string;
  dueAt: string;
  problems: { problemId: string; points: number; title?: string; versionId?: string; firstAcPoints?: number; rewardPoints?: number }[];
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

let csrfToken = "";
export function clearProductionSession() {
  csrfToken = "";
}

/** Same-origin session cookies; credentials and activation codes never enter browser storage. */
export async function productionApi<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(`/api/v1/${path.replace(/^\//, "")}`, {
    method,
    headers,
    credentials: "same-origin",
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ??
        (response.status === 401 ? "登录已失效，请重新登录。" : "请求失败，请稍后重试。"),
    );
  if (payload?.csrfToken) csrfToken = payload.csrfToken;
  return payload as T;
}

export function apiMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
export function isPending(status: string) {
  return ["waiting", "queued", "judging", "running", "pending"].includes(status.toLowerCase());
}
export function roleHome(user: CampusUser) {
  return user.roles.includes("admin")
    ? "/admin"
    : user.roles.includes("teacher")
      ? "/teacher"
      : "/";
}
export function productionId() {
  return crypto.randomUUID();
}
