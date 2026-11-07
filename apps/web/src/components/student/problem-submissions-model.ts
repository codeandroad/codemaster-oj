export type SubmissionSort = "createdAt" | "language" | "runtimeMs" | "memoryKb" | "status";
export type SubmissionOrder = "asc" | "desc";
export type SubmissionPageQuery = { page: number; pageSize: number; sort: SubmissionSort; order: SubmissionOrder };
export type ProblemSubmissionMetadata = {
  id: string;
  displayName: string;
  createdAt: string;
  language: string;
  status: string;
  runtimeMs: number | null;
  memoryKb: number | null;
  isOwn: boolean;
};
export type ProblemSubmissionPage = {
  items: ProblemSubmissionMetadata[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  solved: boolean;
};

export function problemSubmissionsUrl(endpoint: string, query: SubmissionPageQuery) {
  if (!endpoint) return "";
  const index = endpoint.indexOf("?");
  const path = index < 0 ? endpoint : endpoint.slice(0, index);
  const params = new URLSearchParams(index < 0 ? "" : endpoint.slice(index + 1));
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  params.set("sort", query.sort);
  params.set("order", query.order);
  return `${path}?${params}`;
}

export function submissionMeasurement(value: number | null | undefined, unit: "ms" | "KiB", locale: string) {
  return value == null || !Number.isFinite(value) || value < 0 ? "—" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} ${unit}`;
}

export function submissionOwnDetailHref(row: ProblemSubmissionMetadata, allowLegacyDetails: boolean) {
  return allowLegacyDetails && row.isOwn ? `/student/submissions/${encodeURIComponent(row.id)}` : null;
}
