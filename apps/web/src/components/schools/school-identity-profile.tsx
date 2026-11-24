"use client";

import { useState, type FormEvent } from "react";
import { Feedback, Loading, Modal, inputClass, useAdminText, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { genderOptions } from "@/lib/gender";
import { ApiError, productionApi, type CampusGender } from "@/lib/production-api";
import { useSchoolError, useSchoolText, type School, type SchoolRole } from "./school-ui";

type OptionalFields = { gender: CampusGender | null; notes: string };
type Profile = Omit<OptionalFields, "notes"> & {
  name: string; number: string; notes: string | null; kind: SchoolRole; version: string;
};

export function OptionalIdentityFields({ gender, notes, onChange }: OptionalFields & {
  onChange: (change: Partial<OptionalFields>) => void;
}) {
  const text = useSchoolText(), t = useAdminText();
  return <>
    <label className="grid gap-1 text-sm font-semibold">
      {text("Gender", "性别")}
      <select className={inputClass} name="gender" value={gender ?? ""}
        onChange={e => onChange({ gender: (e.target.value || null) as CampusGender | null })}>
        <option value="">{text("Unspecified", "未填写")}</option>
        {genderOptions.map(option => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
      </select>
    </label>
    <label className="grid gap-1 text-sm font-semibold">
      {text("Notes (optional)", "备注（可选）")}
      <textarea className={`${inputClass} h-auto py-2`} name="notes" rows={2} maxLength={2000} value={notes}
        onChange={e => onChange({ notes: e.target.value })}/>
    </label>
  </>;
}

export function SchoolIdentityProfile({ school, identityId, onClose, onSaved }: {
  school: School; identityId: string; onClose: () => void; onSaved: () => void;
}) {
  const text = useSchoolText(), explain = useSchoolError();
  const path = `schools/${school.id}/identities/${identityId}/profile`;
  const resource = useData<Profile>(path), action = useMutation();
  const [changes, setChanges] = useState<Partial<Pick<Profile, "name" | "number" | "gender" | "notes">>>({});
  const [stale, setStale] = useState(false);
  const profile = resource.data;
  const draft = profile && { ...profile, ...changes };
  const changed = draft && profile && (draft.name.trim() !== profile.name || draft.number.trim() !== profile.number ||
    draft.gender !== profile.gender || (draft.notes ?? "").trim() !== (profile.notes ?? "").trim());
  function reload() {
    setChanges({}); setStale(false); action.clear(); resource.reload();
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!profile || !changed || stale || action.busy) return;
    void action.run(async () => {
      try {
        await productionApi(path, { method: "PATCH", body: { ...changes, expectedVersion: profile.version } });
      } catch (error) {
        if (error instanceof ApiError && error.code === "PROFILE_CHANGED") {
          setStale(true);
          throw new Error(text("This profile changed. Reload its details before saving.", "档案已被修改，请重新加载后再确认。"));
        }
        if (error instanceof ApiError && error.code === "CONFLICT") {
          throw new Error(text("This number is already used by another school identity of this type.", "本校同类型身份已使用此编号，请更换编号。"));
        }
        throw explain(error);
      }
      onSaved();
    });
  }
  return <Modal title={text("Edit identity profile", "编辑资料")}
    description={profile ? [school.name, profile.name, profile.number].join(" · ") : school.name}
    onClose={() => { if (!action.busy) onClose(); }}>
    <Loading resource={{ ...resource, loading: resource.loading || resource.pending }}>
      {draft && <form onSubmit={save} className="space-y-4">
        <fieldset disabled={action.busy || stale} className="space-y-3">
          <legend className="sr-only">{text("School identity profile", "校内身份资料")}</legend>
          <label className="grid gap-1 text-sm font-semibold">{text("Name", "姓名")}
            <input name="name" required pattern={".*\\S.*"} maxLength={100} className={inputClass} value={draft.name}
              onChange={e => setChanges({ ...changes, name: e.target.value })}/>
          </label>
          <label className="grid gap-1 text-sm font-semibold">{draft.kind === "student" ? text("Student number", "学号")
            : draft.kind === "teacher" ? text("Staff number", "工号") : text("Identity number", "身份编号")}
            <input name="number" required pattern={".*\\S.*"} maxLength={64} className={inputClass} value={draft.number}
              onChange={e => setChanges({ ...changes, number: e.target.value })}/>
          </label>
          <OptionalIdentityFields gender={draft.gender} notes={draft.notes ?? ""} onChange={value => setChanges({ ...changes, ...value })}/>
        </fieldset>
        <Feedback action={action}/>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={action.busy} onClick={onClose}>{text("Cancel", "取消")}</Button>
          {stale ? <Button type="button" onClick={reload}>{text("Reload profile", "重新加载资料")}</Button>
            : <Button type="submit" disabled={action.busy || !changed}>{text("Save profile", "保存资料")}</Button>}
        </div>
      </form>}
    </Loading>
  </Modal>;
}
