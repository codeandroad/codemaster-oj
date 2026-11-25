"use client";

import { useRef, useState } from "react";
import { Feedback, Loading, inputClass, useData, useMutation } from "@/components/admin/common";
import { activationSchoolLabel, type ActivationSchool } from "@/components/auth/registration-fields";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

export function JoinSchoolForm({
  action,
  onCancel,
  onComplete,
}: {
  action: ReturnType<typeof useMutation>;
  onCancel?: () => void;
  onComplete: (schoolId: string, pending: boolean) => void;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const directory = useData<{ items: ActivationSchool[] }>("auth/activation-schools");
  const [mode, setMode] = useState("claim");
  const [kind, setKind] = useState("student");
  const [number, setNumber] = useState("");
  const studentApplication = mode === "apply" && kind === "student";
  const needsHint = studentApplication && !number.trim();
  const pending = useRef(false);
  const schools = directory.data?.items ?? [];
  return (
    <Loading resource={directory}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending.current) return;
          const data = new FormData(event.currentTarget);
          const school = schools.find((item) => item.id === data.get("school"));
          if (!school) return;
          const identity = {
            kind,
            number: number.trim(),
            name: String(data.get("name")).trim(),
          };
          pending.current = true;
          void action
            .run(async () => {
              if (mode === "claim") {
                await productionApi("auth/claim-identity", {
                  method: "POST",
                  body: {
                    ...identity,
                    schoolSlug: school.slug,
                    activationCode: String(data.get("code")).trim(),
                  },
                });
              } else {
                await productionApi(`schools/${school.id}/join-requests`, { method: "POST", body: { ...identity, ...(needsHint && { rosterHint: data.get("rosterHint") }) } });
              }
              onComplete(school.id, mode === "apply");
            })
            .finally(() => {
              pending.current = false;
            });
        }}
      >
        <fieldset disabled={action.busy} className="space-y-3">
          <legend className="sr-only">{text("Join a school", "加入学校")}</legend>
          <label className="block">
            {text("Join method", "入校方式")}
            <select
              className={inputClass}
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                action.clear();
              }}
            >
              <option value="claim">{text("Use an identity claim code", "使用身份认领码")}</option>
              <option value="apply">{text("Apply without a code", "没有码，申请入校")}</option>
            </select>
          </label>
          <label className="block">
            {text("School", "学校")}
            <select
              name="school"
              required
              defaultValue={schools.length === 1 ? schools[0].id : ""}
              className={inputClass}
            >
              <option value="">{text("Select school", "选择学校")}</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {activationSchoolLabel(school, schools, locale)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {text("Identity type", "身份类型")}
            <select value={kind} className={inputClass} onChange={(e) => setKind(e.target.value)}>
              <option value="student">{text("Student", "学生")}</option>
              <option value="teacher">{text("Teacher", "教师")}</option>
            </select>
          </label>
          <label className="block">
            {studentApplication ? text("Student ID (if known)", "学号（选填）") : kind === "student" ? text("Student ID", "学号") : text("Staff ID", "工号")}
            <input name="number" value={number} onChange={e => setNumber(e.target.value)} required={!studentApplication} maxLength={64} className={inputClass} />
          </label>
          <label className="block">
            {text("Name on school record", "校内档案姓名")}
            <input name="name" required maxLength={100} className={inputClass} />
          </label>
          {needsHint && (
            <label className="block">
              {text("Class, homeroom teacher or school contact", "所在班级、班主任或校内联系人")}
              <input name="rosterHint" required maxLength={160} className={inputClass} aria-describedby="roster-hint-help" />
              <span id="roster-hint-help" className="text-sm text-muted-foreground">
                {text("Give one detail the school can check. The school will verify your identity before linking your record.", "不知道学号时，填写一项学校可核对的信息。校方核实本人后才会关联档案。")}
              </span>
            </label>
          )}
          {mode === "claim" && (
            <label className="block">
              {text("Identity claim code", "身份认领码")}
              <input
                name="code"
                type="password"
                required
                autoComplete="one-time-code"
                maxLength={100}
                className={inputClass}
              />
            </label>
          )}
          <Feedback action={action} />
          <div className="flex justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel}>
                {text("Cancel", "取消")}
              </Button>
            )}
            <Button type="submit">
              {mode === "claim"
                ? text("Claim identity", "认领身份")
                : text("Submit application", "提交入校申请")}
            </Button>
          </div>
        </fieldset>
      </form>
    </Loading>
  );
}

export function MySchoolRequests({ onRefresh }: { onRefresh: () => void }) {
  const text = useSchoolText();
  const requests = useData<{ items: { id: string; schoolName: string; number: string | null; name: string; status: string }[] }>(
    "schools/join-requests",
  );
  const labels: Record<string, string> = {
    pending: text("Pending review", "待审核"),
    approved: text("Approved", "已批准"),
    rejected: text("Rejected", "已驳回"),
    superseded: text("School identity linked", "已关联身份"),
  };
  return (
    <Loading resource={requests}>
      {!!requests.data?.items.length && (
        <section className="mt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{text("My school applications", "我的入校申请")}</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                requests.reload();
                onRefresh();
              }}
            >
              {text("Refresh status", "刷新状态")}
            </Button>
          </div>
          <ul>
            {requests.data.items.map((item) => (
              <li className="py-1 text-sm" key={item.id}>
                {item.schoolName} · {item.number ?? item.name} · {labels[item.status]}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Loading>
  );
}
