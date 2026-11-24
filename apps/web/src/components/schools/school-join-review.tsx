"use client";

import { useState } from "react";
import { Feedback, Loading, Modal, useData, useMutation } from "@/components/admin/common";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { schoolWorkspaceHref } from "./school-workspace-location";
import { useSchoolText } from "./school-ui";

type Application = {
  id: string;
  name: string;
  username: string;
  number: string;
  kind: string;
  identityId: string | null;
};

export function SchoolJoinReview({ schoolId, onChanged }: { schoolId: string; onChanged: () => void }) {
  const path = `schools/${schoolId}/join-requests`;
  const requests = useData<{ items: Application[] }>(path);
  const [review, setReview] = useState<Application | null>(null);
  const action = useMutation();
  const t = useSchoolText();
  function decide(item: Application, decision: "approved" | "rejected") {
    void action.run(async () => {
      await productionApi(path + "/" + item.id + "/decision", {
        method: "POST",
        body: { decision, identityId: item.identityId },
      });
      setReview(null);
      requests.reload();
      onChanged();
    });
  }
  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("School applications", "入校申请")}</h3>
        <Button size="sm" variant="ghost" onClick={requests.reload}>
          {t("Refresh", "刷新")}
        </Button>
      </div>
      <Loading resource={requests}>
        {requests.data?.items.length ? (
          <ul className="divide-y divide-border">
            {requests.data.items.map((item) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={item.id}>
                <span>
                  {item.name} · {item.number} · @{item.username}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    action.clear();
                    setReview(item);
                  }}
                >
                  {t("Review", "核对申请")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("No pending applications.", "暂无待审核申请。")}</p>
        )}
      </Loading>
      {review && (
        <Modal
          title={t("Review school application", "核对入校申请")}
          onClose={() => {
            if (!action.busy) setReview(null);
          }}
        >
          <p>
            {t("Applicant account", "申请账号")} · @{review.username}
          </p>
          <p>
            {review.kind === "student" ? t("Student", "学生") : t("Teacher", "教师")} · {review.number} ·{" "}
            {review.name}
          </p>
          {review.identityId ? (
            <AppLink
              className="text-primary underline"
              href={schoolWorkspaceHref(schoolId, "identities") + "&identityId=" + review.identityId}
            >
              {t("View matching school record", "查看匹配的校内档案")}
            </AppLink>
          ) : (
            <div>
              <p>
                {t(
                  "Create or correct the matching unlinked school record before approving.",
                  "请先在身份档案中建立或核对姓名、编号一致的未关联档案，再刷新申请。",
                )}
              </p>
              <AppLink className="text-primary underline" href={schoolWorkspaceHref(schoolId, "identities")}>
                {t("Open school records", "打开身份档案")}
              </AppLink>
            </div>
          )}
          <Feedback action={action} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" disabled={action.busy} onClick={() => decide(review, "rejected")}>
              {t("Reject", "驳回")}
            </Button>
            <Button disabled={action.busy || !review.identityId} onClick={() => decide(review, "approved")}>
              {t("Approve and link identity", "批准并关联身份")}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
