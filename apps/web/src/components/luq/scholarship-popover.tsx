"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { useData } from "@/components/student/shared";
import { Button } from "@/components/ui/button";
import { ScholarshipIcon } from "./scholarship-icon";

type Entry = { id: string; delta: number; balanceAfter: number; kind: string; reason: string; createdAt: string };
type Props = {
  balance?: number;
  href: string;
  entries?: Entry[];
  ledgerPath?: string;
  error?: string;
  onRefresh: () => void;
};

function balanceTrend(entries: Entry[]) {
  if (entries.length < 2) return null;
  const balances = entries.map(entry => entry.balanceAfter).reverse();
  const low = Math.min(...balances), range = Math.max(...balances) - low;
  if (range === 0) return null;
  const points = balances.map((balance, index) => `${2 + 68 * index / (balances.length - 1)},${18 - 16 * (balance - low) / range}`).join(" ");
  return <svg aria-hidden="true" viewBox="0 0 72 20" className="h-5 w-[72px] shrink-0 text-primary"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function ScholarshipPopover({ balance, href, entries, ledgerPath, error, onRefresh }: Props) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 0, width: 280, maxHeight: 320 });
  const ledger = useData<{ items: Entry[] }>(open && ledgerPath ? ledgerPath : "");
  const visibleEntries = (ledgerPath ? ledger.data?.items : entries)?.slice(0, 5);
  const failed = ledgerPath ? ledger.error : error;
  const date = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Shanghai",
  });
  const labels: Record<string, string> = {
    initial_grant: text("初始发放", "Initial allowance"), admin_grant: text("管理员发放", "Administrator grant"),
    admin_adjustment: text("余额调整", "Balance adjustment"), purchase: text("解锁学习辅助", "Assistance unlock"),
    refund: text("退款", "Refund"), first_ac: text("首次 AC 奖励", "First-AC reward"), activity: text("活动奖励", "Activity reward"),
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const reposition = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 24), top = rect.bottom + 6;
      setPosition({ width, top, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), maxHeight: window.innerHeight - top - 12 });
    };
    reposition();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  return <div ref={root} className="relative shrink-0" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    trigger.current?.focus();
  }}>
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-label={text("奖学金余额与流水", "Scholarship balance and history")}
      onClick={() => { if (!open) onRefresh(); setOpen(!open); }}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2 font-semibold tabular-nums hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary max-sm:min-h-11">
      <ScholarshipIcon size={18}/>{balance ?? "—"}
    </button>
    {open && <section id={id} aria-label={text("最近奖学金流水", "Recent Scholarship activity")} style={{ position: "fixed", ...position }}
      className="z-[60] flex flex-col overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-xl">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div><h2 className="text-sm font-semibold">{text("最近流水", "Recent activity")}</h2><p className="text-xs text-muted-foreground">{text("余额", "Balance")} <strong className="font-semibold tabular-nums text-foreground">{balance ?? "—"}</strong></p></div>
        {visibleEntries && balanceTrend(visibleEntries)}
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {failed && <div role="alert" className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"><span>{text("流水加载失败", "Could not load activity")}</span><Button size="sm" variant="ghost" onClick={ledgerPath ? ledger.reload : onRefresh}>{text("重试", "Retry")}</Button></div>}
        {!failed && !visibleEntries && <p role="status" className="px-3 py-3 text-xs text-muted-foreground">{text("正在加载…", "Loading…")}</p>}
        {!failed && visibleEntries?.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">{text("暂无流水", "No activity yet")}</p>}
        {!!visibleEntries?.length && <ul className="divide-y divide-border">{visibleEntries.map(entry => <li key={entry.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
          <div className="min-w-0"><p className="truncate text-xs font-medium" title={entry.reason || undefined}>{entry.reason || labels[entry.kind] || text("余额变动", "Balance change")}</p><time dateTime={entry.createdAt} className="text-[11px] text-muted-foreground">{date.format(new Date(entry.createdAt))}</time></div>
          <span className={`shrink-0 text-sm font-semibold tabular-nums ${entry.delta > 0 ? "text-success" : "text-foreground"}`}>{entry.delta > 0 ? "+" : ""}{entry.delta}</span>
        </li>)}</ul>}
      </div>
      <footer className="shrink-0 border-t border-border px-2 py-0.5"><AppLink href={href} onNavigate={() => setOpen(false)} className="flex min-h-8 items-center justify-center rounded text-xs font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary max-sm:min-h-11">{text("查看全部流水", "View full history")}</AppLink></footer>
    </section>}
  </div>;
}
