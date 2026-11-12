"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { Feedback, inputClass, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AppLink } from "@/components/navigation";
import { useCourseLanguage } from "@/components/course-language";
import { courseLanguageHref, localizedCourse } from "@/components/course-localization";
import { productionApi } from "@/lib/production-api";
import { validCourseInvitation, type LearnerAdmissionRule } from "./platform-course-admission-model";
import type { PublicCourseEntry } from "./public-course-catalog";
import { useSchoolText } from "./school-ui";

export function PlatformCourseAdmissionGate({ entry, onUpdated, onClose, returnFocus }: {
  entry: PublicCourseEntry; onUpdated: (entry: PublicCourseEntry) => void; onClose: () => void; returnFocus?: () => void;
}) {
  const text = useSchoolText(), { language } = useCourseLanguage(), action = useMutation(), pending = useRef(false);
  const location = useSearchParams();
  const course = localizedCourse(entry, language), rules = entry.admissionRules ?? [];
  const [selected, setSelected] = useState(""), [code, setCode] = useState("");
  const rule = rules.find(item => item.ruleId === selected) ?? rules.find(item => item.requirementsMet && item.applicationStatus === "none") ?? rules[0];
  const prerequisiteHref = (id: string) => {
    const schoolId = rule?.points.schoolId ?? location.get("schoolId");
    const query = schoolId ? `?${new URLSearchParams({ schoolId })}` : "";
    return courseLanguageHref(`/practice/courses/${encodeURIComponent(id)}${query}`, language);
  };
  const ruleLabel = (value: LearnerAdmissionRule) => value.targetKind === "school" || value.points.source === "school"
    ? value.schoolName ?? value.points.schoolName ?? text("School membership", "学校成员资格")
    : value.targetKind === "independent" ? text("Personal user without a school", "未加入学校的个人用户")
      : value.targetKind === "account" ? text("Selected account", "指定账号") : text("All registered users", "所有注册用户");
  const status = !rule ? text("This account does not match the course audience.", "当前账号不在此课程的开放范围内。")
    : !rule.requirementsMet ? text("Complete the requirements below before joining this course.", "请先满足以下学习门槛，再加入课程。")
      : rule.applicationStatus === "pending" ? text("Platform administrators are reviewing your application.", "平台管理员正在审核你的申请。")
        : rule.applicationStatus === "rejected" ? text("Platform administrators declined this application. Contact a platform administrator to request reconsideration.", "平台管理员未批准这份申请。如需重新审核，请联系平台管理员。")
          : rule.applicationStatus === "revoked" ? text("Access granted by this record was revoked. Contact a platform administrator to restore admission.", "此记录授予的准入已撤销。如需恢复，请联系平台管理员。")
            : rule.admissionMode === "invite" ? text("Enter the 6-character course code provided by a platform administrator.", "请输入平台管理员提供的 6 位课程邀请码。")
              : rule.admissionMode === "application" ? text("Apply to join. Platform administrators review course applications.", "提交加入申请后，由平台管理员审核。")
                : text("Your admission status may have changed. Refresh to continue.", "你的准入状态可能已更新，请刷新后继续。");
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    await action.run(async () => { setCode(""); onUpdated(await productionApi<PublicCourseEntry>(`practice/courses/${encodeURIComponent(entry.id)}/entry`)); });
    pending.current = false;
  }
  async function join() {
    if (!rule || !rule.requirementsMet || pending.current) return;
    if (rule.admissionMode === "invite" && !validCourseInvitation(code)) return;
    pending.current = true;
    await action.run(async () => {
      const result = await productionApi<PublicCourseEntry>(`practice/courses/${encodeURIComponent(entry.id)}/${rule.admissionMode === "invite" ? "invitations/redeem" : "applications"}`, {
        method: "POST", body: { ruleId: rule.ruleId, generation: rule.generation, ...(rule.admissionMode === "invite" ? { code } : {}) },
      });
      setCode(""); onUpdated(result);
    });
    pending.current = false;
  }
  const canJoin = rule?.requirementsMet && !rule.granted && rule.applicationStatus === "none" && rule.admissionMode !== "direct";
  return <Dialog open onOpenChange={open => { if (!open && !action.busy) { setCode(""); onClose(); } }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto" data-od-id="platform-course-admission-gate" onCloseAutoFocus={event => { if (returnFocus) { event.preventDefault(); returnFocus(); } }}>
      <DialogTitle className="pr-7 leading-snug">{course.title}</DialogTitle>
      <DialogDescription>{text("CodeMaster · Platform course admission", "CodeMaster · 平台课程准入")}</DialogDescription>
      {course.description && <p className="line-clamp-3 text-sm text-muted-foreground">{course.description}</p>}
      {rules.length > 1 ? <label className="grid gap-1 text-sm font-medium">{text("Choose an applicable admission rule", "选择适用的准入规则")}<select className={inputClass} disabled={action.busy} value={rule?.ruleId ?? ""} onChange={event => { setSelected(event.target.value); setCode(""); action.clear(); }}>{rules.map(item => <option key={item.ruleId} value={item.ruleId}>{ruleLabel(item)} · {item.admissionMode === "direct" ? text("Direct", "直接学习") : item.admissionMode === "application" ? text("Platform approval", "平台审批") : text("Invitation", "邀请码")}</option>)}</select></label>
        : rule && <p className="text-sm font-medium">{ruleLabel(rule)}</p>}
      {rule && <div className="space-y-3 rounded-md border border-border bg-surface-subtle p-3" data-od-id="course-admission-requirements">
        <h3 className="text-sm font-semibold">{text("Learning requirements", "学习门槛")}</h3>
        {rule.prerequisites.map(item => <div key={item.courseId} className="flex items-start gap-2 text-sm">
          {item.completed ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true"/> : <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true"/>}
          <div className="min-w-0"><p className="break-words">{(item.canOpen ?? item.available) ? <AppLink href={prerequisiteHref(item.courseId)} className="font-medium text-primary hover:underline">{item.title ?? text("Prerequisite course", "前置课程")}</AppLink> : item.title ?? text("Unavailable prerequisite course", "前置课程暂不可用")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.completed ? text("Completed", "已完成") : text("Not completed", "未完成")} · {text(`Reading ${item.readChapters}/${item.totalChapters} · Formal practice ${item.completedExercises}/${item.totalExercises}`, `阅读 ${item.readChapters}/${item.totalChapters} · 正式练习 ${item.completedExercises}/${item.totalExercises}`)}</p>
            {item.requiresAdmission ? <p className="mt-1 text-xs text-muted-foreground">{text("Open this prerequisite course to request admission first.", "请先打开此前置课程，按其准入方式加入。")}</p> : !item.available && <p className="mt-1 text-xs text-warning">{text("This prerequisite is unavailable. Contact a platform administrator.", "此前置课程暂不可用，请联系平台管理员。")}</p>}
          </div>
        </div>)}
        <div className="flex items-start gap-2 text-sm">{rule.points.current >= rule.points.required ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true"/> : <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true"/>}<div className="min-w-0">
          <p>{rule.points.source === "school" ? text(`${rule.points.schoolName ?? rule.schoolName ?? "School"} school points`, `${rule.points.schoolName ?? rule.schoolName ?? "本校"}校内积分`) : text("Public practice points", "公开练习积分")}</p>
          <p className="text-xs text-muted-foreground">{text(`Current ${rule.points.current} · Required ${rule.points.required}`, `当前 ${rule.points.current} · 要求 ${rule.points.required}`)}</p>
        </div></div>
        <p className="text-xs leading-5 text-muted-foreground">{text("Reading and formal practice are both required. Points are checked, not spent; scholarship balances do not count.", "前置课程须完成阅读和正式练习。积分仅校验、不扣除，奖学金余额不计入。")}</p>
      </div>}
      <p className="text-sm" role="status">{status}</p><Feedback action={action}/>
      {canJoin && <form onSubmit={event => { event.preventDefault(); void join(); }} className="space-y-3">
        {rule.admissionMode === "invite" && <label className="grid gap-1 text-sm font-medium">{text("6-character course invitation code", "6 位课程邀请码")}<input type="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} minLength={6} maxLength={6} pattern="[A-HJ-KM-NP-Z2-9]{6}" required disabled={action.busy} className={`${inputClass} font-mono tracking-widest`} value={code} onChange={event => setCode(event.target.value.toUpperCase())} data-od-id="course-invitation-code"/><span className="text-xs font-normal text-muted-foreground">{text("Six letters or digits; this code only applies to the selected admission rule.", "6 位字母或数字，仅适用于当前所选准入规则。")}</span></label>}
        <Button type="submit" disabled={action.busy || (rule.admissionMode === "invite" && !validCourseInvitation(code))}>{action.busy ? text("Submitting…", "正在提交…") : rule.admissionMode === "invite" ? text("Verify and join", "验证并加入") : text("Apply to join", "申请加入")}</Button>
      </form>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={action.busy} onClick={() => void refresh()}><RefreshCw size={14}/>{text("Refresh eligibility", "刷新资格")}</Button><Button variant="ghost" disabled={action.busy} onClick={() => { setCode(""); onClose(); }}>{text("Close", "关闭")}</Button></div>
    </DialogContent>
  </Dialog>;
}
