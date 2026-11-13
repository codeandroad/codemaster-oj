"use client";

import { useRef } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Feedback, useAction } from "@/components/teacher/shared";
import { productionApi } from "@/lib/production-api";
import type { platformDraftPublicationTarget } from "./platform-problem-model";

export function PlatformDraftBatchPublish({ targets, skipped, onClose, onPublished }: {
  targets: NonNullable<ReturnType<typeof platformDraftPublicationTarget>>[];
  skipped: number;
  onClose: () => void;
  onPublished: (ids: ReadonlySet<string>, message: string) => void;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const action = useAction();
  const pending = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);

  function publish() {
    if (pending.current) return;
    pending.current = true;
    void action.run(async () => {
      const { items } = await productionApi<{ items: { problemId: string; status: "published" | "already_published" | "skipped" }[] }>(
        "platform/source-problems/publish-batch", {
          method: "POST",
          body: { items: targets.map(({ problemId, expectedVersionId, expectedRevision }) => ({ problemId, expectedVersionId, expectedRevision })) },
        },
      );
      const published = items.filter(item => item.status === "published").length;
      const alreadyPublished = items.filter(item => item.status === "already_published").length;
      const noLongerEligible = items.length - published - alreadyPublished;
      const messages = [tx(`已发布 ${published} 道题`, `Published ${published} drafts`)];
      if (alreadyPublished) messages.push(tx(`${alreadyPublished} 道已发布`, `${alreadyPublished} already published`));
      if (skipped) messages.push(tx(`跳过 ${skipped} 道`, `Skipped ${skipped}`));
      if (noLongerEligible) messages.push(tx(`${noLongerEligible} 道状态已变化，请核对更新后的列表`, `${noLongerEligible} changed since selection. Check the refreshed list`));
      onPublished(new Set(items.filter(item => item.status !== "skipped").map(item => item.problemId)), messages.join(tx("，", ". ")) + tx("。", "."));
    }).finally(() => { pending.current = false; });
  }

  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}>
    <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[85dvh] overflow-auto overscroll-contain sm:max-w-xl"
      onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }}>
      <DialogTitle>{tx("批量审核发布", "Approve and publish drafts")}</DialogTitle>
      <DialogDescription>{tx(`将发布本页所选的 ${targets.length} 份已通过参考解验证的待审核草稿。发布后学生即可看到修改。`, `Publish ${targets.length} validated drafts awaiting review from this page. Students will see the updated content after publication.`)}</DialogDescription>
      {skipped > 0 && <p className="text-sm text-muted-foreground">{tx(`本页另有 ${skipped} 道所选题目不符合发布条件。`, `${skipped} other selected problems on this page are ineligible.`)}</p>}
      <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5 text-sm" aria-label={tx("待发布草稿", "Drafts to publish")}>
        {targets.map(target => <li key={target.problemId} className="break-words">{target.title} <span className="font-mono text-xs text-muted-foreground">{target.problemId.slice(0, 8)}</span></li>)}
      </ul>
      <Feedback action={action} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancel} type="button" variant="secondary" disabled={action.busy} onClick={onClose}>{tx("取消", "Cancel")}</Button>
        <Button type="button" disabled={action.busy} onClick={publish}>{action.busy ? tx("正在发布…", "Publishing…") : tx("确认发布", "Confirm publication")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
