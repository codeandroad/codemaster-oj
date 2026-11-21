"use client";

import { useState } from "react";
import { useNavigationBlocker } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Feedback, textarea, useMutation } from "@/components/student/shared";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

export function CorrectionNote({ path, job, onSaved }: { path: string; job: {note?:string|null}; onSaved: () => void }) {
  const text = useSchoolText();
  const [note, setNote] = useState(job.note ?? "");
  const action = useMutation();
  const dirty = note !== (job.note ?? "");
  useNavigationBlocker(dirty);
  return <form className="space-y-3 rounded-lg border border-border bg-surface p-4" onSubmit={event => {
    event.preventDefault();
    void action.run(async () => {
      await productionApi(`${path}/note`, { method: "PATCH", body: { note } });
      onSaved();
    });
  }}>
    <label className="block font-semibold" htmlFor="public-correction-note">{text("Review note", "订正笔记")}</label>
    <textarea id="public-correction-note" className={textarea} rows={4} required maxLength={8000} value={note} onChange={event => setNote(event.target.value)} />
    <Feedback action={action} />
    <Button type="submit" disabled={action.busy || !dirty || !note.trim()}>{text("Save note", "保存笔记")}</Button>
  </form>;
}
