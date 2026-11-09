"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { ScholarshipIcon } from "@/components/scholarship/scholarship-icon";
import { AppLink } from "@/components/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productionApi, type AssignmentCompletion } from "@/lib/production-api";

type CompletedAssignment = { id: string; title: string; completion: AssignmentCompletion };

export function useAssignmentCelebrations(userId: string, submissionId: string | null) {
  const [queue, setQueue] = useState<CompletedAssignment[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!submissionId) return;
    const controller = new AbortController();
    void productionApi<{ items: CompletedAssignment[] }>(
      `submissions/${encodeURIComponent(submissionId)}/assignment-completions`,
      { signal: controller.signal },
    ).then(({ items }) => {
      if (controller.signal.aborted) return;
      const newlyCompleted = items.filter(item => {
        const key = `campus-judge:assignment-celebration:${userId}:${item.id}`;
        if (seen.current.has(key)) return false;
        seen.current.add(key);
        try {
          if (window.sessionStorage.getItem(key)) return false;
          window.sessionStorage.setItem(key, "seen");
        } catch { /* Continue when browser storage is unavailable. */ }
        return true;
      });
      if (newlyCompleted.length) setQueue(current => [...current, ...newlyCompleted]);
    }).catch(() => {
      // Completion statistics are optional feedback. Keep the judge result visible.
    });
    return () => controller.abort();
  }, [submissionId, userId]);

  return { current: queue[0], dismiss: () => setQueue(current => current.slice(1)) };
}

function elapsedLabel(ms: number, locale: "zh" | "en") {
  const seconds = Math.floor(ms / 1000);
  const parts = [
    { amount: Math.floor(seconds / 86400), zh: "天", en: "d" },
    { amount: Math.floor(seconds / 3600) % 24, zh: "小时", en: "h" },
    { amount: Math.floor(seconds / 60) % 60, zh: "分钟", en: "min" },
    { amount: seconds % 60, zh: "秒", en: "s" },
  ].filter(part => part.amount > 0).slice(0, 2);
  return parts.length ? parts.map(part => `${part.amount} ${part[locale]}`).join(" ")
    : locale === "zh" ? "不到 1 秒" : "Under 1 s";
}

export function AssignmentCompletionDialog({ assignment, onDismiss, href, celebrate = false }: {
  assignment: CompletedAssignment;
  onDismiss: () => void;
  href?: string;
  celebrate?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const { completion } = assignment;
  const dismissButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const number = new Intl.NumberFormat(locale);
  const reward = number.format(completion.rewards.total);

  return <Dialog open onOpenChange={open => { if (!open) onDismiss(); }}>
    <DialogContent
      className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto gap-5 motion-reduce:animate-none"
      data-od-id="assignment-completion-dialog"
      onOpenAutoFocus={event => {
        restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        event.preventDefault();
        dismissButton.current?.focus();
      }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (restoreFocus.current?.isConnected) restoreFocus.current.focus();
      }}>
      <div className="flex items-start gap-3 pr-8">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success/10 text-success">
          <CircleCheck size={22} aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-2 pt-0.5">
          <DialogTitle className="text-xl leading-snug">
            {celebrate ? tx("作业完成！", "Assignment complete!") : tx("作业完成统计", "Assignment completion")}
          </DialogTitle>
          <DialogDescription className="break-words leading-5">
            {celebrate ? tx(`恭喜你完成「${assignment.title}」。`, `Congratulations on completing “${assignment.title}”.`) : assignment.title}
          </DialogDescription>
        </div>
      </div>
      <dl className="divide-y divide-border rounded-lg border border-border bg-surface-subtle px-3.5 text-sm">
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt>{tx("通过题目", "Problems passed")}</dt>
          <dd className="font-semibold tabular-nums">{completion.completedProblems} / {completion.totalProblems}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt>
            {tx("提交用时", "Submission window")}
            <span className="mt-0.5 block text-xs text-muted-foreground">{tx("从本作业首次正式提交到完成", "From the first formal submission in this assignment")}</span>
          </dt>
          <dd className="text-right font-semibold tabular-nums">
            {completion.elapsedMs === null ? tx("暂无记录", "Unavailable") : elapsedLabel(completion.elapsedMs, locale)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt>{tx("已到账奖学金", "Scholarship received")}</dt>
          <dd className="flex items-center gap-1.5 font-semibold tabular-nums">
            <ScholarshipIcon size={16} aria-hidden="true" />{tx(`${reward} 金`, reward)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={dismissButton} type="button" variant={href ? "secondary" : "default"} onClick={onDismiss}>{tx("关闭", "Close")}</Button>
        {href && <AppLink href={href} onNavigate={onDismiss} className={buttonVariants()}>{tx("查看作业", "View assignment")}</AppLink>}
      </div>
    </DialogContent>
  </Dialog>;
}
