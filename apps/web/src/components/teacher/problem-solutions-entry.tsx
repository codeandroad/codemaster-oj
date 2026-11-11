"use client";

import { useId } from "react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { buttonVariants } from "@/components/ui/button";
import { hasStudentUse, type SolutionUse, type SolutionVersion } from "@/components/scholarship/solution-context";
import { State, useData } from "./shared";

type SolutionDestinations = {
  recommendedVersionId: string | null;
  selectionRequired: boolean;
  versions: SolutionVersion[];
};

export function ProblemSolutionsEntry({ problemId, versionId, hasUnsavedProblemChanges }: {
  problemId: string;
  versionId: string;
  hasUnsavedProblemChanges: boolean;
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const id = useId();
  const resource = useData<SolutionDestinations>(
    `scholarship/contents?${new URLSearchParams({ problemId, versionId })}`,
  );
  const destinations = resource.data;
  const used = destinations?.versions.some(hasStudentUse);
  const recommended = destinations?.versions.find(version => version.versionId === destinations.recommendedVersionId);
  const uses: string[] = [];
  if (recommended?.usage) {
    const { usage } = recommended;
    const describe = (count: number, items: SolutionUse[], zh: string, en: string) => {
      if (!count) return;
      const titles = items.slice(0, 2).map(item => item.title).join(locale === "zh" ? "、" : ", ");
      uses.push(`${tr(zh, en)}${titles ? `${locale === "zh" ? "：" : ": "}${titles}` : ""}${count > items.slice(0, 2).length ? tr(`（共 ${count} 项）`, ` (${count} total)`) : ""}`);
    };
    describe(usage.courseCount, usage.courses, "课程", "Courses");
    describe(usage.assignmentCount, usage.assignments ?? [], "作业", "Assignments");
    describe(usage.timedCount, usage.timedPractices ?? [], "限时训练", "Timed practices");
    if (usage.schoolPractice) uses.push(tr("校内题库练习", "School problem-bank practice"));
  }
  const query = { targetType: "problem", targetId: problemId, kind: "FULL_SOLUTION" };
  const href = `/teacher/scholarship?${new URLSearchParams(query)}`;
  const prepareHref = `/teacher/scholarship?${new URLSearchParams({ ...query, versionId })}`;
  const canPrepareSeparately = destinations && destinations.recommendedVersionId !== versionId;

  return <section className="space-y-3 rounded-md border border-border bg-surface-subtle p-4" aria-labelledby={`${id}-title`}>
    <div className="space-y-1">
      <h2 id={`${id}-title`} className="font-semibold">{tr("学生题解", "Student solutions")}</h2>
      <p className="text-sm text-muted-foreground">{tr(
        "在这里编辑学生看到的完整题解、参考代码和多种解法。修改先保存为草稿，审核发布后生效。",
        "Edit the explanations, reference code and approaches students read. Changes take effect after saving a draft and reviewing it for publication.",
      )}</p>
    </div>
    <State resource={resource} />
    {destinations && !resource.loading && !resource.error && <div className="space-y-1 text-sm text-muted-foreground">
      {destinations.selectionRequired ? <p>{tr(
        "不同课程或活动正在使用不同的题目内容。进入后按课程或活动选择要编辑的学生题解。",
        "Courses or activities use different problem content. Open student solutions, then choose the course or activity you want to update.",
      )}</p> : uses.length ? <p className="[overflow-wrap:anywhere]">{tr("将打开学生正在使用的题解：", "Opens the student-facing solutions used by: ")}{uses.join(" · ")}</p>
        : <p>{tr("此题暂未用于学生学习，可先准备并审核学生题解。", "This problem is not currently used for student learning. You can prepare and review its solutions first.")}</p>}
    </div>}
    <div className="flex flex-wrap gap-2">
      <AppLink href={href} className={buttonVariants({ size: "sm", variant: "default", className: "h-auto min-h-9 whitespace-normal text-left" })}>
        {used ? tr("编辑学生正在看的题解", "Edit student-facing solutions") : tr("管理学生题解", "Manage student solutions")}
      </AppLink>
      {canPrepareSeparately && <AppLink href={prepareHref} className={buttonVariants({ size: "sm", variant: "secondary", className: "h-auto min-h-9 whitespace-normal text-left" })}>
        {tr("为本次题目修改准备题解", "Prepare solutions for this problem edit")}
      </AppLink>}
    </div>
    {hasUnsavedProblemChanges && <p className="text-xs text-muted-foreground">{tr(
      "本页有未保存的修改。如需使用修改后的参考代码或题解素材，请先保存题目草稿，再为本次修改准备学生题解。",
      "This page has unsaved changes. To use the updated reference code or solution notes, save the problem draft first, then prepare solutions for this edit.",
    )}</p>}
  </section>;
}
