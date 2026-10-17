"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Globe2, Loader2, Send } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { apiMessage, productionApi } from "@/lib/production-api";
import type { Paper4Paper, Paper4PaperSummary } from "./model";

export function Paper4BatchPublishDialog({ papers, onClose, onPublished, onReturnFocus }: {
  papers: Paper4PaperSummary[];
  onClose: () => void;
  onPublished: (count: number) => void;
  onReturnFocus: () => void;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setBusy(true);
    try {
      const result = await productionApi<{ items: Paper4Paper[] }>("paper4/papers/batch-publish", { method: "POST", body: { paperIds: papers.map(paper => paper.id) } });
      onPublished(result.items.length);
    } catch (reason) { setError(apiMessage(reason)); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>{tx("发布 Paper 4 自由练习", "Publish Paper 4 free practice")}</DialogTitle>
      <DialogDescription>{tx(`将选中的 ${papers.length} 套试卷公开为全校自由练习，无需班级和时间。`, `Make ${papers.length} selected papers available school-wide for free practice. No class or time window is needed.`)}</DialogDescription>
      <form onSubmit={event => void publish(event)} className="space-y-4" aria-busy={busy}>
        {error && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive focus-visible:outline-2 focus-visible:outline-destructive">{error}</p>}
        <div className="flex items-center gap-2 rounded-md bg-info-soft p-3 text-sm font-semibold text-primary"><Globe2 size={18} aria-hidden="true"/>{tx("全校可见 · 随时练习", "School-wide · Practise anytime")}</div>
        <ul aria-label={tx("所选试卷", "Selected papers")} className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-subtle px-3 py-2 text-sm">
          {papers.map(paper => <li key={paper.id} className="leading-6">{paper.title}</li>)}
        </ul>
        <p className="text-xs leading-5 text-muted-foreground">{tx("所有参考答案须验证通过，整批才会公开。公开后可另行布置班级练习或模拟考试。", "Every reference solution must pass validation before the batch is published. Assign class practice or mock exams separately afterwards.")}</p>
        <DialogFooter className="gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>{tx("取消", "Cancel")}</Button><Button type="submit" disabled={busy}>{busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none"/> : <Send size={16} aria-hidden="true"/>}{busy ? tx("正在公开…", "Publishing…") : tx(`公开 ${papers.length} 套试卷`, `Publish ${papers.length} papers`)}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
