"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { PageHeader } from "@/components/page-chrome";
import { buttonVariants } from "@/components/ui/button";
import { ContentEditor } from "@/components/scholarship/content-editor";
import type { AssistanceKind } from "@/components/scholarship/assistance";
import { Field, State, input, useData } from "@/components/teacher/shared";
import type { Paper4Paper } from "./model";

const keepVersion = () => {};

export function Paper4AssistanceEditor({ paper, onPendingChange }: {
  paper: Paper4Paper;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const search = useSearchParams();
  const [questionKey, setQuestionKey] = useState(search.get("questionKey") ?? paper.questions[0]?.key ?? "");
  const [kind, setKind] = useState<AssistanceKind>(search.get("kind") === "FULL_TRANSLATION" ? "FULL_TRANSLATION" : "FULL_SOLUTION");
  const [pending, setPending] = useState(false);
  const question = paper.questions.find(item => item.key === questionKey);
  const reportPending = useCallback((value: boolean) => {
    setPending(value);
    onPendingChange?.(value);
  }, [onPendingChange]);
  return <div className="space-y-4">
    <Field label={tx("选择大题", "Choose a question")}>
      <select className={input} value={question?.key ?? ""} disabled={pending} onChange={event => setQuestionKey(event.target.value)}>
        {!question && <option value="">{tx("请选择大题", "Choose a question")}</option>}
        {paper.questions.map(item => <option key={item.key} value={item.key}>{item.key} · {item.title}</option>)}
      </select>
    </Field>
    {!question && <p role="status" className="text-sm text-muted-foreground">{tx("链接中的大题不在此试卷版本中，请选择要编辑的大题。", "The linked question is not in this paper version. Choose the question to edit.")}</p>}
    {question && paper.versionId && <ContentEditor key={`${paper.id}:${paper.versionId}:${question.key}`}
      target={{ paperId: paper.id, versionId: paper.versionId, questionKey: question.key }}
      kind={kind} onKindChange={setKind} contentPending={pending} onPendingChange={reportPending} onVersionChange={keepVersion} />}
  </div>;
}

export function Paper4AssistancePage({ id, admin = false }: { id: string; admin?: boolean }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const search = useSearchParams();
  const versionId = search.get("versionId");
  const paper = useData<Paper4Paper>(`paper4/papers/${encodeURIComponent(id)}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""}`);
  return <div className="space-y-4">
    <PageHeader eyebrow="Paper 4" title={paper.data?.title ?? tx("题解与翻译", "Solutions and translations")}
      description={tx("按大题编辑学生可见内容，并在此审核发布。", "Edit student-facing content for each question, then review and publish it here.")}
      action={<AppLink href={admin ? "/admin/problem-banks" : "/teacher/paper4"} className={buttonVariants({ variant: "secondary" })}>{tx("返回题库", "Back to library")}</AppLink>} />
    <State resource={paper} />
    {!paper.loading && !paper.error && paper.data?.canManage && !paper.data.archivedAt && (!versionId || paper.data.versionId?.toLowerCase() === versionId.toLowerCase()) && <Paper4AssistanceEditor key={`${id}:${paper.data.versionId}:${search.get("questionKey") ?? "first"}:${search.get("kind") ?? "FULL_SOLUTION"}`} paper={paper.data} />}
    {paper.data && (!paper.data.canManage || paper.data.archivedAt) && <p className="text-sm text-muted-foreground">{tx("此试卷目前不可编辑。", "This paper is currently read-only.")}</p>}
  </div>;
}
