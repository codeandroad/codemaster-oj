"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import { date, Feedback, Field, input, useAction } from "./shared";

export function CancelAssignment({ path, title, onSaved }: { path: string; title: string; onSaved: () => void }) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [open, setOpen] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const action = useAction();

  return <Dialog open={open} onOpenChange={next => {
    if (action.busy) return;
    action.clear();
    setOpen(next);
  }}>
    <DialogTrigger asChild><Button size="sm" variant="outline" className="text-destructive">{text("取消作业", "Cancel assignment")}</Button></DialogTrigger>
    <DialogContent onOpenAutoFocus={event => { event.preventDefault(); keep.current?.focus(); }}>
      <DialogTitle>{text(`取消「${title}」？`, `Cancel “${title}”?`)}</DialogTitle>
      <DialogDescription>{text(
        "取消后将停止接收提交，并向所有仍在这份作业名单中的学生发送站内通知。已有提交和成绩会保留。",
        "The assignment will stop accepting submissions. All students still assigned this work will receive an in-app notification. Existing submissions and grades will be kept.",
      )}</DialogDescription>
      <Feedback action={action}/>
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={keep} variant="secondary" disabled={action.busy} onClick={() => setOpen(false)}>{text("保留作业", "Keep assignment")}</Button>
        <Button variant="destructive" disabled={action.busy} onClick={() => void action.run(async () => {
          await productionApi(`${path}/cancel`, { method: "POST", body: {} });
          setOpen(false);
          onSaved();
        })}>{text("确认取消并通知", "Cancel and notify")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

export type AssignmentParticipant = { identityId: string; name: string; number?: string; exempt: boolean; dueAt: string | null };

export function AssignmentParticipantForm({ path, participants, toDeadline, onSaved }: {
  path: string;
  participants: AssignmentParticipant[];
  toDeadline: (value: string) => string | null;
  onSaved: () => void;
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  const [selected, setSelected] = useState("");
  const [operation, setOperation] = useState<"extend" | "exempt">("exempt");
  const participant = participants.find(item => item.identityId === selected);
  const canExtend = Boolean(participant?.dueAt && !participant.exempt);
  const extending = canExtend && operation === "extend";
  const action = useAction();

  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault();
    if (!participant) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    void action.run(async () => {
      const change = extending ? { dueAt: toDeadline(String(fields.get("dueAt"))) } : { exempt: !participant.exempt };
      await productionApi(`${path}/participants/${participant.identityId}`, {
        method: "PATCH",
        body: { ...change, reason: fields.get("reason") },
      });
      form.reset();
      setOperation("exempt");
      onSaved();
      return text("已更新并通知该学生。", "Changes saved and student notified.");
    });
  }}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={text("学生", "Student")}>
        <select className={input} required value={selected} disabled={action.busy} onChange={event => {
          setSelected(event.target.value);
          setOperation("exempt");
          action.clear();
        }}>
          <option value="">{text("选择学生", "Select a student")}</option>
          {participants.map(item => <option key={item.identityId} value={item.identityId}>
            {item.number ? `${item.name} · ${item.number}` : item.name}
          </option>)}
        </select>
      </Field>
      {participant && <Field label={text("操作", "Action")}>
        <select className={input} value={extending ? "extend" : "exempt"} disabled={action.busy}
          onChange={event => setOperation(event.target.value === "extend" ? "extend" : "exempt")}>
          <option value="exempt">{participant.exempt ? text("恢复参与", "Reinstate student") : text("豁免本次作业", "Exempt student")}</option>
          {canExtend && <option value="extend">{text("延长个人截止时间", "Extend individual deadline")}</option>}
        </select>
      </Field>}
      {extending && <Field label={text("新的截止时间", "New deadline")}>
        <input name="dueAt" type="datetime-local" required className={input}/>
      </Field>}
      {participant && <Field label={text("变更原因（学生可见）", "Reason (visible to the student)")}>
        <input name="reason" required maxLength={2000} className={input}/>
      </Field>}
    </div>
    {participant && <>
      <p className="text-sm text-muted-foreground">{participant.exempt ? text("已豁免", "Exempt") : text("参与中", "Assigned")} · {text("当前截止", "Current deadline")} {date(participant.dueAt)}</p>
      <Button variant="secondary" disabled={action.busy}>{text("保存并通知学生", "Save and notify student")}</Button>
    </>}
    <Feedback action={action}/>
  </form>;
}
