"use client";

import { useRef, useState } from "react";

import { Feedback, Loading, Modal, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { useSchoolError, useSchoolText } from "./school-ui";

export type SchoolExitRequest = {
  id: string;
  accountId: string;
  requestedBy: string;
  studentName: string;
  studentNumber: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  reviewedAt: string | null;
  reviewNote: string;
};

export const exitNoteClass = "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type SchoolExitRequestResult = { request: Pick<SchoolExitRequest, "status" | "reviewNote"> | null };

export function SchoolExitRequestAction({ schoolId, schoolName }: {
  schoolId: string;
  schoolName: string;
}) {
  const text = useSchoolText();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const path = `schools/${schoolId}/exit-request`;
  const resource = useData<SchoolExitRequestResult>(path);
  const status = resource.data?.request?.status;
  const statusLabel = {
    pending: text("Exit request awaiting review", "退校申请待审核"),
    approved: text("Exit request approved", "退校申请已批准"),
    rejected: text("Exit request declined", "退校申请未获批准"),
  };

  return <>
    {status && <p role="status" className="text-xs text-muted-foreground">{statusLabel[status]}</p>}
    <details className="border-t border-border pt-2">
      <summary className="w-fit cursor-pointer rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
        {text("Membership options", "成员身份选项")}
      </summary>
      <Button ref={trigger} size="sm" variant="ghost" className="mt-1" onClick={() => setOpen(true)}>
        {status ? text("View exit request", "查看退校申请") : text("Request to leave", "申请退校")}
      </Button>
    </details>
    {open && <SchoolExitRequestDialog path={path} resource={resource} schoolName={schoolName} onClose={() => {
      setOpen(false);
      requestAnimationFrame(() => trigger.current?.focus());
    }} />}
  </>;
}

function SchoolExitRequestDialog({ path, resource, schoolName, onClose }: {
  path: string;
  resource: ReturnType<typeof useData<SchoolExitRequestResult>>;
  schoolName: string;
  onClose: () => void;
}) {
  const text = useSchoolText();
  const localError = useSchoolError();
  const action = useMutation();
  const record = resource.data?.request;
  const status = record?.status;
  const finalized = status === "pending" || status === "approved";

  return <Modal
    title={text("Request to leave school", "申请退校")}
    description={text(
      `${schoolName} reviews your request. You keep school access until it is approved. Your account and the school’s archived records are retained.`,
      `${schoolName} 的管理员会审核你的申请。审批通过前，你仍可使用校内功能。退校后保留个人账号，校内历史记录由学校归档。`,
    )}
    onClose={() => { if (!action.busy) onClose(); }}
  >
    <Loading resource={resource}>
      {finalized ? <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
        {status === "pending"
          ? text("Your request is awaiting review.", "你的退校申请正在等待审核。")
          : text("Your request was approved.", "你的退校申请已获批准。")}
      </p> : <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
        void action.run(async () => {
          try {
            await productionApi(path, { method: "POST", body: { reason } });
            resource.reload();
            action.success(text("Request sent.", "申请已提交。"));
          } catch (error) { throw localError(error); }
        });
      }}>
        {record?.status === "rejected" && <p className="break-words rounded-md bg-muted px-3 py-2 text-sm">
          {text("Your previous request was declined.", "上次申请未获批准。")} {record.reviewNote}
        </p>}
        <label className="block space-y-1.5 text-sm">
          <span>{text("Reason (optional)", "原因（选填）")}</span>
          <textarea className={exitNoteClass} name="reason" maxLength={500} rows={2} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={action.busy}>{text("Cancel", "取消")}</Button>
          <Button type="submit" disabled={action.busy || !!action.message}>{text("Submit request", "提交申请")}</Button>
        </div>
      </form>}
    </Loading>
    <Feedback action={action} />
  </Modal>;
}
