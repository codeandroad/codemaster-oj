"use client";

import { useRef, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Feedback, inputClass, Loading, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";
import type { PlatformCourse } from "./platform-course-model";

type Application = { id: string; ruleId: string; generation: string; current: boolean; accountId: string; name: string; username: string; status: "pending" | "approved" | "rejected" | "revoked"; origin: "application" | "invite"; createdAt: string };
export function PlatformCourseAdmissions({ courseId, onBack }: { courseId: string; onBack: () => void }) {
  const text = useSchoolText(), [page, setPage] = useState(1), [status, setStatus] = useState("pending"), pending = useRef(false);
  const course = useData<PlatformCourse>(`platform/courses/${encodeURIComponent(courseId)}`);
  const base = `platform/courses/${encodeURIComponent(courseId)}/admissions`;
  const resource = useData<{ items: Application[]; page: number; hasMore: boolean }>(`${base}?${new URLSearchParams({ page: String(page), ...(status ? { status } : {}) })}`), action = useMutation();
  const labels = { pending: text("Awaiting platform review", "待平台审核"), approved: text("Approved", "已准入"), rejected: text("Declined", "已拒绝"), revoked: text("Access revoked", "已撤销准入") };
  async function decide(application: Application, decision: "approve" | "reject" | "revoke") {
    if (pending.current || !application.current) return;
    if (decision === "approve" && application.status !== "pending" && !window.confirm(text("Restore admission for this learner? The course's learning requirements will still apply.", "为此用户恢复准入？课程的学习门槛仍然适用。"))) return;
    if (decision === "revoke" && !window.confirm(text("Revoke access granted by this record? Learning records are retained; other qualifying admission rules still apply.", "撤销此记录授予的准入？学习记录保留，其他满足条件的准入规则仍有效。"))) return;
    pending.current = true;
    await action.run(async () => {
      await productionApi(`${base}/${application.id}/decision`, { method: "POST", body: { action: decision, generation: application.generation, expectedStatus: application.status } });
      action.success(text("Admission record updated.", "准入记录已更新。")); resource.reload();
    });
    pending.current = false;
  }
  return <section className="space-y-4" data-od-id="platform-course-admissions">
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" disabled={action.busy} onClick={onBack}><ArrowLeft size={15}/>{text("Back to courses", "返回课程列表")}</Button><Button variant="secondary" disabled={action.busy || resource.pending} onClick={resource.reload}><RefreshCw size={15}/>{text("Refresh", "刷新")}</Button></div>
    <div><h2 className="text-lg font-semibold">{text("Learning applications", "学习申请")}</h2><p className="mt-1 break-words text-sm text-muted-foreground">{course.data?.title}</p><p className="mt-1 text-xs text-muted-foreground">{text("Platform administrators review applications here. Invitation admissions can also be revoked individually.", "由平台管理员审核学习申请；通过邀请码加入的记录也可单独撤销。")}</p></div>
    <Feedback action={action}/>
    <label className="grid max-w-xs gap-1 text-sm">{text("Admission status", "准入状态")}<select className={inputClass} disabled={action.busy} value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">{text("All statuses", "全部状态")}</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <Loading resource={resource}>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{resource.data?.items.map(application => <li key={application.id} className="flex flex-wrap items-center justify-between gap-3 p-4" data-admission-id={application.id}>
        <div className="min-w-0 flex-1"><p className="break-words font-medium">{application.name} <span className="text-sm text-muted-foreground">@{application.username}</span></p><p className="mt-1 text-xs text-muted-foreground">{labels[application.status]} · {application.origin === "invite" ? text("Joined by invitation", "通过邀请码加入") : text("Application", "主动申请")} · {new Date(application.createdAt).toLocaleString()}</p></div>
        {!application.current ? <p className="text-xs text-muted-foreground">{text("Rule changed · Historical record", "规则已变更 · 历史记录")}</p> : <div className="flex flex-wrap gap-2">{application.status === "pending" && <><Button size="sm" disabled={action.busy || resource.pending} onClick={() => void decide(application, "approve")}>{text("Approve", "批准")}</Button><Button size="sm" variant="secondary" disabled={action.busy || resource.pending} onClick={() => void decide(application, "reject")}>{text("Decline", "拒绝")}</Button></>}
          {application.status === "approved" && <Button size="sm" variant="secondary" disabled={action.busy || resource.pending} onClick={() => void decide(application, "revoke")}>{text("Revoke access", "撤销准入")}</Button>}
          {(application.status === "rejected" || application.status === "revoked") && <Button size="sm" variant="secondary" disabled={action.busy || resource.pending} onClick={() => void decide(application, "approve")}>{text("Grant admission", "批准准入")}</Button>}
        </div>}
      </li>)}{!resource.data?.items.length && <li className="p-6 text-sm text-muted-foreground">{text("No admission records on this page.", "本页暂无准入记录。")}</li>}</ul>
      {(page > 1 || resource.data?.hasMore) && <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={page === 1 || action.busy || resource.pending} onClick={() => setPage(page - 1)}>{text("Previous", "上一页")}</Button><Button variant="secondary" disabled={!resource.data?.hasMore || action.busy || resource.pending} onClick={() => setPage(page + 1)}>{text("Next", "下一页")}</Button></div>}
    </Loading>
  </section>;
}
