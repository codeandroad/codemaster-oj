"use client";

import { useLocale } from "@/components/locale-context";
import type { SolutionVersion } from "./solution-context";

export function SolutionUsageSummary({ versions }: { versions: SolutionVersion[] }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const uses = new Map<string, string>();
  for (const { usage } of versions) {
    if (!usage) continue;
    for (const [kind, label, items, count] of [
      ["course", tx("课程", "Course"), usage.courses, usage.courseCount],
      ["assignment", tx("作业", "Assignment"), usage.assignments ?? [], usage.assignmentCount],
      ["timed", tx("限时练习", "Timed practice"), usage.timedPractices ?? [], usage.timedCount],
    ] as const) {
      for (const item of items) uses.set(`${kind}:${item.id}`, `${label} · ${item.title}`);
      if (count > items.length) uses.set(`${kind}:other`, tx(`其他${label}`, `Other ${label.toLowerCase()} entries`));
    }
    if (usage.schoolPractice) uses.set("practice", tx("校内题库练习", "School problem practice"));
  }
  return <div className="space-y-2 rounded-md border border-border bg-surface-subtle p-3" aria-label={tx("题解使用范围", "Where these solutions are used")}>
    <p className="text-sm font-semibold">{tx("一套题解，各处共用", "One solution set for every use")}</p>
    <p className="text-xs text-muted-foreground">{tx("课程、作业、限时练习和题库练习共用本题的题解。审核发布后，各入口同步更新，并遵循各自的价格和开放规则。", "Courses, assignments, timed practice and library practice share these solutions. Reviewed updates appear everywhere under each entry’s pricing and access rules.")}</p>
    {uses.size > 0 && <ul className="space-y-1 text-sm [overflow-wrap:anywhere]">{[...uses].map(([id, label]) => <li key={id}>{label}</li>)}</ul>}
  </div>;
}
