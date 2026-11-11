"use client";

import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { LessonContent } from "@/components/student/shared";
import type { LegacySolutionSource } from "./content-model";
import type { SolutionDraft } from "./solution-alternatives-editor";
import { appendHistoricalSolution } from "./solution-history-model";

export function SolutionHistory({ sources, value, onChange, disabled }: {
  sources: LegacySolutionSource[];
  value: SolutionDraft;
  onChange: (draft: SolutionDraft) => void;
  disabled: boolean;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [message, setMessage] = useState("");
  if (!sources.length) return null;
  const states: Record<string, string> = {
    published: tx("曾发布", "Previously published"), draft: tx("未发布草稿", "Unpublished draft"),
    withdrawn: tx("已撤回", "Withdrawn"),
  };
  function add(article: { title: string; body: string }) {
    const result = appendHistoricalSolution(value, article, tx("原有题解", "Existing solution"));
    if (result.error) {
      setMessage(result.error === "duplicate" ? tx("当前草稿已包含相同正文，无需重复添加。", "This body is already included in the current draft.")
        : result.error === "count" ? tx("最多可保存 10 篇解法。请先合并或移除当前解法，再导入；历史素材仍会保留。", "A solution set can contain up to 10 approaches. Combine or remove an approach before importing; the historical material is retained.")
        : result.error === "required" ? tx("此素材没有完整的标题和正文，无法添加。", "This material needs a title and body before it can be added.")
        : tx("加入后会超过题解长度上限，请先整理当前解法。历史素材仍会完整保留。", "Adding this material would exceed the solution size limit. Edit the current set first; the historical material is retained in full."));
      return;
    }
    onChange(result.draft);
    setMessage(tx(`已将「${article.title}」添加到草稿末尾，请核对后保存并审核发布。`, `“${article.title}” was appended to the draft. Check it, then save and review for publication.`));
  }
  return <details className="rounded-md border border-border px-3 py-2">
    <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      {tx(`历史题解素材（${sources.length}）`, `Historical solution material (${sources.length})`)}
    </summary>
    <div className="space-y-3 pt-3">
      <p className="text-xs text-muted-foreground">{tx("这里保留以前的题解和未发布修改。可预览并逐篇加入当前草稿，保存、审核发布后才会提供给学生。", "Earlier solutions and unpublished edits are kept here. Preview and add individual approaches to the current draft, then save and review before students receive them.")}</p>
      {sources.map((source, index) => {
        const date = new Date(source.createdAt);
        const savedAt = Number.isNaN(date.getTime()) ? tx("时间未知", "Unknown date") : date.toLocaleString(locale === "en" ? "en-GB" : "zh-CN");
        const drafts = [{ key: "saved", label: states[source.status] ?? tx("历史内容", "Historical content"), draft: source },
          ...(source.pending ? [{ key: "pending", label: tx("未发布修改 · 待审核", "Unpublished changes · awaiting review"), draft: source.pending }] : [])];
        return <details key={source.contentId} className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-primary">{tx(`素材 ${index + 1}`, `Material ${index + 1}`)} · {savedAt}{source.pending && ` · ${tx("含未发布修改", "Includes unpublished edits")}`}</summary>
          <div className="space-y-4 pt-3">{drafts.map(({ key, label, draft }) => <div key={key} className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
            {(draft.solutions?.length ? draft.solutions : [{ title: tx("原有题解", "Existing solution"), body: draft.body }]).map((article, articleIndex) => <details key={articleIndex} className="rounded-md border border-border p-3">
              <summary className="cursor-pointer break-words text-sm focus-visible:outline-2 focus-visible:outline-primary">{article.title}</summary>
              <div className="space-y-3 pt-3">
                <div className="max-h-80 overflow-auto rounded-md border border-border p-3" tabIndex={0} aria-label={tx("历史题解预览", "Historical solution preview")}><LessonContent content={article.body} /></div>
                <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => add(article)}>{tx("添加为解法", "Add as an approach")}</Button>
              </div>
            </details>)}
          </div>)}</div>
        </details>;
      })}
      {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
    </div>
  </details>;
}
