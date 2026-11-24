"use client";

import { useState, type FormEvent } from "react";
import { Feedback, Loading, Modal, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { ApiError, productionApi } from "@/lib/production-api";
import { SchoolClassPicker } from "./school-class-picker";
import { useSchoolError, useSchoolText, type School } from "./school-ui";

export type IdentityClass = { id: string; name: string; archived: boolean };
type IdentityClasses = {
  kind: "student" | "teacher";
  name: string;
  number: string;
  classes: IdentityClass[];
};

export function SchoolIdentityClasses({ school, identityId, onClose, onSaved }: {
  school: School; identityId: string; onClose: () => void; onSaved: () => void;
}) {
  const text = useSchoolText(), explain = useSchoolError();
  const path = `schools/${school.id}/identities/${identityId}/classes`;
  const resource = useData<IdentityClasses>(path);
  const action = useMutation();
  const [selection, setSelection] = useState<string[] | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const identity = resource.data;
  const initial = identity?.classes.filter(c => !c.archived).map(c => c.id) ?? [];
  const archived = identity?.classes.filter(c => c.archived) ?? [];
  const selected = selection ?? initial;
  const changed = initial.length !== selected.length || initial.some(id => !selected.includes(id));

  function reload() {
    setSelection(null);
    setNeedsReload(false);
    action.clear();
    resource.reload();
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!changed || action.busy || needsReload) return;
    void action.run(async () => {
      try {
        await productionApi(path, { method: "PATCH", body: { expectedClassIds: initial, classIds: selected } });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
          setNeedsReload(true);
          throw new Error(text("The identity or classes have changed. Reload before saving.",
            "身份或班级名单已变更，请重新加载后再确认。"));
        }
        throw explain(error);
      }
      onSaved();
    });
  }

  return <Modal title={text("Adjust classes", "调整班级")}
    description={identity ? [school.name, identity.name, identity.number].join(" · ") : school.name}
    onClose={() => { if (!action.busy) onClose(); }}>
    <Loading resource={{ ...resource, loading: resource.pending || resource.loading }}>
      {identity && <form className="space-y-4" onSubmit={save}>
        <fieldset disabled={action.busy || needsReload} className="space-y-2">
          <legend className="text-sm font-semibold">{identity.kind === "teacher"
            ? text("Teaching classes", "任教班级") : text("Student classes", "所在班级")}</legend>
          <SchoolClassPicker schoolId={school.id} selected={selected} onChange={setSelection}/>
        </fieldset>
        {archived.length > 0 && <p className="text-sm text-muted-foreground">
          {text("Archived classes", "已归档班级")} · {archived.map(c => c.name).join("、")}
        </p>}
        <Feedback action={action}/>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={action.busy} onClick={onClose}>{text("Cancel", "取消")}</Button>
          {needsReload
            ? <Button type="button" onClick={reload}>{text("Reload classes", "重新加载班级")}</Button>
            : <Button type="submit" disabled={action.busy || !changed}>{text("Save classes", "保存班级")}</Button>}
        </div>
      </form>}
    </Loading>
  </Modal>;
}
