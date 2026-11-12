"use client";

import { useEffect, useRef, useState } from "react";
import { CopyCode, Feedback, inputClass, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import type { AdmissionRule } from "./platform-course-admission-model";
import type { PlatformCourse } from "./platform-course-model";
import { useSchoolText } from "./school-ui";

export function PlatformCourseRuleEditor({ rule, onChange, courses, pointsSource, disabled }: {
  rule: AdmissionRule; onChange: (rule: AdmissionRule) => void; courses: PlatformCourse[];
  pointsSource: string; disabled?: boolean;
}) {
  const text = useSchoolText(), [query, setQuery] = useState("");
  const options = courses.filter(course => course.published && !course.archived && `${course.title} ${course.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const count = rule.prerequisiteCourseIds.length + (rule.minimumPoints > 0 ? 1 : 0);
  return <fieldset disabled={disabled} className="min-w-0 space-y-3" data-od-id="platform-admission-rule">
    <label className="grid gap-1 text-sm font-medium">{text("Admission", "准入方式")}
      <select className={inputClass} value={rule.admissionMode} onChange={event => onChange({ ...rule, admissionMode: event.target.value as AdmissionRule["admissionMode"] })}>
        <option value="direct">{text("Direct access", "直接学习")}</option>
        <option value="application">{text("Platform approval", "申请后由平台管理员批准")}</option>
        <option value="invite">{text("Six-character invitation code", "6 位邀请码加入")}</option>
      </select>
    </label>
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">{text("Learning requirements", "学习门槛")} · {count ? text(`${count} set`, `${count} 项`) : text("None", "无")}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs leading-5 text-muted-foreground">{text("Complete every prerequisite course: read all chapters and finish all linked formal practice. Checkpoint self-checks do not count as formal practice.", "须完成所有前置课程：读完全部章节并完成全部关联正式练习。章节自测不作为正式练习计入。")}</p>
        {rule.prerequisiteCourseIds.length > 0 && <ul className="space-y-1">{rule.prerequisiteCourseIds.map(id => {
          const course = courses.find(item => item.id === id);
          return <li key={id} className="flex items-start justify-between gap-2 text-sm"><span className="min-w-0 break-words">{course?.title ?? text("Unavailable prerequisite course", "前置课程暂不可用")}{course && (!course.published || course.archived) && <span className="ml-1 text-warning">{text("(unavailable)", "（暂不可用）")}</span>}</span>
            <Button type="button" variant="ghost" size="sm" aria-label={text(`Remove ${course?.title ?? "prerequisite"}`, `移除${course?.title ?? "前置课程"}`)} onClick={() => onChange({ ...rule, prerequisiteCourseIds: rule.prerequisiteCourseIds.filter(value => value !== id) })}>×</Button></li>;
        })}</ul>}
        <label className="grid gap-1 text-sm">{text("Search prerequisite platform courses", "搜索前置平台课程")}<input type="search" value={query} maxLength={100} className={inputClass} onChange={event => setQuery(event.target.value)}/></label>
        <div className="max-h-40 overflow-y-auto rounded border border-border">{options.map(course => <label key={course.id} className="flex min-h-11 cursor-pointer items-start gap-2 border-b border-border p-2 text-sm last:border-0">
          <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={rule.prerequisiteCourseIds.includes(course.id)} onChange={event => onChange({ ...rule, prerequisiteCourseIds: event.target.checked ? [...rule.prerequisiteCourseIds, course.id] : rule.prerequisiteCourseIds.filter(id => id !== course.id) })}/><span className="min-w-0 break-words">{course.title}</span>
        </label>)}{!options.length && <p className="p-3 text-sm text-muted-foreground">{text("No matching published platform courses.", "没有符合条件的已发布平台课程。")}</p>}</div>
        <label className="grid gap-1 text-sm font-medium">{text("Minimum points", "最低积分")}<input type="number" min={0} step={1} className={inputClass} value={rule.minimumPoints} onChange={event => onChange({ ...rule, minimumPoints: event.target.value === "" ? 0 : Number(event.target.value) })}/></label>
        <p className="text-xs leading-5 text-muted-foreground">{pointsSource} · {text("Eligibility check only; no points are spent. This is not your scholarship balance.", "仅校验门槛，不扣除积分；不是奖学金余额。")}</p>
      </div>
    </details>
  </fieldset>;
}

type Invitation = { code?: string; active: boolean; expiresAt: string | null; ruleId: string; generation: string };
export function PlatformCourseInvitation({ courseId, rule, label, disabled }: {
  courseId: string; rule: AdmissionRule; label: string; disabled: boolean;
}) {
  const text = useSchoolText(), action = useMutation(), pending = useRef(false);
  const [days, setDays] = useState(7), [result, setResult] = useState<Invitation | null>(null), [metadata, setMetadata] = useState(rule.invitation);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  useEffect(() => {
    if (!metadata?.active || !metadata.expiresAt || Date.parse(metadata.expiresAt) <= checkedAt) return;
    const timer = window.setTimeout(() => setCheckedAt(Date.now()), Math.min(Math.max(0, Date.parse(metadata.expiresAt) - Date.now()), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [metadata, checkedAt]);
  const canManage = Boolean(courseId && rule.ruleId && rule.generation !== undefined && !disabled);
  const active = metadata?.active && (!metadata.expiresAt || Date.parse(metadata.expiresAt) > checkedAt);
  async function change(operation: "rotate" | "revoke") {
    if (!canManage || pending.current) return;
    if (operation === "revoke" && !window.confirm(text("Revoke this code? Existing course admissions remain. You can revoke individual access in Learning applications.", "撤销此邀请码？已加入者仍保留准入，可在“学习申请”中单独撤销。"))) return;
    if (operation === "rotate" && active && !window.confirm(text("Reset this invitation? The old code will stop accepting new learners. Existing admissions remain.", "重置邀请码？旧码将不能用于新的加入，已加入者的准入保留。"))) return;
    pending.current = true;
    await action.run(async () => {
      const value = await productionApi<Invitation>(`platform/courses/${courseId}/rules/${rule.ruleId}/invitation`, {
        method: "POST", body: { action: operation, generation: rule.generation, ...(operation === "rotate" ? { expiresInDays: days } : {}) },
      });
      setMetadata({ active: value.active, expiresAt: value.expiresAt });
      setCheckedAt(Date.now());
      if (operation === "rotate") setResult(value); else action.success(text("Invitation revoked.", "邀请码已撤销。"));
    });
    pending.current = false;
  }
  return <div className="space-y-2 text-sm" data-od-id="platform-course-invitation">
    <p className="text-xs text-muted-foreground">{label} · {active ? text("Invitation active", "邀请码有效") : metadata?.expiresAt ? text("Invitation expired or revoked", "邀请码已过期或已撤销") : text("No active invitation", "尚无有效邀请码")}
      {active && metadata?.expiresAt && <> · {text("Expires", "有效至")} {new Date(metadata.expiresAt).toLocaleString()}</>}
    </p>
    {!canManage && <p className="text-xs text-muted-foreground">{text("Save the course before managing invitations.", "请先保存课程，再管理邀请码。")}</p>}
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs">{text("Valid for (days)", "有效天数")}<input type="number" min={1} max={30} step={1} className={`${inputClass} w-24`} value={days} disabled={!canManage || action.busy} onChange={event => setDays(Number(event.target.value))}/></label>
      <Button type="button" variant="secondary" size="sm" disabled={!canManage || action.busy || !Number.isInteger(days) || days < 1 || days > 30} onClick={() => void change("rotate")}>{active ? text("Reset code", "重置邀请码") : text("Generate 6-character code", "生成 6 位邀请码")}</Button>
      {active && <Button type="button" variant="ghost" size="sm" disabled={!canManage || action.busy} onClick={() => void change("revoke")}>{text("Revoke", "撤销")}</Button>}
    </div>
    <Feedback action={action}/>
    {result?.code && <Dialog open onOpenChange={open => { if (!open) setResult(null); }}><DialogContent>
      <DialogTitle>{text("Course invitation", "课程邀请码")}</DialogTitle><DialogDescription>{label} · {text("Copy this code now. It is only shown after generation; closing this dialog clears it.", "请现在复制邀请码。明文仅在生成后展示，关闭此窗口即清除。")}</DialogDescription>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border bg-surface-subtle p-4"><code className="select-all font-mono text-2xl font-semibold tracking-[0.2em]">{result.code}</code><CopyCode text={result.code} label={text("Copy code", "复制邀请码")}/></div>
      {result.expiresAt && <p className="text-sm text-muted-foreground">{text("Expires", "有效至")} {new Date(result.expiresAt).toLocaleString()}</p>}
      <Button type="button" onClick={() => setResult(null)}>{text("Done, close", "已记录，关闭")}</Button>
    </DialogContent></Dialog>}
  </div>;
}
