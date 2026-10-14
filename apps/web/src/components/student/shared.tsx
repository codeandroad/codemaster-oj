"use client";

import { AppLink } from "@/components/navigation";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/page-chrome";
import { apiMessage, isPending, productionApi, type Submission, type SubmissionLanguage } from "@/lib/production-api";
import { CodeTokens } from "./code-editor";
import { MathContent } from "@/components/math-content";

export const panel = "rounded-lg border border-border bg-surface p-5";
export const input = "h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";
export const textarea = "w-full rounded-md border border-input bg-background p-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";
export const date = (value?: string | null) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "—";
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
  return { busy, error, message, run, success: setMessage };
}
export function Feedback({ action }: { action: ReturnType<typeof useMutation> }) {
  return <>{action.error && <p role="alert" className="mt-3 border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{action.error}</p>}{action.message && <p role="status" className="mt-3 text-sm text-success">{action.message}</p>}</>;
}
export function State({ data, children, empty }: { data: { loading: boolean; error: string; reload: () => void; data?: unknown }; children: ReactNode; empty?: string }) {
  if (data.loading && !data.data) return <p role="status" className="mt-5 border border-border bg-surface p-5 text-sm text-muted-foreground">正在加载…</p>;
  if (data.error) return <div role="alert" className="mt-5 border border-destructive/25 bg-surface p-5"><p className="text-sm text-destructive">{data.error}</p><Button variant="secondary" className="mt-3" onClick={data.reload}>重新加载</Button></div>;
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
export function kindLabel(kind: string) { return kind === "submit" ? "正式提交" : kind === "correction" ? "订正" : kind === "samples" ? "公开样例自测" : "自定义输入自测"; }
export function ResultScore({ result }: { result: Submission }) {
  const status = result.kind === "samples" && result.status === "AC" ? "样例全部通过" : result.kind === "samples" && result.status === "WA" ? "样例输出不符" : result.kind === "custom" && result.status === "AC" ? "执行完成" : result.status;
  return <div className="flex flex-wrap items-center gap-2"><StatusPill status={status}/>{!isPending(result.status) && result.score != null && !/system.?error/i.test(result.status) && ["submit", "correction"].includes(result.kind) && <b>{Number(result.score).toFixed(2)} / 100</b>}</div>;
}
export interface DetailedSubmission extends Submission {
  reviews?: { id: string; note: string; authorName: string; authorIdentityId?: string; createdAt: string }[];
  testResults?: { position: number; status: string; timeMs?: number | null; memoryKb?: number | null }[];
  resultsVisible?: boolean;
}
export function useSubmission(id: string | null) {
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
        else if (isPending(next.status)) setError("仍在队列中，自动刷新已暂停，请手动刷新或稍后返回。");
      } catch (reason) { if (!controller.signal.aborted) setError(apiMessage(reason)); }
    }; void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [id, revision]);
  return { result, error, reload };
}
export function ResultPanel({ result, error, reload }: ReturnType<typeof useSubmission>) {
  return <div aria-live="polite" className="space-y-3">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{result ? <><ResultScore result={result}/><p className="text-xs text-muted-foreground">{kindLabel(result.kind)} · {isPending(result.status) ? "已接收，等待有效评测结果。" : result.kind === "custom" ? "仅展示程序输出，未判断正确性。" : result.passed == null || result.total == null ? "结果尚未公布，不表示零分。" : `${result.passed} / ${result.total} 组测试通过`}</p>{result.message && <p className="whitespace-pre-wrap break-words text-sm">{result.message}</p>}{result.publicOutput != null && <div><h3 className="text-xs font-semibold">公开测试输出</h3><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border border-border bg-surface-subtle p-3 text-xs">{result.publicOutput}</pre></div>}</> : <p className="text-sm text-muted-foreground">{error ? "未能加载结果。" : "尚未运行。"}</p>}{(result && isPending(result.status)) || error ? <Button variant="secondary" onClick={reload}>刷新结果</Button> : null}</div>;
}
export function PythonTokens({ code }: { code: string }) {
  return <CodeTokens code={code} language="python"/>;
}
export function CodeBlock({ code, label, language = "python" }: { code: string; label?: string; language?: SubmissionLanguage }) {
  return <div className="min-w-0">{label && <div className="border-b border-border bg-surface-subtle px-4 py-2 text-xs font-semibold">{label}</div>}<div className="grid grid-cols-[42px_minmax(0,1fr)] bg-code py-4 font-mono text-sm leading-6 text-code-foreground"><div aria-hidden className="select-none border-r border-code-muted/20 pr-3 text-right text-code-muted">{code.split("\n").map((_, index) => <div key={index}>{index + 1}</div>)}</div><pre className="overflow-auto px-4"><CodeTokens code={code} language={language}/></pre></div></div>;
}
export function PythonEditor({ code, onChange, fontSize = 14 }: { code: string; onChange: (code: string) => void; fontSize?: number }) {
  const highlight = useRef<HTMLPreElement>(null), numbers = useRef<HTMLDivElement>(null);
  return <div className="grid min-h-0 grid-cols-[48px_minmax(0,1fr)] overflow-hidden bg-code font-mono text-sm leading-6"><div ref={numbers} aria-hidden className="select-none overflow-hidden border-r border-code-muted/20 py-4 pr-3 text-right text-code-muted">{Array.from({ length: Math.max(15, code.split("\n").length) }, (_, i) => <div key={i}>{i + 1}</div>)}</div><div className="relative min-h-[250px] min-w-0 lg:min-h-0"><pre ref={highlight} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre p-4 font-mono text-[14px] leading-6 text-code-foreground" style={{ tabSize: 4, fontSize }}><PythonTokens code={code + "\n"}/></pre><textarea aria-label="Python code editor" value={code} onChange={event => onChange(event.target.value)} onScroll={event => { if (highlight.current) { highlight.current.scrollTop = event.currentTarget.scrollTop; highlight.current.scrollLeft = event.currentTarget.scrollLeft; } if (numbers.current) numbers.current.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={event => { if (event.key !== "Tab") return; event.preventDefault(); const field = event.currentTarget; const start = field.selectionStart, end = field.selectionEnd; const insert = "    "; onChange(code.slice(0, start) + insert + code.slice(end)); requestAnimationFrame(() => field.setSelectionRange(start + insert.length, start + insert.length)); }} spellCheck={false} autoCapitalize="none" autoComplete="off" wrap="off" className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-4 font-mono text-[14px] leading-6 text-transparent caret-code-foreground outline-none selection:bg-primary/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" style={{ tabSize: 4, fontSize }}/></div></div>;
}
export function LessonContent({ content }: { content: string }) {
  return <MathContent content={content} renderCode={(text,language)=><CodeBlock code={text} language={language==="cpp"?"cpp":language==="js"||language==="javascript"?"javascript":"python"}/>}/>;
}
