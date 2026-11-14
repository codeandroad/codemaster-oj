"use client";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { input } from "@/components/teacher/shared";
import { ProblemCatalogSearch } from "@/components/student/problem-catalog-search";
import type { PlatformProblemBank, PlatformProblemFilters, PlatformProblemRow } from "./platform-problem-model";

export function PlatformProblemFiltersBar({ value, onChange, banks, rows, delegated }: {
  value: PlatformProblemFilters; onChange: (patch: Partial<PlatformProblemFilters>) => void; banks: PlatformProblemBank[]; rows: PlatformProblemRow[];
  delegated?: boolean;
}) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const schools = new Map(rows.flatMap(row => !row.source && row.publication ? [[row.publication.schoolId, row.publication.schoolName ?? ""] as const] : []));
  const courses = new Map(rows.flatMap(row => (row.source?.courses ?? []).map(course => [course.id, course.title] as const)));
  const fields = [
    { key: "source" as const, label: tx("来源", "Source"), all: tx("全部来源", "All sources"), options: [["platform", "CodeMaster"], ...schools] },
    { key: "bank" as const, label: tx("平台分类", "Platform category"), all: tx("全部分类", "All categories"), options: [["unclassified", tx("未分类", "Unclassified")], ...banks.map(bank => [bank.id, `${bank.name}${bank.archivedAt ? tx("（已归档）", " (archived)") : ""}`])] },
    { key: "visibility" as const, label: tx("全平台公开状态", "Platform-wide access"), all: tx("全部公开状态", "All access states"), options: [["public", tx("全平台公开", "Platform-wide")], ["pending", tx("待审核", "Pending review")], ["rejected", tx("已驳回", "Rejected")], ["private", tx("未向全平台公开", "Not platform-wide")]] },
    { key: "validation" as const, label: tx("验证状态", "Validation"), all: tx("全部验证状态", "All validation states"), options: [["passed", tx("已通过", "Passed")], ["running", tx("验证中", "Validating")], ["incomplete", tx("待完善", "Incomplete")], ["failed", tx("未通过", "Failed")]] },
    ...(courses.size ? [{ key: "course" as const, label: tx("关联课程", "Linked course"), all: tx("全部课程", "All courses"), options: [...courses] }] : []),
  ];
  return <search aria-label={tx("筛选平台题库", "Filter platform problems")} className="space-y-3 rounded-lg border border-border bg-surface p-3">
    <ProblemCatalogSearch value={value.query} onChange={query => onChange({ query })} label={tx("搜索题号、标题、标签或分类", "Search ID, title, tags, or category")} />
    <div className="flex flex-wrap items-end gap-3">{fields.filter(field => !delegated || field.key === "validation" || field.key === "course").map(field => <label key={field.key} className="grid min-w-0 flex-1 basis-40 gap-1 text-xs font-medium text-muted-foreground">{field.label}<select aria-label={field.label} name={field.key} className={input} value={value[field.key]} onChange={event => onChange({ [field.key]: event.target.value })}><option value="">{field.all}</option>{field.options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>)}
      <Button type="button" variant="ghost" size="sm" disabled={!value.query && !value.source && !value.bank && !value.visibility && !value.validation && !value.course} onClick={() => onChange({ query: "", source: "", bank: "", visibility: "", validation: "", course: "" })}>{tx("清除筛选", "Clear filters")}</Button>
    </div>
  </search>;
}
