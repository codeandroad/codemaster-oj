"use client";

import { useState } from "react";
import { Feedback, inputClass, Loading, Modal, useData, useMutation } from "@/components/admin/common";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { schoolWorkspaceHref } from "./school-workspace-location";
import { useSchoolText } from "./school-ui";

type Application = {
  id: string;
  name: string;
  username: string;
  number: string | null;
  rosterHint: string | null;
  kind: string;
  identityId: string | null;
};

export function SchoolJoinReview({ schoolId, onChanged }: { schoolId: string; onChanged: () => void }) {
  const path = `schools/${schoolId}/join-requests`;
  const requests = useData<{ items: Application[] }>(path);
  const [review, setReview] = useState<Application | null>(null);
  const [choice, setChoice] = useState("");
  const [verification, setVerification] = useState("");
  const needsReview = review?.number === null;
  const candidates = useData<{items: {id: string; number: string; classes: string[]}[]}>(
    review && needsReview ? path + "/" + review.id + "/candidates" : null,
  );
  const selectedCandidate = candidates.data?.items.find(item => item.id === choice);
  const selectedId = needsReview ? (candidates.pending ? null : selectedCandidate?.id) : review?.identityId;
  const action = useMutation();
  const t = useSchoolText();
  function decide(item: Application, decision: "approved" | "rejected") {
    if (action.busy || (decision === "approved" && (!selectedId || (needsReview && !verification)))) return;
    void action.run(async () => {
      await productionApi(path + "/" + item.id + "/decision", {
        method: "POST",
        body: { decision, identityId: selectedId, verificationMethod: verification || undefined },
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
                  {item.name} · {item.number ?? t("No student ID provided", "未填学号")} · @{item.username}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    action.clear();
                    setChoice("");
                    setVerification("");
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
            {review.kind === "student" ? t("Student", "学生") : t("Teacher", "教师")} · {review.number && review.number + " · "}
            {review.name}
          </p>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); decide(review, "approved"); }}>
            {needsReview && <>
              <p>{t("Applicant’s school details", "申请人提供的线索")} · {review.rosterHint}</p>
              <Loading resource={{...candidates, loading: candidates.pending || candidates.loading}}>
                {candidates.data?.items.length ? (
                  <label className="block">{t("Same-name school records", "本校同名档案")}
                    <select required className={inputClass} name="identityId" value={choice} onChange={e => { setChoice(e.target.value); setVerification(""); }}>
                      <option value="">{t("Choose the verified record", "请选择已核实的档案")}</option>
                      {candidates.data.items.map(record => <option key={record.id} value={record.id}>
                        {review.name} · {record.number} · {record.classes.join("、") || t("No class assigned", "未分班")}
                      </option>)}
                    </select>
                  </label>
                ) : <p>{t("No unlinked student record matches this name.", "本校没有同名且未关联账号的学生档案。")}</p>}
              </Loading>
              {selectedId && <label className="block">{t("How did you verify the applicant?", "如何核实申请人是档案本人？")}
                <select required className={inputClass} name="verificationMethod" value={verification} onChange={e => setVerification(e.target.value)}>
                  <option value="">{t("Choose a verification method", "请选择核验方式")}</option>
                  <option value="in_person">{t("Verified in person", "已当面核验本人")}</option>
                  <option value="school_contact">{t("Verified through an established school contact", "已通过校方已有的联系方式核验")}</option>
                </select>
              </label>}
            </>}
            {selectedId ? (
              <AppLink
                className="text-primary underline"
                href={schoolWorkspaceHref(schoolId, "identities") + "&identityId=" + selectedId}
              >
                {t("View matching school record", "查看匹配的校内档案")}
              </AppLink>
            ) : (
              <div>
                {!needsReview && <p>
                  {t(
                    "Create or correct the matching unlinked school record before approving.",
                    "请先在身份档案中建立或核对姓名、编号一致的未关联档案，再刷新申请。",
                  )}
                </p>}
                <AppLink className="text-primary underline" href={schoolWorkspaceHref(schoolId, "identities")}>
                  {t("Open school records", "打开身份档案")}
                </AppLink>
              </div>
            )}
            <Feedback action={action} />
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={action.busy} onClick={() => decide(review, "rejected")}>
                {t("Reject", "驳回")}
              </Button>
              <Button type="submit" disabled={action.busy || !selectedId || (needsReview && !verification)}>
                {t("Approve and link identity", "批准并关联身份")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
