"use client";

import { useEffect, useRef } from "react";

export function useCourseProgressRefresh({ reload, loading, error, data, pending = false }: { reload: () => void; loading: boolean; error: string; data: unknown; pending?: boolean }) {
  const polls = useRef(0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [reload]);
  useEffect(() => {
    if (!pending) { polls.current = 0; return; }
    if (loading || error || polls.current >= 20) return;
    const timer = window.setTimeout(() => { if (document.visibilityState === "visible") { polls.current++; reload(); } }, 3000);
    return () => window.clearTimeout(timer);
  }, [pending, loading, error, data, reload]);
}
