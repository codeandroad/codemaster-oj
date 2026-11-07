"use client";

import { useId, useRef, useState } from "react";
import { Feedback, Loading, Modal, inputClass, panelClass, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";
import { exitNoteClass, type SchoolExitRequest } from "./school-exit-request";
import { useSchoolError, useSchoolText } from "./school-ui";

type Candidate = { accountId: string; identityId: string | null; name: string; number: string | null; membershipStartedAt: string };
type Selection = { action: "direct"; student: Candidate } | { action: "approve" | "reject"; request: SchoolExitRequest };
type List<T> = { items: T[]; page: number; hasMore: boolean };
const views = ["pending", "approved", "rejected", "students"] as const;
type View = (typeof views)[number];

export function SchoolExitAdministration({ schoolId, onChanged }: { schoolId: string; onChanged?: () => void }) {
  const text = useSchoolText();
  const localError = useSchoolError();
  const { locale } = useLocale();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<View>("pending");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Selection | null>(null);
  const action = useMutation();
  const search = new URLSearchParams({ page: String(page), q: query, status: view });
  const base = `schools/${schoolId}`;
  const list = useData<List<SchoolExitRequest | Candidate>>(`${base}/${view === "students" ? "student-exits" : "exit-requests"}?${search}`);
  const labels = {
    pending: text("Pending", "待审核"),
    approved: text("Archived", "已退校"),
    rejected: text("Declined", "已驳回"),
    students: text("Process an exit", "主动办理退校"),
  };

  return <section aria-labelledby={headingId} className={`${panelClass} mt-4 p-4`}>
    <h2 ref={heading} id={headingId} tabIndex={-1} className="text-sm font-semibold">{text("School exits", "退校管理")}</h2>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {views.map(value => <Button key={value} size="sm" variant={view === value ? "primary" : "secondary"} aria-pressed={view === value}
        onClick={() => { setView(value); setPage(1); }}>{labels[value]}</Button>)}
      <input className={`${inputClass} sm:ml-auto sm:w-56`} type="search" maxLength={100} value={query}
        onChange={event => { setQuery(event.target.value); setPage(1); }}
        placeholder={text("Name or student number", "姓名或学号")} aria-label={text("Search exit records or students", "搜索退校记录或学生")} />
    </div>
    <Loading resource={list}>
      {list.data?.items.length ? <ul className="mt-2 divide-y divide-border">
        {list.data.items.map(item => {
          if ("studentName" in item) return <li key={item.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
            <div className="min-w-40 flex-1">
              <span className="font-semibold">{item.studentName}</span> <span className="text-muted-foreground">{item.studentNumber}</span>
              <p className="text-xs text-muted-foreground">
                {item.accountId === item.requestedBy ? text("Student request", "学生申请") : text("School-initiated", "学校办理")}
                {" · "}{new Date(item.reviewedAt ?? item.requestedAt).toLocaleDateString(locale === "en" ? "en" : "zh-CN")}
              </p>
              {item.reason && <p className="mt-1 break-words">{item.reason}</p>}
              {item.reviewNote && <p className="mt-1 break-words text-muted-foreground">{item.reviewNote}</p>}
            </div>
            {item.status === "pending" && <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => { action.clear(); setSelected({ action: "reject", request: item }); }}>{text("Decline", "驳回")}</Button>
              <Button size="sm" onClick={() => { action.clear(); setSelected({ action: "approve", request: item }); }}>{text("Approve", "批准")}</Button>
            </div>}
          </li>;
          return <li key={item.accountId} className="flex items-center gap-2 py-2.5 text-sm">
            <div className="min-w-0 flex-1 break-words"><span className="font-semibold">{item.name}</span> <span className="text-muted-foreground">{item.number}</span></div>
            <Button size="sm" variant="secondary" onClick={() => { action.clear(); setSelected({ action: "direct", student: item }); }}>{text("Process exit", "办理退校")}</Button>
          </li>;
        })}
      </ul> : <p className="py-4 text-sm text-muted-foreground">
        {view === "students" ? text("No matching students.", "没有符合条件的学生。") : text("No matching exit records.", "没有符合条件的退校记录。")}
      </p>}
      {(page > 1 || list.data?.hasMore) && <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>{text("Previous", "上一页")}</Button>
        <Button size="sm" variant="secondary" disabled={!list.data?.hasMore} onClick={() => setPage(page + 1)}>{text("Next", "下一页")}</Button>
      </div>}
    </Loading>
    {!selected && <Feedback action={action} />}
    {selected && <Modal
      title={selected.action === "reject" ? text("Decline exit request", "驳回退校申请") : text("Confirm school exit", "确认办理退校")}
      description={selected.action === "reject"
        ? text("The student will remain a member of this school.", "学生将继续保留本校成员身份。")
        : text("School access ends immediately. The student keeps their login and the school retains their archived records.", "学生将立即失去校内访问权限。个人账号保留，校内资料归档。")}
      onClose={() => { if (!action.busy) setSelected(null); }}
    >
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        const note = String(new FormData(event.currentTarget).get("note") ?? "");
        void action.run(async () => {
          try {
            if (selected.action === "direct") {
              const { accountId, identityId, membershipStartedAt } = selected.student;
              await productionApi(`${base}/student-exits`, { method: "POST", body: { accountId, identityId, membershipStartedAt, reason: note } });
            } else {
              await productionApi(`${base}/exit-requests/${selected.request.id}/decision`, { method: "POST", body: { decision: selected.action, note } });
            }
            setSelected(null);
            list.reload();
            requestAnimationFrame(() => heading.current?.focus());
            if (selected.action !== "reject") onChanged?.();
            action.success(selected.action === "reject" ? text("Request declined.", "申请已驳回。") : text("Exit recorded and student records archived.", "已办理退校并归档学生资料。"));
          } catch (error) { throw localError(error); }
        });
      }}>
        <p className="break-words text-sm font-semibold">{selected.action === "direct" ? selected.student.name : selected.request.studentName}</p>
        <label className="block space-y-1.5 text-sm">
          <span>{text("Note visible to the student (optional)", "说明（学生可见，选填）")}</span>
          <textarea className={exitNoteClass} name="note" maxLength={500} rows={2} />
        </label>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={action.busy} onClick={() => setSelected(null)}>{text("Cancel", "取消")}</Button>
          <Button type="submit" disabled={action.busy}>{text("Confirm", "确认")}</Button>
        </div>
      </form>
    </Modal>}
  </section>;
}
