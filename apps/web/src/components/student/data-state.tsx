"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, apiConnectionMessage, apiMessage, apiRequestTimeoutMs, isApiConnectionError, productionApi } from "@/lib/production-api";
import { useLocale, type AppLocale } from "@/components/locale-context";

function ui(locale: AppLocale, zh: string, en: string) { return locale === "en" ? en : zh; }

export const panel = "rounded-lg border border-border bg-surface p-5";
export const input = "h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";
export const textarea = "w-full rounded-md border border-input bg-background p-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";
export const date = (value?: string | null, locale:AppLocale="en") => value ? new Intl.DateTimeFormat(locale==="en"?"en-US":"zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "—";
export const shortId = (value: string) => value.startsWith("SUB") ? value : value.slice(0, 8);
export function useRefreshOnReturn() {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(current => current + 1), []);
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame || document.visibilityState !== "visible" || navigator.onLine === false) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
    };
    window.addEventListener("focus", schedule);
    window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [refresh]);
  return { version, refresh };
}
export function useData<T>(path: string, refreshVersion = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!path) { setLoading(false); setData(null); setError(""); setConnectionError(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(""); setConnectionError(false);
    productionApi<T>(path, { signal: controller.signal, timeoutMs: apiRequestTimeoutMs })
      .then(next => { if (!controller.signal.aborted) { setData(next); setError(""); setConnectionError(false); } })
      .catch(reason => {
        if (controller.signal.aborted) return;
        const isConn = isApiConnectionError(reason);
        setConnectionError(isConn);
        setError(apiMessage(reason));
        if (reason instanceof ApiError && (reason.status === 403 || reason.status === 404)) setData(null);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, revision, refreshVersion]);
  useEffect(() => {
    if (!path || (!connectionError && !loading)) return;
    const recover = () => reload();
    window.addEventListener("online", recover);
    return () => window.removeEventListener("online", recover);
  }, [path, connectionError, loading, reload]);
  return { data, loading, error, connectionError, reload };
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
export function State({ data, children, empty }: { data: { loading: boolean; error: string; connectionError?: boolean; reload: () => void; data?: unknown }; children: ReactNode; empty?: string }) {
  const {locale}=useLocale();
  const connectionMessage = ui(locale, apiConnectionMessage, "Couldn’t connect to the service. Check your connection and try again.");
  if (data.loading && !data.data) return <p role="status" className="mt-5 border border-border bg-surface p-5 text-sm text-muted-foreground">{ui(locale,"正在加载…","Loading…")}</p>;
  const keepContent = Boolean(data.connectionError && data.data != null);
  const errorBox = data.error ? <div role="alert" className="mt-5 border border-destructive/25 bg-surface p-5">
    <p className="text-sm text-destructive">
      {data.connectionError ? connectionMessage : data.error}
      {keepContent && <> {ui(locale, "当前显示上次加载的内容。", "Showing the last loaded content.")}</>}
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="secondary" disabled={data.loading} onClick={data.reload}>
        {data.loading ? ui(locale, "正在重试…", "Retrying…") : ui(locale, data.connectionError ? "重试" : "重新加载", data.connectionError ? "Retry" : "Reload")}
      </Button>
      {data.connectionError && <Button type="button" variant="ghost" onClick={() => window.location.reload()}>
        {ui(locale, "刷新整个页面", "Refresh page")}
      </Button>}
    </div>
  </div> : null;
  if (data.error && !keepContent) return errorBox;
  if (empty) return <>{errorBox}<Empty title={empty} /></>;
  return <>{errorBox}{children}</>;
}
export function Empty({ title, description }: { title: string; description?: string }) {
  return <div className="mt-4 flex min-h-56 flex-col items-center justify-center border border-border bg-surface p-6 text-center"><h2 className="font-bold">{title}</h2>{description && <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}</div>;
}
export function Tabs({ items, value, onChange, label }: { items: string[]; value: string; onChange: (value: string) => void; label: string }) {
  return <div role="tablist" aria-label={label} className="mt-5 flex overflow-x-auto border-b border-border">{items.map(item => <button type="button" role="tab" key={item} aria-selected={value === item} onClick={() => onChange(item)} className={`h-10 shrink-0 border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${value === item ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>{item}</button>)}</div>;
}
export function kindLabel(kind: string, locale:AppLocale="en") { return kind === "submit" ? ui(locale,"正式提交","Formal submission") : kind === "correction" ? ui(locale,"订正","Correction") : kind === "samples" ? ui(locale,"公开样例自测","Public sample run") : ui(locale,"自定义输入自测","Custom input run"); }
