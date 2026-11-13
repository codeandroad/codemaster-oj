"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusPill } from "@/components/page-chrome";
import { apiMessage, isPending, productionApi, type Submission, type SubmissionLanguage } from "@/lib/production-api";
import type { ResultCase } from "./result-feedback";
export { RunResultPanel as ResultPanel } from "./run-result-panel";
import { CodeTokens } from "./code-editor";
import { MathContent } from "@/components/math-content";
import {useLocale,type AppLocale} from "@/components/locale-context";

function ui(locale:AppLocale,zh:string,en:string){return locale==="en"?en:zh;}

export { panel, input, textarea, date, shortId, useRefreshOnReturn, useData, useMutation, Feedback, State, Empty, Tabs, kindLabel } from "./data-state";

export function ResultScore({ result }: { result: Submission }) {
  const {locale}=useLocale();
  const status = result.kind === "samples" && result.status === "AC" ? ui(locale,"样例全部通过","All samples passed") : result.kind === "samples" && result.status === "WA" ? ui(locale,"样例输出不符","Sample output mismatch") : result.kind === "custom" && result.status === "AC" ? ui(locale,"执行完成","Execution complete") : result.status;
  return <div className="flex flex-wrap items-center gap-2"><StatusPill status={status}/>{!isPending(result.status) && result.score != null && !/system.?error/i.test(result.status) && ["submit", "correction"].includes(result.kind) && <b>{Number(result.score).toFixed(2)} / 100</b>}</div>;
}
export interface DetailedSubmission extends Submission {
  preview?: boolean;
  practicePointsAwarded?: number;
  runtimeMs?: number | null;
  memoryKb?: number | null;
  reviews?: { id: string; note: string; authorName: string; authorIdentityId?: string; teacherFeedback?: boolean; createdAt: string }[];
  testResults?: ResultCase[];
  resultsVisible?: boolean;
}
export function useSubmission(id: string | null, endpoint?: string, normalize?: (result: DetailedSubmission) => DetailedSubmission) {
  const {locale}=useLocale();
  const localeRef=useRef(locale);
  useEffect(()=>{localeRef.current=locale;},[locale]);
  const [result, setResult] = useState<DetailedSubmission | null>(null), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!id) { setResult(null); setError(""); return; }
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let polls = 0;
    setResult(null); setError("");
    const poll = async () => {
      try {
        const raw = await productionApi<DetailedSubmission>(endpoint ?? `submissions/${encodeURIComponent(id)}`, { signal: controller.signal });
        const next = normalize ? normalize(raw) : raw;
        if (controller.signal.aborted) return;
        setResult(next);
        if (isPending(next.status) && ++polls < 120) timer = setTimeout(poll, 1500);
        else if (isPending(next.status)) setError(ui(localeRef.current,"仍在队列中，自动刷新已暂停，请手动刷新或稍后返回。","Still queued. Automatic refresh has paused; refresh manually or return later."));
      } catch (reason) { if (!controller.signal.aborted) setError(apiMessage(reason)); }
    }; void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [id, revision, endpoint, normalize]);
  return { result, error, reload };
}
export function PythonTokens({ code }: { code: string }) {
  return <CodeTokens code={code} language="python"/>;
}
export function CodeBlock({ code, label, language = "python" }: { code: string; label?: string; language?: SubmissionLanguage }) {
  return <div className="min-w-0">{label && <div className="border-b border-border bg-surface-subtle px-4 py-2 text-xs font-semibold">{label}</div>}<div className="grid grid-cols-[42px_minmax(0,1fr)] bg-code py-4 font-mono text-sm leading-6 text-code-foreground"><div aria-hidden className="select-none border-r border-code-muted/20 pr-3 text-right text-code-muted">{code.split("\n").map((_, index) => <div key={index}>{index + 1}</div>)}</div><pre className="overflow-auto px-4"><CodeTokens code={code} language={language}/></pre></div></div>;
}
export function PythonEditor({ code, onChange, fontSize = 14 }: { code: string; onChange: (code: string) => void; fontSize?: number }) {
  const {locale}=useLocale();
  const highlight = useRef<HTMLPreElement>(null), numbers = useRef<HTMLDivElement>(null);
  return <div className="grid min-h-0 grid-cols-[48px_minmax(0,1fr)] overflow-hidden bg-code font-mono text-sm leading-6"><div ref={numbers} aria-hidden className="select-none overflow-hidden border-r border-code-muted/20 py-4 pr-3 text-right text-code-muted">{Array.from({ length: Math.max(15, code.split("\n").length) }, (_, i) => <div key={i}>{i + 1}</div>)}</div><div className="relative min-h-[250px] min-w-0 lg:min-h-0"><pre ref={highlight} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre p-4 font-mono text-[14px] leading-6 text-code-foreground" style={{ tabSize: 4, fontSize }}><PythonTokens code={code + "\n"}/></pre><textarea aria-label={ui(locale,"Python 代码编辑器","Python code editor")} value={code} onChange={event => onChange(event.target.value)} onScroll={event => { if (highlight.current) { highlight.current.scrollTop = event.currentTarget.scrollTop; highlight.current.scrollLeft = event.currentTarget.scrollLeft; } if (numbers.current) numbers.current.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={event => { if (event.key !== "Tab") return; event.preventDefault(); const field = event.currentTarget; const start = field.selectionStart, end = field.selectionEnd; const insert = "    "; onChange(code.slice(0, start) + insert + code.slice(end)); requestAnimationFrame(() => field.setSelectionRange(start + insert.length, start + insert.length)); }} spellCheck={false} autoCapitalize="none" autoComplete="off" wrap="off" className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-4 font-mono text-[14px] leading-6 text-transparent caret-code-foreground outline-none selection:bg-primary/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" style={{ tabSize: 4, fontSize }}/></div></div>;
}
export function LessonContent({ content, preserveHeadingLevels = false, compact = false, language }: { content: string; preserveHeadingLevels?: boolean; compact?: boolean; language?: "en" | "zh" }) {
  return <MathContent content={content} language={language} preserveHeadingLevels={preserveHeadingLevels} compact={compact} renderCode={(text,language)=><CodeBlock code={text} language={language==="cpp"?"cpp":language==="js"||language==="javascript"?"javascript":"python"}/>}/>;
}
