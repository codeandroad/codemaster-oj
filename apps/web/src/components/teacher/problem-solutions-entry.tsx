"use client";

import { useId, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { buttonVariants } from "@/components/ui/button";
import { input, State, useData } from "./shared";

export type ProblemSolutionVersion = {
  versionId: string;
  title: string;
  createdAt: string;
  current: boolean;
  solutionStatus?: "missing" | "draft" | "published" | "withdrawn";
  hasPendingSolutions?: boolean;
  courseCount?: number;
};

export function solutionVersionLabel(version: ProblemSolutionVersion, locale: string, viewingVersionId?: string) {
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const date = new Date(version.createdAt);
  const parts = [Number.isNaN(date.getTime()) ? version.versionId.slice(0, 8) : date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  })];
  if (!Number.isNaN(date.getTime())) parts.push(version.versionId.slice(0, 8));
  if (viewingVersionId === version.versionId) parts.push(tr("正在编辑的题目版本", "Version in this editor"));
  if (version.current) parts.push(tr("当前教学版本", "Current teaching version"));
  if (version.courseCount) parts.push(tr(`${version.courseCount} 个课程引用`, `Used in ${version.courseCount} course${version.courseCount === 1 ? "" : "s"}`));
  parts.push(version.hasPendingSolutions ? tr("题解更新待审核", "Solution updates awaiting review")
    : version.solutionStatus === "published" ? tr("题解已发布", "Solutions published")
    : version.solutionStatus === "draft" ? tr("题解草稿", "Solution draft")
    : version.solutionStatus === "withdrawn" ? tr("题解已撤回", "Solutions withdrawn")
    : tr("尚无学生题解", "No student solutions"));
  return parts.join(" · ");
}

export function ProblemSolutionsEntry({ problemId, versionId, hasUnsavedProblemChanges }: {
  problemId: string;
  versionId: string;
  hasUnsavedProblemChanges: boolean;
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const selectorId = useId();
  const [selectedVersionId, setSelectedVersionId] = useState(versionId);
  const resource = useData<{ versions?: ProblemSolutionVersion[] }>(
    `scholarship/contents?${new URLSearchParams({ problemId, versionId })}`,
  );
  const versions = resource.data?.versions;
  const selected = versions?.find(version => version.versionId === selectedVersionId);
  const href = `/teacher/scholarship?${new URLSearchParams({
    targetType: "problem", targetId: problemId, versionId: selectedVersionId, kind: "FULL_SOLUTION",
  })}`;

  return <section className="space-y-3 rounded-md border border-border bg-surface-subtle p-4" aria-labelledby={`${selectorId}-title`}>
    <div className="space-y-1">
      <h2 id={`${selectorId}-title`} className="font-semibold">{tr("学生题解", "Student solutions")}</h2>
      <p className="text-sm text-muted-foreground">{tr(
        "学生 Solution 页签中的完整正文、参考代码和多种解法在这里管理。修订先保存为草稿，审核发布后才向学生展示。",
        "Manage the explanations, reference code and approaches shown in the student Solution tab. Revisions are saved as drafts and reach students after review and publication.",
      )}</p>
    </div>
    <State resource={resource} />
    {versions && versions.length > 0 && <div className="max-w-3xl space-y-1.5">
      <label htmlFor={selectorId} className="text-sm font-semibold">{tr("题解对应的题目版本", "Problem version for solutions")}</label>
      <select id={selectorId} className={input} value={selectedVersionId} onChange={event => setSelectedVersionId(event.target.value)}>
        {versions.map(version => <option key={version.versionId} value={version.versionId}>{solutionVersionLabel(version, locale, versionId)}</option>)}
      </select>
      {versions.length > 1 && <p className="text-xs text-muted-foreground">{tr(
        "课程和作业可能仍使用旧版本。查找学生已看到的题解时，请选择对应版本。",
        "Courses and assignments may still use an earlier version. Select that version to find the solution students are reading.",
      )}</p>}
    </div>}
    {!versions && !resource.loading && !resource.error && <p className="text-xs text-muted-foreground">{tr("题目版本", "Problem version")} · <code>{versionId.slice(0, 8)}</code></p>}
    <AppLink href={href} className={buttonVariants({ size: "sm", variant: "secondary" })}>
      {selected && selected.solutionStatus !== "missing" ? tr("编辑学生题解", "Edit student solutions") : tr("管理学生题解", "Manage student solutions")}
    </AppLink>
    {hasUnsavedProblemChanges && <p className="text-xs text-muted-foreground">{tr(
      "本页有未保存的修改。如需使用修改后的参考代码或题解素材，请先保存题目草稿，再管理新版本的学生题解。",
      "This page has unsaved changes. To use the updated reference code or solution notes, save the problem draft first, then manage solutions for the new version.",
    )}</p>}
  </section>;
}
