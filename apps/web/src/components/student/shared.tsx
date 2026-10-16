"use client";

import { AppLink } from "@/components/navigation";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/page-chrome";
import { apiMessage, isPending, productionApi, type Submission, type SubmissionLanguage } from "@/lib/production-api";
import { CodeTokens } from "./code-editor";
import { MathContent } from "@/components/math-content";
import {useLocale,type AppLocale} from "@/components/locale-context";

function ui(locale:AppLocale,zh:string,en:string){return locale==="en"?en:zh;}

export const panel = "rounded-lg border border-border bg-surface p-5";
export const input = "h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";
export const textarea = "w-full rounded-md border border-input bg-background p-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";
export const date = (value?: string | null, locale:AppLocale="zh") => value ? new Intl.DateTimeFormat(locale==="en"?"en-US":"zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "—";
export const shortId = (value: string) => value.startsWith("SUB") ? value : value.slice(0, 8);
export function useData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!path) { setLoading(false); setData(null); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    productionApi<T>(path, { signal: controller.signal }).then(next => { if (!controller.signal.aborted) setData(next); }).catch(reason => { if (!controller.signal.aborted) setError(apiMessage(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision]);
  return { data, loading, error, reload };
}
export function useMutation() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function run(operation: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (reason) { setError(apiMessage(reason)); } finally { setBusy(false); }
  }
  return { busy, error, message, run, success: setMessage, reset: () => { setError(""); setMessage(""); } };
}
export function Feedback({ action }: { action: ReturnType<typeof useMutation> }) {
  return <>{action.error && <p role="alert" className="mt-3 border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{action.error}</p>}{action.message && <p role="status" className="mt-3 text-sm text-success">{action.message}</p>}</>;
}
export function State({ data, children, empty }: { data: { loading: boolean; error: string; reload: () => void; data?: unknown }; children: ReactNode; empty?: string }) {
  const {locale}=useLocale();
  if (data.loading && !data.data) return <p role="status" className="mt-5 border border-border bg-surface p-5 text-sm text-muted-foreground">{ui(locale,"正在加载…","Loading…")}</p>;
  if (data.error) return <div role="alert" className="mt-5 border border-destructive/25 bg-surface p-5"><p className="text-sm text-destructive">{data.error}</p><Button variant="secondary" className="mt-3" onClick={data.reload}>{ui(locale,"重新加载","Reload")}</Button></div>;
  if (empty) return <Empty title={empty} />;
  return <>{children}</>;
}
export function Empty({ title, description }: { title: string; description?: string }) {
  return <div className="mt-4 flex min-h-56 flex-col items-center justify-center border border-border bg-surface p-6 text-center"><h2 className="font-bold">{title}</h2>{description && <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}</div>;
}
export function Tabs({ items, value, onChange, label }: { items: string[]; value: string; onChange: (value: string) => void; label: string }) {
  return <div role="tablist" aria-label={label} className="mt-5 flex overflow-x-auto border-b border-border">{items.map(item => <button type="button" role="tab" key={item} aria-selected={value === item} onClick={() => onChange(item)} className={`h-10 shrink-0 border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${value === item ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>{item}</button>)}</div>;
}
export function Back({ href, children }: { href: string; children: ReactNode }) { return <AppLink href={href} className="mb-4 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">← {children}</AppLink>; }
export function kindLabel(kind: string, locale:AppLocale="zh") { return kind === "submit" ? ui(locale,"正式提交","Formal submission") : kind === "correction" ? ui(locale,"订正","Correction") : kind === "samples" ? ui(locale,"公开样例自测","Public sample run") : ui(locale,"自定义输入自测","Custom input run"); }
export function ResultScore({ result }: { result: Submission }) {
  const {locale}=useLocale();
  const status = result.kind === "samples" && result.status === "AC" ? ui(locale,"样例全部通过","All samples passed") : result.kind === "samples" && result.status === "WA" ? ui(locale,"样例输出不符","Sample output mismatch") : result.kind === "custom" && result.status === "AC" ? ui(locale,"执行完成","Execution complete") : result.status;
  return <div className="flex flex-wrap items-center gap-2"><StatusPill status={status}/>{!isPending(result.status) && result.score != null && !/system.?error/i.test(result.status) && ["submit", "correction"].includes(result.kind) && <b>{Number(result.score).toFixed(2)} / 100</b>}</div>;
}
export interface DetailedSubmission extends Submission {
  reviews?: { id: string; note: string; authorName: string; authorIdentityId?: string; createdAt: string }[];
  testResults?: { position: number; status: string; timeMs?: number | null; memoryKb?: number | null }[];
  resultsVisible?: boolean;
}
export function useSubmission(id: string | null) {
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
        const next = await productionApi<DetailedSubmission>(`submissions/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult(next);
        if (isPending(next.status) && ++polls < 120) timer = setTimeout(poll, 1500);
        else if (isPending(next.status)) setError(ui(localeRef.current,"仍在队列中，自动刷新已暂停，请手动刷新或稍后返回。","Still queued. Automatic refresh has paused; refresh manually or return later."));
      } catch (reason) { if (!controller.signal.aborted) setError(apiMessage(reason)); }
    }; void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [id, revision]);
  return { result, error, reload };
}
export function ResultPanel({ result, error, reload }: ReturnType<typeof useSubmission>) {
  const {locale}=useLocale();
  return <div aria-live="polite" className="space-y-3">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{result ? <><ResultScore result={result}/><p className="text-xs text-muted-foreground">{kindLabel(result.kind,locale)} · {isPending(result.status) ? ui(locale,"已接收，等待有效评测结果。","Received; waiting for a valid judging result.") : result.kind === "custom" ? ui(locale,"仅展示程序输出，未判断正确性。","Output only; correctness was not evaluated.") : result.passed == null || result.total == null ? ui(locale,"结果尚未公布，不表示零分。","Result not yet published; this is not a zero.") : ui(locale,`${result.passed} / ${result.total} 组测试通过`,`${result.passed} / ${result.total} tests passed`)}</p>{result.message && <p className="whitespace-pre-wrap break-words text-sm">{result.message}</p>}{result.publicOutput != null && <div><h3 className="text-xs font-semibold">{ui(locale,"公开测试输出","Public test output")}</h3><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border border-border bg-surface-subtle p-3 text-xs">{result.publicOutput}</pre></div>}</> : <p className="text-sm text-muted-foreground">{error ? ui(locale,"未能加载结果。","Could not load result.") : ui(locale,"尚未运行。","Not run yet.")}</p>}{(result && isPending(result.status)) || error ? <Button variant="secondary" onClick={reload}>{ui(locale,"刷新结果","Refresh result")}</Button> : null}</div>;
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
export function LessonContent({ content, preserveHeadingLevels = false }: { content: string; preserveHeadingLevels?: boolean }) {
  return <MathContent content={content} preserveHeadingLevels={preserveHeadingLevels} renderCode={(text,language)=><CodeBlock code={text} language={language==="cpp"?"cpp":language==="js"||language==="javascript"?"javascript":"python"}/>}/>;
}
