"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardCheck, FileText } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import type { Paper4Paper } from "./model";
import { Paper4Content } from "./paper4-content";
import { paper4ExamLabel } from "./paper4-catalog";
import { Paper4AssignDialog } from "./paper4-assign-dialog";


export function Paper4CatalogPreview({ paper, pinnedVersion = false }: { paper: Paper4Paper; pinnedVersion?: boolean }) {
  const { locale } = useLocale();
  const router = useRouter();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [questionKey, setQuestionKey] = useState(paper.questions[0]?.key ?? "");
  const [assignOpen, setAssignOpen] = useState(false);
  const question = paper.questions.find(item => item.key === questionKey) ?? paper.questions[0];
  const examLabel = paper4ExamLabel(paper, locale);
  return <>
    <AppLink href="/teacher/paper4" className="mb-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary"><ArrowLeft size={16} aria-hidden="true"/>{tx("返回自由练习题库", "Back to practice library")}</AppLink>
    <PageHeader eyebrow={examLabel || tx("全校自由练习", "School-wide free practice")} title={paper.title} description={paper.description} action={!pinnedVersion && paper.canAssign && !paper.archivedAt ? <Button onClick={() => setAssignOpen(true)}><ClipboardCheck size={16} aria-hidden="true"/>{tx("布置活动", "Assign activity")}</Button> : undefined}/>
    {pinnedVersion && <p role="note" className="mt-4 rounded-md border border-border bg-surface-subtle px-4 py-3 text-sm"><strong>{tx("固定版本", "Pinned version")} · v{paper.versionNumber ?? "—"} · {tx("只读预览", "Read-only preview")}</strong><span className="mt-1 block text-muted-foreground">{tx("显示课程关联时保存的试卷版本。", "This is the paper version saved with the course link.")}</span></p>}
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground"><span>{paper.questions.length} {tx("道大题", "questions")}</span><span>{paper.totalMarks} {tx("分", "marks")}</span><span>{tx("全校可见 · 不限时间", "School-wide · No time limit")}</span></div>
    {question ? <section className="mt-4 overflow-hidden rounded-lg border border-border bg-surface panel-shadow">
      <nav aria-label={tx("选择大题", "Select question")} className="flex flex-wrap gap-1 border-b border-border bg-surface-subtle p-2">
        {paper.questions.map((item, index) => <button key={item.key} type="button" aria-pressed={question.key === item.key} onClick={() => setQuestionKey(item.key)} className={`min-h-11 rounded-md px-3 py-2 text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${question.key === item.key ? "bg-surface text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{index + 1}. {item.title}</button>)}
      </nav>
      <article className="min-w-0 p-5 sm:p-6">
        <h2 className="mb-4 text-xl font-bold">{question.title}</h2>
        <Paper4Content content={question.statement}/>
        {Object.keys(question.initialFiles).length > 0 && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground"><span className="font-semibold">{tx("配套文件", "Work files")}</span>{Object.keys(question.initialFiles).map(name => <span key={name} className="inline-flex items-center gap-1 rounded-md bg-surface-subtle px-2 py-1 font-mono"><FileText size={12} aria-hidden="true"/>{name}</span>)}</div>}
        <div className="mt-5 divide-y divide-border border-t border-border">
          {question.stages.map(stage => <section key={stage.id} className="py-4 last:pb-0"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{stage.title}</h3><span className="text-sm text-muted-foreground">{stage.maxMarks} {tx("分", "marks")} · {stage.judgeMode === "auto" ? tx("自动评测", "Auto") : stage.judgeMode === "evidence" ? tx("过程与证据", "Process and evidence") : tx("人工评分", "Teacher review")}</span></div>{stage.description && <Paper4Content content={stage.description}/>}</section>)}
        </div>
      </article>
    </section> : <p role="status" className="mt-4 text-sm text-muted-foreground">{tx("试卷暂无大题。", "This paper has no questions.")}</p>}
    {!pinnedVersion && assignOpen && <Paper4AssignDialog paper={paper} onClose={() => setAssignOpen(false)} onCreated={activities => { setAssignOpen(false); router.push(`/teacher/paper4/${activities[0]!.id}`); }}/> }
  </>;
}
