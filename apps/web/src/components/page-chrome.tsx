"use client";

import type { ReactNode } from "react";
import {useLocale} from "@/components/locale-context";
import {usePageHeading} from "@/components/page-heading-context";

export function PageHeader({ title, action, className }: {
  eyebrow?: string;
  title: string;
  description?: string | null;
  action?: ReactNode;
  className?: string;
}) {
  const {t}=useLocale();
  usePageHeading(t(title));
  if (!action) return null;
  return (
    <div className={`production-page-actions flex min-w-0 flex-wrap items-center justify-end gap-2 ${className ?? ""}`}>
      {action}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const {t}=useLocale();
  const positive = /^(AC|Solved)(?:\b|\s|·)/.test(status) || ["已发布", "可用", "完成", "Available", "Active", "Completed", "Published", "已公开", "Public", "已布置", "Assigned"].includes(status);
  const warning = /^(WA|TLE|MLE|RE|CE|Attempted)(?:\b|\s|·)/.test(status) || ["等待验证", "Unavailable", "Failed", "Disabled", "Waiting", "System Error"].includes(status);
  const colors = positive
    ? "border-success/25 bg-success-soft text-success"
    : warning
      ? "border-warning/25 bg-warning-soft text-warning"
      : "border-border bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${colors}`}><span aria-hidden>●</span>{t(status)}</span>;
}
