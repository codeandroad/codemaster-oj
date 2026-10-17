"use client";

import { Clock3, FileEdit, Globe2, LockKeyhole, Archive, CircleX } from "lucide-react";
import { useLocale, type AppLocale } from "@/components/locale-context";

export interface ProblemPublication {
  published?: boolean;
  publishedAt?: string | null;
  publishedVersionId?: string | null;
  schoolVisibleAt?: string | null;
  rankReviewStatus?: string | null;
  bankVisibility?: "school" | "private";
  archivedAt?: string | null;
}
export function problemPublicationState(problem: ProblemPublication, bankVisibility?: "school" | "private") {
  if (problem.archivedAt) return "archived";
  if (!(problem.published ?? Boolean(problem.publishedAt))) return "draft";
  if ((problem.bankVisibility ?? bankVisibility) === "private") return "teaching";
  if (problem.schoolVisibleAt) return "public";
  if (problem.rankReviewStatus === "revoked") return "withdrawn";
  if (problem.rankReviewStatus === "rejected") return "rejected";
  return "pending";
}
const states = {
  draft: { zh: "草稿", en: "Draft", icon: FileEdit, color: "border-border bg-muted text-muted-foreground" },
  teaching: { zh: "教学可用", en: "Teaching ready", icon: LockKeyhole, color: "border-border bg-surface-subtle text-muted-foreground" },
  pending: { zh: "待公开审核", en: "Awaiting public review", icon: Clock3, color: "border-warning/25 bg-warning-soft text-warning" },
  public: { zh: "已公开", en: "Public", icon: Globe2, color: "border-success/25 bg-success-soft text-success" },
  rejected: { zh: "审核未通过", en: "Review rejected", icon: CircleX, color: "border-warning/25 bg-warning-soft text-warning" },
  withdrawn: { zh: "已撤下", en: "Withdrawn", icon: Archive, color: "border-border bg-muted text-muted-foreground" },
  archived: { zh: "已归档", en: "Archived", icon: Archive, color: "border-border bg-muted text-muted-foreground" },
};
export function problemPublicationLabel(problem: ProblemPublication, bankVisibility: "school" | "private" | undefined, locale: AppLocale) {
  const state = states[problemPublicationState(problem, bankVisibility)];
  return locale === "en" ? state.en : state.zh;
}
export function ProblemPublicationStatus({ problem, bankVisibility }: { problem: ProblemPublication; bankVisibility?: "school" | "private" }) {
  const { locale } = useLocale();
  const state = states[problemPublicationState(problem, bankVisibility)], Icon = state.icon;
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${state.color}`}><Icon size={12} aria-hidden="true"/>{locale === "en" ? state.en : state.zh}</span>;
}

export function PublicationGuide() {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const rows = [
    [tx("草稿", "Draft"), tx("仅维护教师可编辑，学生不可见。", "Editable by its managing teacher; hidden from students.")],
    [tx("教学可用", "Teaching ready"), tx("题目版本已固定，可用于指定学生的任务，尚未全校公开。", "A fixed problem version usable in assigned work, without school-wide access.")],
    [tx("待公开审核", "Awaiting public review"), tx("普通 OJ 题目正等待管理员审核，指定任务仍可使用。", "An ordinary OJ problem awaiting admin approval; assigned work may use it.")],
    [tx("已公开", "Public"), tx("全校学生可自由使用，不要求加入班级。普通题目须经管理员审核；Paper 4 试卷须通过参考答案验证。", "Available school-wide without class membership. Ordinary problems require admin approval; Paper 4 papers require reference validation.")],
    [tx("已布置", "Assigned"), tx("作业、训练或考试仅对所选学生可见；班级用于组织名单和资源，课程用于组织学习内容。", "Assignments, timed work and exams are visible only to their selected students. Classes organize people and resources; courses organize lessons.")],
  ];
  return <details className="mt-4 rounded-md border border-border bg-surface text-sm"><summary className="min-h-10 cursor-pointer px-4 py-2.5 font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary">{tx("状态与权限说明", "Status and access guide")}</summary><dl className="grid gap-x-4 gap-y-2 border-t border-border px-4 py-3 sm:grid-cols-[160px_minmax(0,1fr)]">{rows.map(([label, text]) => <div key={label} className="contents"><dt className="font-semibold">{label}</dt><dd className="mb-2 text-sm leading-6 text-muted-foreground">{text}</dd></div>)}</dl></details>;
}
