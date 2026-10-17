"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Send } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useData } from "@/components/student/shared";
import { StudentAudienceSelector } from "@/components/teacher/student-audience-selector";
import { audienceClassIds, type AudienceDirectory } from "@/components/teacher/student-audience";
import { apiMessage, productionApi } from "@/lib/production-api";
import type { Paper4Paper, Paper4PaperSummary } from "./model";
import { paper4ActivityInput, paper4BatchActivityInput } from "./paper4-activity-input";

const input = "mt-1.5 min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60";

export function Paper4AssignDialog({ paper, papers, onClose, onCreated }: {
  paper?: Paper4Paper | Paper4PaperSummary;
  papers?: (Paper4Paper | Paper4PaperSummary)[];
  onClose: () => void;
  onCreated: (activities: Paper4Paper[]) => void;
}) {
  const sources = papers ?? (paper ? [paper] : []);
  const batch = Boolean(papers);
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const audience = useData<AudienceDirectory>("teaching/audience");
  const [kind, setKind] = useState<"practice" | "exam">("practice");
  const [participants, setParticipants] = useState<string[]>([]);
  const [title, setTitle] = useState(paper?.title ?? "");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const messages: Record<string, string> = {
    ACTIVITY_PAPERS: tx("请选择 1–100 套不同的已公开试卷。", "Choose 1–100 different public papers."),
    ACTIVITY_TITLE: tx("请填写不超过 200 字的活动名称。", "Enter an activity title of up to 200 characters."),
    ACTIVITY_AUDIENCE: tx("请至少选择一名学生。", "Select at least one student."),
    ACTIVITY_AUDIENCE_LIMIT: tx("每次最多选择 500 名学生。", "Select up to 500 students."),
    ACTIVITY_EXAM_WINDOW: tx("模拟考试须设置开始和结束时间。", "Set both start and end times for a mock exam."),
    ACTIVITY_TIME: tx("请填写有效的时间。", "Enter a valid date and time."),
    ACTIVITY_WINDOW_ORDER: tx("结束时间须晚于开始时间。", "The end must be later than the start."),
    ACTIVITY_WINDOW_ENDED: tx("结束时间须晚于当前时间。", "The end must be in the future."),
  };
  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    try {
      const classIds = audienceClassIds(audience.data?.items ?? [], participants, audience.data?.classes.filter(item => item.canAssociate).map(item => item.id) ?? []);
      const common = { activityKind: kind, participants, classIds, startsAt, endsAt };
      const body = batch ? paper4BatchActivityInput(sources.map(item => item.id), common) : paper4ActivityInput({ ...common, title });
      if (!sources.length) throw new Error("ACTIVITY_PAPERS");
      setBusy(true);
      if (batch) {
        const result = await productionApi<{ count: number; items: Paper4Paper[] }>("paper4/papers/batch-activities", { method: "POST", body });
        onCreated(result.items);
      } else {
        const activity = await productionApi<Paper4Paper>(`paper4/papers/${encodeURIComponent(sources[0]!.id)}/activities`, { method: "POST", body });
        onCreated([activity]);
      }
    } catch (reason) { setError(reason instanceof Error && messages[reason.message] ? messages[reason.message] : apiMessage(reason)); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
    <DialogTitle>{batch ? tx("批量布置 Paper 4 活动", "Assign Paper 4 papers") : tx("布置 Paper 4 活动", "Assign a Paper 4 activity")}</DialogTitle><DialogDescription>{batch ? tx(`将 ${sources.length} 套试卷统一布置给所选学生，每套试卷独立保存答卷。`, `Assign ${sources.length} papers to the same selected students. Each paper keeps its own attempts.`) : paper?.title}</DialogDescription>
    <form onSubmit={event => void assign(event)} className="space-y-4" aria-busy={busy}>
      {error && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-md bg-destructive/5 p-3 text-sm text-destructive focus-visible:outline-2 focus-visible:outline-destructive">{error}</p>}
      {batch && <ul className="max-h-28 overflow-y-auto rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm">{sources.map(item => <li key={item.id} className="py-1">{item.title}</li>)}</ul>}
      <div className={`grid gap-4 ${batch ? "sm:grid-cols-2" : "sm:grid-cols-[minmax(180px,1fr)_minmax(0,2fr)]"}`}><label className="block text-sm font-semibold">{tx("活动类型", "Activity type")}<select className={input} value={kind} disabled={busy} onChange={event => setKind(event.target.value as "practice" | "exam")}><option value="practice">{tx("练习任务", "Practice task")}</option><option value="exam">{tx("模拟考试", "Mock exam")}</option></select></label>{!batch && <label className="block text-sm font-semibold">{tx("活动名称", "Activity title")}<input required maxLength={200} className={input} value={title} disabled={busy} onChange={event => setTitle(event.target.value)}/></label>}</div>
      <StudentAudienceSelector students={audience.data?.items ?? []} classes={audience.data?.classes ?? []} selectedIds={participants} onChange={setParticipants} loading={audience.loading} error={audience.error} onReload={audience.reload} disabled={busy}/>
      <div className="grid gap-4 sm:grid-cols-2"><label className="block min-w-0 text-sm font-semibold">{tx("开始时间", "Starts at")}{kind === "practice" && <span className="ml-1 font-normal text-muted-foreground">{tx("可选", "Optional")}</span>}<input required={kind === "exam"} type="datetime-local" className={input} disabled={busy} value={startsAt} onChange={event => setStartsAt(event.target.value)}/></label><label className="block min-w-0 text-sm font-semibold">{tx("结束时间", "Ends at")}{kind === "practice" && <span className="ml-1 font-normal text-muted-foreground">{tx("可选", "Optional")}</span>}<input required={kind === "exam"} type="datetime-local" min={startsAt || undefined} className={input} disabled={busy} value={endsAt} onChange={event => setEndsAt(event.target.value)}/></label></div>
      <p className="text-xs leading-5 text-muted-foreground">{tx("北京时间（UTC+8）。仅所选学生收到此活动，不要求加入班级；公开题库中的自由练习保持开放。同一道大题只奖励一次积分。", "Times use Asia/Shanghai (UTC+8). Only selected students receive this activity; class membership is not required. Public free practice stays open. Each question awards points once.")}</p>
      <DialogFooter><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>{tx("取消", "Cancel")}</Button><Button type="submit" disabled={busy || audience.loading || Boolean(audience.error) || !participants.length}>{busy ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/> : <Send size={16} aria-hidden="true"/>}{busy ? tx("正在布置…", "Assigning…") : batch ? tx(`布置 ${sources.length} 套 · ${participants.length} 名学生`, `Assign ${sources.length} papers · ${participants.length} students`) : tx(`布置给 ${participants.length} 名学生`, `Assign to ${participants.length} students`)}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
