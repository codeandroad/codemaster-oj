"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { apiMessage, productionApi } from "@/lib/production-api";
import { coursePaper4LinkKey, type CoursePaper4Link } from "@/components/course-paper4";
import { paper4ShortTitle, type Paper4Paper, type Paper4PaperSummary } from "@/components/paper4/model";
import { input } from "./shared";

export function CoursePaper4Picker({existing, onClose, onAdd}: {
  existing: CoursePaper4Link[];
  onClose: () => void;
  onAdd: (links: CoursePaper4Link[]) => void;
}) {
  const {locale} = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [papers, setPapers] = useState<Paper4PaperSummary[] | null>(null);
  const [paperId, setPaperId] = useState("");
  const [search, setSearch] = useState("");
  const [paper, setPaper] = useState<Paper4Paper | null>(null);
  const [scope, setScope] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void productionApi<{items: Paper4PaperSummary[]}>("paper4/papers?scope=catalog").then(value => {
      if (active) setPapers(value.items.filter(item => item.deliveryKind !== "activity" && item.status === "published" && !item.archivedAt));
    }).catch(reason => { if (active) setError(apiMessage(reason)); });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => {
    setPaper(null); setSelected([]); setScope("all");
    if (!paperId) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    void productionApi<Paper4Paper>(`paper4/papers/${encodeURIComponent(paperId)}?view=current`).then(value => {
      if (!active) return;
      if (value.status !== "published" || value.archivedAt || value.deliveryKind === "activity" || !value.versionId) throw new Error(tx("试卷尚未公开或已不可用。", "This paper is not public or is unavailable."));
      setPaper(value);
    }).catch(reason => { if (active) setError(apiMessage(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // Locale changes only affect future errors; they must not discard the current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, retry]);
  const query = search.trim().toLocaleLowerCase();
  const matches = papers?.filter(item => item.id === paperId || `${item.title} ${paper4ShortTitle(item)} ${item.examYear ?? ""}`.toLocaleLowerCase().includes(query)) ?? [];
  const wholeExists = Boolean(paper && existing.some(link => link.paperId === paper.id && link.versionId === paper.versionId && link.questionKey === null));
  const linkedKeys = new Set(existing.map(coursePaper4LinkKey));
  const selectable = paper?.questions.filter(question => !wholeExists && !linkedKeys.has(`${paper.id}:${paper.versionId}:${question.key}`)) ?? [];
  const selectedQuestions = paper ? (scope === "all" ? paper.questions : paper.questions.filter(question => selected.includes(question.key))) : [];
  const canAdd = Boolean(paper && !loading && !wholeExists && selectedQuestions.length);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
    <DialogTitle>{tx("关联 Paper 4 练习", "Link Paper 4 practice")}</DialogTitle>
    <DialogDescription>{tx("选择整套已公开试卷，或指定其中的大题。关联版本会固定保存，正式 AC 自动计入课程练习进度。", "Choose a public paper or individual questions. The published version is pinned; formal AC automatically counts toward course practice progress.")}</DialogDescription>
    <div className="space-y-4">
      <label className="block text-sm font-semibold">{tx("搜索试卷", "Search papers")}<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={tx("名称、年份或简写", "Title, year or short name")} className={`${input} mt-2`}/></label>
      <label className="block text-sm font-semibold">{tx("试卷", "Paper")}<select value={paperId} disabled={!papers} onChange={event => setPaperId(event.target.value)} className={`${input} mt-2`}><option value="">{papers ? tx("请选择试卷", "Choose a paper") : tx("正在加载试卷…", "Loading papers…")}</option>{matches.map(item => <option key={item.id} value={item.id}>{paper4ShortTitle(item)} · {item.title}</option>)}</select></label>
      {papers && !matches.length && <p className="text-sm text-muted-foreground">{tx("没有符合条件的公开试卷。", "No matching public papers.")}</p>}
      {loading && <p role="status" className="text-sm text-muted-foreground">{tx("正在读取大题…", "Loading questions…")}</p>}
      {error && <div role="alert" className="text-sm text-destructive">{error}<Button variant="secondary" size="sm" className="ml-2" onClick={() => setRetry(value => value + 1)}>{tx("重试", "Retry")}</Button></div>}
      {paper && <section className="rounded-md border border-border p-4">
        <p className="font-semibold">{paper.title}</p><p className="mt-1 text-xs text-muted-foreground">v{paper.versionNumber} · {paper.questions.length} {tx("道大题", "questions")}</p>
        <label className="mt-4 block text-sm font-semibold">{tx("关联范围", "Practice scope")}<select value={scope} onChange={event => { setScope(event.target.value); setSelected([]); }} className={`${input} mt-2`}><option value="all">{tx("整套试卷", "Whole paper")}</option><option value="questions">{tx("指定大题", "Selected questions")}</option></select></label>
        {scope === "all" ? <ul className="mt-3 space-y-2 text-sm text-muted-foreground">{paper.questions.map(question => <li key={question.key}>{question.key} · {question.title}</li>)}</ul> : <fieldset className="mt-3 space-y-2"><legend className="sr-only">{tx("选择大题", "Choose questions")}</legend>{paper.questions.map(question => { const enabled = selectable.some(item => item.key === question.key); return <label key={question.key} className={`flex min-h-11 items-start gap-3 rounded-md border border-border p-3 text-sm ${!enabled ? "text-muted-foreground" : "cursor-pointer"}`}><input className="mt-0.5 size-4 accent-primary" type="checkbox" disabled={!enabled} checked={!enabled || selected.includes(question.key)} onChange={event => setSelected(keys => event.target.checked ? [...keys, question.key] : keys.filter(key => key !== question.key))}/><span className="min-w-0 break-words">{question.key} · {question.title}{!enabled && <span className="ml-2 text-xs">{tx("已关联", "Already linked")}</span>}</span></label>; })}</fieldset>}
        {wholeExists && <p className="mt-3 text-sm text-muted-foreground">{tx("本章节已关联这套试卷的全部大题。", "All questions in this version are already linked in this chapter.")}</p>}
      </section>}
    </div>
    <DialogFooter><Button variant="secondary" onClick={onClose}>{tx("取消", "Cancel")}</Button><Button disabled={!canAdd} onClick={() => {
      if (!paper?.versionId || !canAdd) return;
      const common = {paperId: paper.id, versionId: paper.versionId, title: paper.title, shortTitle: paper4ShortTitle(paper), versionNumber: paper.versionNumber, available: true, readyForCourse: true, completed: false, completedQuestions: 0};
      onAdd(scope === "all" ? [{...common, questionKey: null, questionCount: paper.questions.length, questions: paper.questions.map(({key,title}) => ({key,title,completed:false}))}] : selectedQuestions.map(question => ({...common, questionKey: question.key, questionTitle: question.title, questionCount: 1, questions: [{key:question.key,title:question.title,completed:false}]})));
    }}>{scope === "all" ? tx("关联整套试卷", "Link whole paper") : tx(`关联 ${selectedQuestions.length} 道大题`, `Link ${selectedQuestions.length} questions`)}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
