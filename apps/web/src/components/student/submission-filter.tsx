"use client";

import { useLocale } from "@/components/locale-context";

const verdicts = ["Waiting", "Judging", "AC", "WA", "CE", "RE", "TLE", "MLE", "OLE", "System Error"];
const contexts = ["assignment", "timed", "correction", "practice"];

export function StudentSubmissionFilter({ verdict, context, onVerdict, onContext }: {
  verdict: string;
  context: string;
  onVerdict: (value: string) => void;
  onContext: (value: string) => void;
}) {
  const { locale } = useLocale();
  const label = (zh: string, en: string) => locale === "en" ? en : zh;
  const verdictLabel = (value: string) => ({
    Waiting: label("等待中", "Waiting"),
    Judging: label("评测中", "Judging"),
    "System Error": label("系统错误", "System Error"),
  } as Record<string, string>)[value] ?? value;
  const contextLabel = (value: string) => ({
    assignment: label("作业", "Assignment"),
    timed: label("限时训练", "Timed practice"),
    correction: label("订正", "Correction"),
    practice: label("题库练习", "Practice library"),
  } as Record<string, string>)[value] ?? value;
  const selectClass = "mt-1 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  return <div className="flex w-full flex-wrap gap-3" data-od-id="student-submission-filter">
    <label className="min-w-0 flex-1 text-sm font-medium sm:max-w-56 sm:flex-none sm:w-56">
      {label("判题结果", "Verdict")}
      <select value={verdict} onChange={event => onVerdict(event.target.value)} className={selectClass}>
        <option value="">{label("全部结果", "All verdicts")}</option>
        {verdicts.map(value => <option key={value} value={value}>{verdictLabel(value)}</option>)}
      </select>
    </label>
    <label className="min-w-0 flex-1 text-sm font-medium sm:max-w-56 sm:flex-none sm:w-56">
      {label("来源", "Context")}
      <select value={context} onChange={event => onContext(event.target.value)} className={selectClass}>
        <option value="">{label("全部来源", "All contexts")}</option>
        {contexts.map(value => <option key={value} value={value}>{contextLabel(value)}</option>)}
      </select>
    </label>
  </div>;
}
