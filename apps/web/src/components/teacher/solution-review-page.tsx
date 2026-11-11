"use client";

import { useSearchParams } from "next/navigation";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { buttonVariants } from "@/components/ui/button";
import { ScholarshipBatchReview } from "@/components/scholarship/batch-review";

export function SolutionReviewPage({ admin = false }: { admin?: boolean }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const targetType = useSearchParams().get("targetType") === "paper4" ? "paper4" : "problem";
  const base = `/${admin ? "admin" : "teacher"}/problems/solutions-review`;
  return <div className="space-y-4">
    <PageHeader title={tx("题解审核", "Solution review")}
      description={tx("核对已保存的题解草稿并批量发布；需要修改正文时，直接进入对应题目编辑页。", "Review saved solution drafts and publish them together. Open the problem editor to change the content.")}
      action={<AppLink href={admin ? "/admin/problem-banks" : "/teacher/problems"} className={buttonVariants({ variant: "secondary" })}>{tx("返回题库", "Back to problem banks")}</AppLink>} />
    <nav className="flex flex-wrap gap-2" aria-label={tx("题解类型", "Solution category")}>
      <AppLink href={base} aria-current={targetType === "problem" ? "page" : undefined} className={buttonVariants({ size: "sm", variant: targetType === "problem" ? "default" : "secondary" })}>{tx("普通题目", "Coding problems")}</AppLink>
      <AppLink href={`${base}?targetType=paper4`} aria-current={targetType === "paper4" ? "page" : undefined} className={buttonVariants({ size: "sm", variant: targetType === "paper4" ? "default" : "secondary" })}>Paper 4</AppLink>
    </nav>
    <ScholarshipBatchReview key={targetType} targetType={targetType} admin={admin} />
  </div>;
}
