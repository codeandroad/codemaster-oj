"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import {
  acslWrittenTimerKey,
  acslWrittenTimerReading,
  formatAcslWrittenTime,
  mergeAcslWrittenTimers,
  parseAcslWrittenTimer,
  resolveAcslWrittenTimer,
  type AcslWrittenTimerRecord,
} from "./written-timer-model";

/** Keep second-by-second updates outside the question and answer-save tree. */
export const AcslWrittenTimer = memo(function AcslWrittenTimer({
  accountId, schoolId, paperId, versionId, graded, gradedAt,
}: {
  accountId: string;
  schoolId: string;
  paperId: string;
  versionId: string;
  graded: boolean;
  gradedAt: string | null;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => locale === "en" ? en : zh;
  const key = acslWrittenTimerKey(accountId, schoolId, paperId, versionId);
  const remembered = useRef<{ key: string; record: AcslWrittenTimerRecord | null }>({ key, record: null });
  const [snapshot, setSnapshot] = useState<{ record: AcslWrittenTimerRecord | null; now: number }>({ record: null, now: 0 });

  useEffect(() => {
    let current = remembered.current.key === key ? remembered.current.record : null;
    function sync(incoming: string | null = null) {
      const now = Date.now();
      let stored: string | null = null;
      try { stored = localStorage.getItem(key); } catch { /* The open page still keeps time. */ }
      current = resolveAcslWrittenTimer(
        mergeAcslWrittenTimers(current, parseAcslWrittenTimer(stored, now), parseAcslWrittenTimer(incoming, now)),
        now, graded, gradedAt,
      );
      remembered.current = { key, record: current };
      if (current) {
        const serialized = JSON.stringify(current);
        if (serialized !== stored) {
          try { localStorage.setItem(key, serialized); } catch { /* Keep the in-memory start. */ }
        }
      }
      setSnapshot({ record: current, now });
    }
    sync();
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible" && current?.stoppedAt === null)
        setSnapshot({ record: current, now: Date.now() });
    }, 1000);
    const visible = () => { if (document.visibilityState === "visible") sync(); };
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) sync(event.key === key ? event.newValue : null);
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("storage", storage);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      window.removeEventListener("storage", storage);
    };
  }, [key, graded, gradedAt]);

  if (graded && !snapshot.record) return null;
  const reading = snapshot.record ? acslWrittenTimerReading(snapshot.record, snapshot.now) : null;
  const stopped = reading?.phase === "stopped";
  const expired = reading?.phase === "expired";
  const warning = reading?.phase === "warning";
  const display = formatAcslWrittenTime(stopped ? reading.elapsedSeconds : reading?.remainingSeconds ?? 3600);
  const message = stopped
    ? reading.overTime
      ? tx("Written practice finished after the 60-minute target.", "笔试练习已完成，用时超过 60 分钟。")
      : tx("Your written practice timer has stopped.", "笔试练习计时已停止。")
    : expired
      ? tx("Time is up. You can still finish your answers and submit the written section.", "60 分钟已到，你仍可完成剩余答案并提交笔试。")
      : warning
        ? tx("5 minutes or less remain. Check your answers and submit the written section.", "剩余时间不超过 5 分钟，请检查答案并提交笔试。")
        : tx("Aim to finish all written questions within one hour. Time continues when you leave this page.", "请在 1 小时内完成所有选择题；离开页面后仍会继续计时。");
  return <section
    data-od-id="acsl-written-timer"
    data-phase={reading?.phase ?? "running"}
    aria-label={tx("60-minute written practice", "60 分钟笔试模拟练习")}
    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border p-4 ${expired ? "border-destructive bg-destructive/5" : warning ? "border-warning/50 bg-warning-soft" : "border-border bg-surface"}`}
  >
      <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold"><Clock3 size={17} className="shrink-0" aria-hidden="true"/>
        {stopped ? tx("Written practice time", "笔试练习用时") : tx("Written practice · 60 minutes", "笔试模拟练习 · 60 分钟")}
      </h3>
      <p role="status" className={`col-span-2 text-xs leading-5 sm:col-span-1 ${expired ? "text-destructive" : warning ? "text-warning" : "text-muted-foreground"}`}>{message}</p>
    <div className="col-start-2 row-start-1 text-end sm:row-span-2">
      <p className="text-xs text-muted-foreground">{stopped ? tx("Time used", "已用时间") : tx("Time remaining", "剩余时间")}</p>
      <p role="timer" aria-live="off" aria-label={`${stopped ? tx("Time used", "已用时间") : tx("Time remaining", "剩余时间")} ${display}`}
        className={`font-mono text-xl font-semibold tabular-nums ${expired ? "text-destructive" : warning ? "text-warning" : "text-foreground"}`}
        data-od-id="acsl-written-time">{display}</p>
    </div>
  </section>;
});
