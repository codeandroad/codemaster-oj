"use client";

import { useRef, useState } from "react";
import { Feedback, Loading, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

type Application = {
  id: string;
  name: string;
  username: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  createdAt: string;
};

type Admissions = {
  courseTitle: string;
  revision: number | null;
  sourceVersion?: string;
  accessScope: "school" | "classes" | null;
  mode: "application" | "direct" | null;
  applications: Application[];
  page: number;
  hasMore: boolean;
};

export function CourseAdmissionsDialog({ schoolId, course, applicationId, onChanged, onClose }: {
  schoolId: string;
  course: { id: string; title: string };
  applicationId?: string;
  onChanged?: () => void;
  onClose: () => void;
}) {
  const text = useSchoolText();
  const [page, setPage] = useState(1);
  const [confirmClose, setConfirmClose] = useState(false);
  const base = `schools/${schoolId}/course-admissions/${encodeURIComponent(course.id)}`;
  const query = new URLSearchParams({ page: String(page) });
  if (applicationId) query.set("applicationId", applicationId);
  const data = useData<Admissions>(`${base}?${query}`);
  const mutation = useMutation();
  const pending = useRef(false);
  const admission = data.data;
  const labels = {
    pending: text("Pending", "待审核"),
    approved: text("Approved", "已批准"),
    rejected: text("Rejected", "已拒绝"),
    revoked: text("Access revoked", "已撤销准入"),
  };

  async function save(method: "POST" | "DELETE", suffix = "", action?: string) {
    if (!admission?.revision || pending.current) return;
    pending.current = true;
    try {
      await mutation.run(async () => {
        await productionApi(base + suffix, {
          method,
          body: {
            expectedRevision: admission.revision,
            ...(admission.sourceVersion && { sourceVersion: admission.sourceVersion }),
            ...(action && { action }),
          },
        });
        setConfirmClose(false);
        data.reload();
        onChanged?.();
        mutation.success(text("Course admission updated.", "课程准入已更新。"));
      });
    } finally {
      pending.current = false;
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogTitle>{text("Course admissions", "课程准入")}</DialogTitle>
        <DialogDescription>{admission?.courseTitle ?? (course.title || text("Review access to this course.", "审核此课程的访问申请。"))}</DialogDescription>
        <Feedback action={mutation}/>
        <Loading resource={data}>
          {admission && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                {admission.accessScope === "classes"
                  ? text("Students in the selected classes can enter directly.", "指定班级的学生可以直接进入。")
                  : text("Members of this school can enter directly.", "本校成员可以直接进入。")}
              </p>
              {applicationId && admission.mode !== "application" ? (
                <p>{text("This application is no longer available for review.", "这份申请已无法审核。")}</p>
              ) : admission.mode === "direct" ? (
                <p>{text("The platform has opened this course to all learners.", "平台已向所有学习者开放此课程。")}</p>
              ) : admission.revision === null ? (
                <p>{text("The course must be published, listed and available at school before you can open applications.", "课程须已在校内发布、列入目录且处于开放期，才能接受申请。")}</p>
              ) : admission.mode === null ? (
                <>
                  <p>{text("Opening applications lists this edition in the public course catalog. Other learners need approval to read it.",
                    "开放申请后，此版本会出现在公开课程目录中，其他学习者须获批后才能阅读。")}</p>
                  <Button disabled={mutation.busy} onClick={() => void save("POST")}>
                    {text("List and accept applications", "上架并开放申请")}
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{text("Applications for this edition", "当前版本的申请")}</h3>
                    <Button variant="secondary" disabled={mutation.busy} onClick={() => setConfirmClose(!confirmClose)}>
                      {text("Close applications", "关闭申请")}
                    </Button>
                  </div>
                  {confirmClose && (
                    <div className="space-y-2 rounded-md border border-border p-3">
                      <p>{text("Remove this course from the public catalog and end access granted through these applications?",
                        "从公开目录撤回课程，并终止本轮申请所授予的访问权限？")}</p>
                      <Button variant="destructive" disabled={mutation.busy} onClick={() => void save("DELETE")}>
                        {text("Confirm withdrawal", "确认撤回")}
                      </Button>
                    </div>
                  )}
                  {applicationId && admission.page === 1 && !admission.applications.some(application => application.id === applicationId) && (
                    <p className="text-muted-foreground">{text("This application is no longer available for review.", "这份申请已无法审核。")}</p>
                  )}
                  <ul className="divide-y divide-border">
                    {admission.applications.map(application => (
                      <li key={application.id} className={`flex flex-wrap items-center justify-between gap-2 px-2 py-2 ${application.id === applicationId ? "rounded-md bg-accent" : ""}`}>
                        <div>
                          <p className="font-medium">{application.name} <span className="text-xs text-muted-foreground">@{application.username}</span></p>
                          <p className="text-xs text-muted-foreground">{labels[application.status]}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {application.status === "pending" && (
                            <>
                              <Button size="sm" disabled={mutation.busy} onClick={() => void save("POST", `/${application.id}/decision`, "approve")}>
                                {text("Approve", "批准")}
                              </Button>
                              <Button size="sm" variant="secondary" disabled={mutation.busy} onClick={() => void save("POST", `/${application.id}/decision`, "reject")}>
                                {text("Reject", "拒绝")}
                              </Button>
                            </>
                          )}
                          {application.status === "approved" && (
                            <Button size="sm" variant="secondary" disabled={mutation.busy} onClick={() => void save("POST", `/${application.id}/decision`, "revoke")}>
                              {text("Revoke access", "撤销准入")}
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!admission.applications.length && <p className="text-muted-foreground">{text("No applications on this page.", "本页暂无申请。")}</p>}
                  {(page > 1 || admission.hasMore) && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" disabled={page === 1 || mutation.busy} onClick={() => setPage(page - 1)}>{text("Previous", "上一页")}</Button>
                      <Button size="sm" variant="secondary" disabled={!admission.hasMore || mutation.busy} onClick={() => setPage(page + 1)}>{text("Next", "下一页")}</Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </Loading>
      </DialogContent>
    </Dialog>
  );
}
