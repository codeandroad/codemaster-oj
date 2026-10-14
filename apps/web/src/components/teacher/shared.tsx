"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useNavigationBlocker } from "@/components/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiMessage, productionApi } from "@/lib/production-api";

export const input =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary";
export const area =
  "w-full rounded-md border border-input bg-background p-3 text-sm leading-6 outline-none focus:border-primary";
export const panel = "rounded-lg border border-border bg-surface";
export const link = "font-semibold text-primary hover:underline";
export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (!path) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    setError("");
    productionApi<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(apiMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  return {
    data,
    setData,
    error,
    loading,
    reload: () => setRevision((x) => x + 1),
  };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return {
    busy,
    error,
    message,
    clear:()=>{setError("");setMessage("");},
    run: async (action: () => Promise<string | void>) => {
      if (busy) return;
      setBusy(true);
      setError("");
      setMessage("");
      try {
        setMessage((await action()) || "已保存。");
      } catch (cause) {
        setError(apiMessage(cause));
      } finally {
        setBusy(false);
      }
    },
  };
}
export function State({
  resource,
}: {
  resource: { loading: boolean; error: string; reload: () => void };
}) {
  return resource.loading ? (
    <p role="status" className="mt-4 text-sm text-muted-foreground">
      正在加载…
    </p>
  ) : resource.error ? (
    <div
      role="alert"
      className="mt-4 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {resource.error}
      <Button
        variant="secondary"
        size="sm"
        className="ml-3"
        onClick={resource.reload}
      >
        重试
      </Button>
    </div>
  ) : null;
}
export function Feedback({
  action,
}: {
  action: { error: string; message: string };
}) {
  return (
    <>
      {action.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {action.error}
        </p>
      )}
      {action.message && (
        <p role="status" className="mt-3 text-sm text-success">
          {action.message}
        </p>
      )}
    </>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm font-semibold">
      <span>{label}</span>
      <span className="mt-2 block font-normal">{children}</span>
    </label>
  );
}
export function Tabs({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (value: string) => void;
  items: string[];
}) {
  return (
    <div
      className="mt-5 flex overflow-x-auto border-b border-border"
      role="tablist"
    >
      {items.map((item) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === item}
          key={item}
          onClick={() => onChange(item)}
          className={`h-11 shrink-0 border-b-2 px-5 text-sm font-semibold ${value === item ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className={`max-h-[90dvh] overflow-y-auto rounded-md border-border bg-surface p-0 gap-0 ${wide ? "max-w-3xl" : "max-w-xl"}`}
      >
        <div className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-base font-bold">{title}</DialogTitle>
        </div>
        <div className="min-w-0 p-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
export function Drawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="left-auto right-0 top-0 flex h-dvh w-full max-w-2xl translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-l border-border bg-surface p-0 sm:rounded-none"
      >
        <div className="border-b border-border p-5 pr-12">
          <DialogTitle className="text-base font-bold">{title}</DialogTitle>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
export function Table({
  headers,
  children,
  min = 850,
}: {
  headers: string[];
  children: ReactNode;
  min?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth: min }}>
        <thead className="bg-surface-subtle text-xs text-muted-foreground">
          <tr>
            {headers.map((header, i) => (
              <th className="px-4 py-3" key={`${header}-${i}`} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-border [&_td]:px-4 [&_td]:py-3">
          {children}
        </tbody>
      </table>
    </div>
  );
}
export function Empty({
  children,
  columns = 1,
}: {
  children: ReactNode;
  columns?: number;
}) {
  return (
    <tr>
      <td colSpan={columns} className="py-10 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
export function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <section className={`${panel} p-4`}>
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}
export function date(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}
export function localInput(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function move<T>(items: T[], index: number, direction: number) {
  const next = [...items];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

export function useDirty(dirty: boolean) {
  useNavigationBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}
