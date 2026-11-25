"use client";

import { useState } from "react";
import { Feedback, inputClass, Loading, Modal, useData, useMutation } from "@/components/admin/common";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { ApiError, productionApi } from "@/lib/production-api";
import { SchoolClassPicker } from "./school-class-picker";
import { schoolWorkspaceHref } from "./school-workspace-location";
import { useSchoolText } from "./school-ui";

type Application = {
  id: string;
  name: string;
  username: string;
  number: string | null;
  rosterHint: string | null;
  kind: string;
};

export function SchoolJoinReview({ schoolId, onChanged }: { schoolId: string; onChanged: () => void }) {
  const path = `schools/${schoolId}/join-requests`;
  const requests = useData<{ items: Application[] }>(path);
  const [review, setReview] = useState<Application | null>(null);
  const t = useSchoolText();
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
                  onClick={() => setReview(item)}
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
      {review && <ReviewDialog key={review.id} schoolId={schoolId} application={review}
        onClose={() => setReview(null)}
        onReviewed={() => { setReview(null); requests.reload(); onChanged(); }} />}
    </section>
  );
}

type ReviewRecords = {
  version: string | null;
  items: {id: string; number: string; classes: string[]}[];
  records: {id: string; name: string; number: string; classes: string[]; status: "archived" | "linked" | "available"}[];
};
type Approval = { identityId: string; verificationMethod?: string } |
  { createNumber: string; classIds: string[]; verificationMethod: string; distinctStudent: boolean; recordsVersion: string };

function ReviewDialog({ schoolId, application, onClose, onReviewed }: {
  schoolId: string; application: Application; onClose: () => void; onReviewed: () => void;
}) {
  const path = `schools/${schoolId}/join-requests/${application.id}`;
  const candidates = useData<ReviewRecords>(path + "/candidates");
  const action = useMutation();
  const t = useSchoolText();
  function decide(approval?: Approval) {
    if (action.busy) return;
    void action.run(async () => {
      try {
        await productionApi(path + "/decision", { method: "POST",
          body: approval ? {decision: "approved", ...approval} : {decision: "rejected"} });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) candidates.reload();
        throw error;
      }
      onReviewed();
    });
  }
  return <Modal title={t("Review school application", "核对入校申请")} onClose={() => { if (!action.busy) onClose(); }}>
    <p>{t("Applicant account", "申请账号")} · @{application.username}</p>
    <p>{application.kind === "student" ? t("Student", "学生") : t("Teacher", "教师")} · {application.name}
      {application.number && " · " + application.number}</p>
    {application.rosterHint && <p>{t("Applicant’s school details", "申请人提供的线索")} · {application.rosterHint}</p>}
    <Loading resource={{...candidates, loading: candidates.pending || candidates.loading}}>
      {!candidates.error && candidates.data && (candidates.data.version ?
        <ReviewForm key={candidates.data.version} schoolId={schoolId} application={application} matches={candidates.data}
          busy={action.busy} decide={decide} /> :
        <p>{t("This application is no longer pending.", "该申请已结束审核。")}</p>)}
    </Loading>
    <Feedback action={action} />
  </Modal>;
}

function ReviewForm({ schoolId, application, matches, busy, decide }: {
  schoolId: string; application: Application; matches: ReviewRecords; busy: boolean;
  decide: (approval?: Approval) => void;
}) {
  const t = useSchoolText();
  const recordsHref = schoolWorkspaceHref(schoolId, "identities");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [choice, setChoice] = useState(application.number ? matches.items[0]?.id ?? "" : "");
  const [creating, setCreating] = useState(application.kind === "student" && !matches.items.length);
  const [number, setNumber] = useState(application.number ?? "");
  const [verification, setVerification] = useState("");
  const [distinct, setDistinct] = useState(false);
  const selected = matches.items.find(record => record.id === choice);
  const numberTaken = matches.records.some(record => record.number === number.trim());
  const sameName = matches.records.some(record => record.name === application.name);
  const needsVerification = creating || !application.number;
  const canApprove = (!needsVerification || !!verification) && (creating
    ? !!number.trim() && !numberTaken && (!sameName || distinct) : !!selected);
  function switchMode() {
    setCreating(!creating);
    setClassIds([]);
    setDistinct(false);
    setVerification("");
  }
  const status = {
    available: t("Unlinked", "待关联"), linked: t("Already linked", "已关联账号"), archived: t("Archived", "已归档"),
  };
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault();
    if (!canApprove || busy) return;
    if (creating && matches.version) {
      decide({createNumber: number.trim(), classIds, verificationMethod: verification, distinctStudent: distinct, recordsVersion: matches.version});
    } else if (selected) {
      decide({identityId: selected.id, verificationMethod: needsVerification ? verification : undefined});
    }
  }}>
    <fieldset disabled={busy} className="space-y-3">
      {creating ? <>
        {matches.records.length === 0 ? <p>{t("No school record matches this student’s name or ID.", "本校尚无与该生姓名或学号匹配的档案。")}</p> : <div>
          <p className="font-medium">{t("School records with the same name or ID", "本校同名或同学号档案")}</p>
          <ul className="divide-y divide-border">{matches.records.map(record => <li key={record.id} className="py-1">
            <AppLink className="text-primary underline" href={recordsHref + "&identityId=" + record.id}>{record.name} · {record.number}</AppLink>
            {" · "}{status[record.status]}{record.classes.length > 0 && " · " + record.classes.join("、")}
          </li>)}</ul>
        </div>}
        <label className="block">{t("Verified school student ID", "已核实的校内学号")}
          <input className={inputClass} name="createNumber" value={number} readOnly={!!application.number} required maxLength={64}
            onChange={e => { setNumber(e.target.value); setDistinct(false); setVerification(""); }} />
        </label>
        {numberTaken ? <p role="status">{t("This ID already has a school record. Review the existing record before proceeding.", "该学号已有档案，请先核对原档案。")}</p>
          : !application.number && <p className="text-sm text-muted-foreground">{t("Use the student ID confirmed or assigned by your school.", "请填写学校已核实或新分配给该生的学号。")}</p>}
        {sameName && !numberTaken && <label className="flex items-start gap-2">
          <input type="checkbox" name="distinctStudent" checked={distinct} onChange={e => setDistinct(e.target.checked)} />
          {t("I checked the same-name records above. Each belongs to a different student from this applicant.", "我已核对以上同名档案，确认均不属于申请人。")}
        </label>}
        {!numberTaken && <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t("Student classes (optional)", "所在班级（可选）")}</legend>
          <SchoolClassPicker schoolId={schoolId} selected={classIds} onChange={setClassIds} />
        </fieldset>}
      </> : <>
        {!application.number && <label className="block">{t("Same-name school records", "本校同名档案")}
          <select className={inputClass} name="identityId" value={choice} onChange={e => { setChoice(e.target.value); setVerification(""); }}>
            <option value="">{t("Choose the verified record", "请选择已核实的档案")}</option>
            {matches.items.map(record => <option key={record.id} value={record.id}>
              {application.name} · {record.number} · {record.classes.join("、") || t("No class assigned", "未分班")}
            </option>)}
          </select>
        </label>}
        {selected ? <AppLink className="text-primary underline" href={recordsHref + "&identityId=" + selected.id}>
          {t("View matching school record", "查看匹配的校内档案")}</AppLink> :
          !matches.items.length && <p>{t("Create or correct the matching teacher record in the school directory before approving.", "请先在身份档案中建立或核对姓名、工号一致的教师档案。")}
            {" "}<AppLink className="text-primary underline" href={recordsHref}>{t("Open school records", "打开身份档案")}</AppLink></p>}
      </>}
      {application.kind === "student" && !application.number && matches.items.length > 0 &&
        <Button variant="secondary" size="sm" type="button" onClick={switchMode}>{creating ? t("Use an existing record", "选择已有档案")
          : t("Create a record for a different student with this name", "为另一名同名学生建档")}</Button>}
      {needsVerification && (selected || creating) && (!creating || !numberTaken) && <label className="block">
        {t("How did you verify the applicant?", "如何核实申请人身份？")}
        <select required className={inputClass} name="verificationMethod" value={verification} onChange={e => setVerification(e.target.value)}>
          <option value="">{t("Choose a verification method", "请选择核验方式")}</option>
          <option value="in_person">{t("Verified in person", "已当面核验本人")}</option>
          <option value="school_contact">{t("Verified through an established school contact", "已通过校方已有的联系方式核验")}</option>
        </select>
      </label>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => decide()}>{t("Reject", "驳回")}</Button>
        <Button type="submit" disabled={!canApprove || busy}>{creating ? t("Create student record and approve", "建档并批准入校")
          : t("Approve and link identity", "批准并关联身份")}</Button>
      </div>
    </fieldset>
  </form>;
}
