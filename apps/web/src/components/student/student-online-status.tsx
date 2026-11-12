"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { productionApi } from "@/lib/production-api";
import { presenceChanged } from "./student-presence";

export function StudentOnlineStatus({ identityId }: { identityId: string }) {
  const { locale } = useLocale();
  const [online, setOnline] = useState<boolean>();
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let queued = false;
    async function refresh() {
      if (controller.signal.aborted || document.visibilityState !== "visible") return;
      if (pending) { queued = true; return; }
      pending = true;
      try {
        const result = await productionApi<{ student: { isOnline: boolean } }>(`presence/students/${encodeURIComponent(identityId)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setOnline(result.student.isOnline);
      } catch { if (!controller.signal.aborted) setOnline(undefined); }
      finally { pending = false; if (queued) { queued = false; void refresh(); } }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible); window.addEventListener(presenceChanged, visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener(presenceChanged, visible); };
  }, [identityId]);
  const label = online === undefined ? (locale === "en" ? "Unknown" : "状态未知") : online ? (locale === "en" ? "Online" : "在线") : (locale === "en" ? "Offline" : "离线");
  return <span data-od-id="profile-online-status" className={`inline-flex items-center gap-1.5 text-sm font-medium ${online ? "text-success" : "text-muted-foreground"}`}><span aria-hidden="true" className={`size-2 rounded-full ${online ? "bg-success" : "bg-muted-foreground"}`}/>{label}</span>;
}
