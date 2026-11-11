"use client";

import { useSearchParams } from "next/navigation";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { buttonVariants } from "@/components/ui/button";
import { ProblemAssistanceEditor } from "@/components/teacher/problem-assistance-editor";
import { State, useData } from "@/components/teacher/shared";
import type { ProductionProblem } from "@/lib/production-api";

export function AdminProblemSolutionsPage({ id }: { id: string }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const search = useSearchParams();
  const problem = useData<ProductionProblem>(`problems/${encodeURIComponent(id)}`);
  return <div className="space-y-4">
    <PageHeader eyebrow={tx("题目管理", "Problem management")} title={problem.data?.title ?? tx("学生题解", "Student solutions")}
      description={tx("修改原题解、添加解法，并在此审核发布给学生。", "Edit existing solutions, add approaches, and review them for publication here.")}
      action={<AppLink href="/admin/problem-banks" className={buttonVariants({ variant: "secondary" })}>{tx("返回题库", "Back to problem banks")}</AppLink>} />
    <State resource={problem} />
    {!problem.loading && !problem.error && problem.data?.versionId && problem.data.canEdit !== false && <ProblemAssistanceEditor
      key={`${id}:${search.get("solutionVersionId") ?? "current"}:${search.get("kind") ?? "FULL_SOLUTION"}`} problemId={id} versionId={problem.data.versionId}
      initialVersionId={search.get("solutionVersionId") ?? undefined}
      initialKind={search.get("kind") === "FULL_TRANSLATION" ? "FULL_TRANSLATION" : "FULL_SOLUTION"} />}
    {problem.data?.canEdit === false && <p className="text-sm text-muted-foreground">{tx("此题目前不可编辑。", "This problem is currently read-only.")}</p>}
  </div>;
}
