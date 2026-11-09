"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "../ui/button";

interface ActivityDraftOptions<T> {
  storageKey: string;
  snapshot: T;
  editable: boolean;
  hasChanges: (value: T) => boolean;
  recoveryDefaults?: Partial<T>;
  onRestore: (value: T) => void;
  published?: boolean;
}

export function useActivityDraft<T extends object>({
  storageKey, snapshot, editable, hasChanges, recoveryDefaults, onRestore, published,
}: ActivityDraftOptions<T>) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [recovery, setRecovery] = useState<T | null>(null);
  const [ready, setReady] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [localSave, setLocalSave] = useState<{ snapshot: string; failed: boolean } | null>(null);
  const dirty = editable && hasChanges(snapshot);
  const pending = ready && dirty && !recovery ? JSON.stringify(snapshot) : null;
  const latest = useRef<string | null>(null);
  const stored = useRef<{ raw: string; snapshot?: string } | null>(null);

  const clearStored = useCallback(() => {
    try {
      // Avoid removing a draft another tab wrote after this editor read or saved its copy.
      if (stored.current && localStorage.getItem(storageKey) === stored.current.raw) {
        localStorage.removeItem(storageKey);
      }
    } catch {}
    stored.current = null;
  }, [storageKey]);

  useEffect(() => {
    if (!editable) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const { snapshot: saved } = JSON.parse(raw);
        if (saved && typeof saved === "object" && !Array.isArray(saved)) {
          const value = { ...recoveryDefaults, ...saved };
          const shape = snapshot as Record<string, unknown>;
          if (Object.keys(shape).every(key => Array.isArray(shape[key])
            ? Array.isArray(value[key])
            : typeof value[key] === typeof shape[key] &&
              (typeof value[key] !== "number" || Number.isFinite(value[key]))) &&
            typeof value.title === "string" &&
            value.participants.every((id: unknown) => typeof id === "string") &&
            value.problems.every((problem: Record<string, unknown>) => problem &&
              typeof problem.problemId === "string" && typeof problem.title === "string" &&
              typeof problem.points === "number" && Number.isFinite(problem.points))) {
            stored.current = { raw };
            if (hasChanges(value as T)) setRecovery(value as T);
            else clearStored();
          }
        }
      }
    } catch {
      setReadFailed(true);
    }
    setReady(true);
    // Recovery is evaluated against the server data when the keyed editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, editable]);

  useEffect(() => {
    latest.current = pending;
    if (ready && editable && !dirty && !recovery) {
      clearStored();
      setLocalSave(null);
    }
  }, [pending, ready, editable, dirty, recovery, clearStored]);

  const persist = useCallback((report: boolean) => {
    const value = latest.current;
    if (!value || stored.current?.snapshot === value) return;
    try {
      const raw = JSON.stringify({ snapshot: JSON.parse(value), updatedAt: new Date().toISOString() });
      localStorage.setItem(storageKey, raw);
      stored.current = { raw, snapshot: value };
      if (report) setLocalSave({ snapshot: value, failed: false });
    } catch {
      if (report) setLocalSave({ snapshot: value, failed: true });
    }
  }, [storageKey]);

  useEffect(() => () => persist(false), [persist]);

  useEffect(() => {
    if (!pending) return;
    const flush = () => persist(true);
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    const timer = setTimeout(flush, 600);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [pending, persist]);

  function clear() {
    latest.current = null;
    clearStored();
    setRecovery(null);
    setLocalSave(null);
    setReadFailed(false);
  }

  let status = "";
  if (pending && localSave?.snapshot === pending) {
    status = localSave.failed
      ? tx("无法保存本机草稿，请手动保存到服务器。", "Could not save a local draft. Save to the server manually.")
      : published
        ? tx("修改已暂存在此浏览器。点击“保存修改”后才会更新已布置的作业。", "Changes are stored in this browser. Select Save changes to update the assigned work.")
        : tx("草稿已暂存在此浏览器，尚未保存到服务器。", "Draft stored in this browser. Save it to the server when ready.");
  } else if (dirty && !recovery) {
    status = tx("有未保存的修改。", "You have unsaved changes.");
  } else if (editable && readFailed) {
    status = tx("无法读取本机草稿。", "Could not read the local draft.");
  }

  const notice = editable && recovery ? (
    <section data-od-id="activity-autosave" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle p-3 text-sm">
      <span role="status">{tx("此浏览器有未保存到服务器的修改。恢复后可先核对，再手动保存。", "This browser has unsaved changes. Restore them to review before saving.")}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => { onRestore(recovery); setRecovery(null); }}>
          {tx("恢复草稿", "Restore draft")}
        </Button>
        <Button size="sm" variant="ghost" onClick={clear}>{tx("忽略草稿", "Ignore draft")}</Button>
      </div>
    </section>
  ) : status ? (
    <p data-od-id="activity-autosave" role="status" className="mt-2 text-xs text-muted-foreground">{status}</p>
  ) : null;

  return { notice, clear };
}
