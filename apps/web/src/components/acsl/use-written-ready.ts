"use client";

import { useCallback, useEffect, useRef } from "react";

/** Only a successful answer save arms this notice; opening a saved paper never does. */
export function useWrittenReadyNotice({
  key,
  ready,
  saved,
  onReady,
}: {
  key: string;
  ready: boolean;
  saved: number;
  onReady: () => void;
}) {
  const shown = useRef(new Set<string>());
  const acknowledge = useCallback(() => {
    shown.current.add(key);
    try {
      sessionStorage.setItem(key, "shown");
    } catch {
      /* In-memory fallback. */
    }
  }, [key]);
  useEffect(() => {
    if (!ready || saved === 0 || shown.current.has(key)) return;
    try {
      if (sessionStorage.getItem(key) === "shown") return;
    } catch {
      /* In-memory fallback. */
    }
    // Give a multi-select sequence time to settle; never submit from this timer.
    const timer = window.setTimeout(() => {
      acknowledge();
      onReady();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [key, ready, saved, onReady, acknowledge]);
  return acknowledge;
}
