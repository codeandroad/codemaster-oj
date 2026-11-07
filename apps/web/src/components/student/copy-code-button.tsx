"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";

/** Copies the current editor buffer without changing its contents or selection. */
export function CopyCodeButton({ code, className }: { code: string; className?: string }) {
  const { locale } = useLocale();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const label = status === "copied"
    ? (locale === "en" ? "Code copied" : "已复制代码")
    : status === "failed"
      ? (locale === "en" ? "Copy failed. Please copy manually." : "复制失败，请手动复制。")
      : (locale === "en" ? "Copy code" : "复制代码");

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(code);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  }

  return <>
    <button type="button" className={className ?? "inline-flex h-8 w-8 items-center justify-center rounded hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"} title={label} aria-label={label} onClick={() => void copy()}>
      {status === "copied" ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="text-success" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg> : <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#030303" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>}
    </button>
    <span role="status" className={status === "failed" ? "text-xs text-destructive" : "sr-only"}>{status === "idle" ? "" : label}</span>
  </>;
}
