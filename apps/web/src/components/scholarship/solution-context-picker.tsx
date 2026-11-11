"use client";

import { useId } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { input } from "@/components/teacher/shared";
import { hasStudentUse, solutionContextName, solutionSaveDate, solutionStatusName, solutionUseLabels, type SolutionVersion } from "./solution-context";

export function SolutionContextPicker({ versions, value, onChange, disabled, selectionRequired }: {
  versions: SolutionVersion[];
  value?: string;
  onChange: (versionId: string) => void;
  disabled: boolean;
  selectionRequired?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const id = useId();
  const active = versions.filter(hasStudentUse);
  const selected = versions.find(version => version.versionId === value);
  const latest = versions.find(version => version.latest);
  const labels = selected ? solutionUseLabels(selected, locale) : [];

  return <div className="min-w-0 space-y-3">
    {(active.length > 1 || !selected || !hasStudentUse(selected)) && active.length > 0 && <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-semibold">{tx("编辑哪一处学生题解", "Choose where students use the solution")}</legend>
      {selectionRequired && !selected && <p className="text-sm text-muted-foreground">{tx("这些课程或活动使用的题目内容不同，请按名称选择要更新的题解。", "These courses or activities use different problem content. Choose which one to update.")}</p>}
      <div className="divide-y divide-border rounded-md border border-border">
        {active.map(version => <label key={version.versionId} className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5 text-sm has-checked:bg-primary/5">
          <input type="radio" name={id} value={version.versionId} checked={value === version.versionId} disabled={disabled}
            onChange={() => onChange(version.versionId)} className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" />
          <span className="min-w-0 space-y-1 [overflow-wrap:anywhere]">
            <span className="block font-semibold">{solutionContextName(version, locale)}</span>
            {solutionUseLabels(version, locale).slice(1).map((label, index) => <span key={index} className="block text-xs text-muted-foreground">{label}</span>)}
            <span className="block text-xs text-muted-foreground">{solutionStatusName(version, locale)}</span>
          </span>
        </label>)}
      </div>
    </fieldset>}

    {selected && <div className="space-y-1.5 rounded-md border border-border bg-surface-subtle px-3 py-3" aria-label={tx("当前编辑范围", "Current editing scope")}>
      <p className="text-sm font-semibold">{tx("正在编辑：", "Editing: ")}{solutionContextName(selected, locale)}</p>
      {labels.length > 0 ? <>
        <p className="text-xs text-muted-foreground">{tx("审核发布后，以下入口按各自开放规则提供更新后的题解：", "After review and publication, these entries provide the updated solution under their access rules:")}</p>
        <ul className="space-y-0.5 text-sm [overflow-wrap:anywhere]">{labels.map((label, index) => <li key={index}>{label}</li>)}</ul>
      </> : <p className="text-sm text-muted-foreground">{selected.latest
        ? tx("此处用于为本次题目修改准备题解。请在题目发布和布置时确认使用范围。", "Prepare solutions for this problem edit here. Confirm the intended audience when you publish or assign the problem.")
        : tx("这是一次历史保存记录，当前教学入口未将它列为使用中的题目。日常修改请从上方选择课程或活动。", "This historical save is not listed among current teaching uses. Choose a course or activity above for routine updates.")}</p>}
    </div>}

    {latest && latest.versionId !== value && !hasStudentUse(latest) && <Button type="button" variant="secondary" size="sm" className="h-auto min-h-8 whitespace-normal text-left" disabled={disabled} onClick={() => onChange(latest.versionId)}>
      {tx("为本次题目修改准备题解", "Prepare solutions for the latest problem edit")}
    </Button>}
    <details className="rounded-md border border-border px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary">{tx(`历史保存记录（${versions.length}）`, `Save history (${versions.length})`)}</summary>
      <div className="space-y-2 pt-3">
        <p className="text-xs text-muted-foreground">{tx("保存题目会留下快照，用于追溯旧内容；保存次数与解法数量无关。", "Saving a problem keeps a snapshot for tracing earlier content. The number of saves is separate from the number of solution approaches.")}</p>
        <label htmlFor={`${id}-history`} className="block text-xs font-semibold">{tx("查看某次保存", "Open a saved snapshot")}</label>
        <select id={`${id}-history`} className={input} value={value ?? ""} disabled={disabled} onChange={event => { if (event.target.value) onChange(event.target.value); }}>
          {!value && <option value="">{tx("请选择保存记录", "Choose a saved snapshot")}</option>}
          {versions.map(version => <option key={version.versionId} value={version.versionId}>
            {solutionSaveDate(version, locale)} · {solutionContextName(version, locale)} · {solutionStatusName(version, locale)}
          </option>)}
        </select>
        {selected && <p className="text-xs text-muted-foreground">{tx("记录标识：", "Record ID: ")}<code className="[overflow-wrap:anywhere]">{selected.versionId}</code></p>}
      </div>
    </details>
  </div>;
}
