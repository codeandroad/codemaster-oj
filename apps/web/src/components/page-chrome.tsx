"use client";

import type { ReactNode } from "react";
import {useLocale} from "@/components/locale-context";

export function PageHeader({ eyebrow, title, description, action, className }: {
  eyebrow?: string;
  title: string;
  description?: string | null;
  action?: ReactNode;
  className?: string;
}) {
  const {t}=useLocale();
  return (
    <div className={`production-page-header flex flex-wrap items-end justify-between gap-4 ${className ?? ""}`}>
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(eyebrow)}</p>}
        <h1 className="break-words text-[26px] font-bold leading-tight">{t(title)}</h1>
        {description && <p className="mt-2 max-w-[76ch] text-sm leading-6 text-muted-foreground">{t(description)}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const {t}=useLocale();
  const positive = /^(AC|Solved)(?:\b|\s|·)/.test(status) || ["已发布", "可用", "完成", "Available", "Active", "Completed", "Published"].includes(status);
  const warning = /^(WA|TLE|MLE|RE|CE|Attempted)(?:\b|\s|·)/.test(status) || ["等待验证", "Unavailable", "Failed", "Disabled", "Waiting", "System Error"].includes(status);
  const colors = positive
    ? "border-success/25 bg-success-soft text-success"
    : warning
      ? "border-warning/25 bg-warning-soft text-warning"
      : "border-border bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${colors}`}><span aria-hidden>●</span>{t(status)}</span>;
}
