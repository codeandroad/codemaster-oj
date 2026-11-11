"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { area, Feedback, Field, useAction } from "@/components/teacher/shared";
import { LessonContent } from "@/components/student/shared";
import { ApiError, productionApi } from "@/lib/production-api";
import type { AssistanceKind } from "./assistance";
import type { AssistanceContent, ContentTarget, LegacySolutionSource } from "./content-model";
import { SolutionHistory } from "./solution-history";
import {
  sameSolutionDraft, referenceSolutionDraft, SolutionAlternativesEditor,
  SolutionDiscardDialog, solutionDraftError, SolutionDraftPreview, useSolutionDraftNavigation,
  type SolutionDraft, type OriginalSolution,
} from "./solution-alternatives-editor";

function useText() {
  const { locale } = useLocale();
  return (zh: string, en: string) => locale === "en" ? en : zh;
}

export function ContentForm({
  target,
  kind,
  content,
  originalSolution,
  legacySources,
  disabled,
  reload,
  onPendingChange,
  onSaved,
}: {
  target: ContentTarget;
  kind: AssistanceKind;
  content?: AssistanceContent;
  originalSolution?: OriginalSolution;
  legacySources?: LegacySolutionSource[];
  disabled: boolean;
  reload: () => void;
  onPendingChange: (pending: boolean) => void;
  onSaved: (content: AssistanceContent) => void;
}) {
  const tx = useText(),
    [draft, setDraft] = useState<SolutionDraft | null>(null),
    [draftBase, setDraftBase] = useState<{ id?: string; hash?: string } | null>(null),
    [reviewed, setReviewed] = useState(false),
    [preview, setPreview] = useState(false),
    [conflict, setConflict] = useState(false),
    [discard, setDiscard] = useState(false),
    action = useAction();
  const inFlight = useRef(false);
  const saved = content ?? { body: "" };
  const multiple = kind === "FULL_SOLUTION" && "problemId" in target;
  const initial = multiple && !content && originalSolution
    ? referenceSolutionDraft(originalSolution, tx("原参考题解", "Reference solution"))
    : saved;
  const value = draft ?? initial;
  const dirty = !sameSolutionDraft(value, saved);
  const unsavedEdits = draft !== null && dirty;
  const hasConflict = conflict || Boolean(draftBase && (draftBase.id !== content?.id || draftBase.hash !== content?.contentHash));
  const published = content?.status === "published";
  const unavailable = disabled || action.busy;
  const canEdit = !unavailable && (!published || multiple);
  const canSave = canEdit && dirty && !hasConflict && !solutionDraftError(value);
  useSolutionDraftNavigation(unsavedEdits || action.busy);
  useEffect(() => {
    onPendingChange(unsavedEdits || action.busy);
    return () => onPendingChange(false);
  }, [unsavedEdits, action.busy, onPendingChange]);

  function edit(next: SolutionDraft) {
    if (draft === null) setDraftBase({ id: content?.id, hash: content?.contentHash });
    setDraft(next);
    setReviewed(false);
    if (!conflict) action.clear();
  }

  function commit(operation: () => Promise<AssistanceContent>, message: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    void action.run(async () => {
      try {
        const next = await operation();
        onSaved(next);
        setDraft(null);
        setDraftBase(null);
        setReviewed(false);
        return message;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) setConflict(true);
        throw cause;
      }
    }).finally(() => { inFlight.current = false; });
  }

  function reset() {
    setDiscard(false);
    setDraft(null);
    setDraftBase(null);
    setReviewed(false);
    action.clear();
    if (hasConflict) reload();
    setConflict(false);
  }

  return (
    <div className="space-y-3">
      {!multiple && <p className="text-xs text-muted-foreground">
        {tx("\u7248\u672c", "Version")}{" "}
        <code>{target.versionId.slice(0, 8)}</code>
        {published && !multiple &&
          tx(
            " \u00b7 \u5df2\u53d1\u5e03\u5185\u5bb9\u5df2\u51bb\u7ed3\uff0c\u4fee\u6539\u9700\u8981\u65b0\u9898\u76ee\u7248\u672c\u5e76\u91cd\u65b0\u5ba1\u6838\u3002",
            " \u00b7 Published content is frozen. Use a new problem version and review changes again.",
          )}
      </p>}
      <p className="text-xs text-muted-foreground">
        {tx("当前状态：", "Status: ")}
        {content?.hasPendingSolutions
          ? tx("已发布 · 更新待审核", "Published · updates awaiting review")
          : published
          ? tx("已发布", "Published")
          : content?.status === "draft"
            ? tx("草稿", "Draft")
              : (content?.status ?? (multiple && originalSolution ? tx("已准备参考素材 · 待核对保存", "Reference draft · review and save")
              : tx("尚未录入", "Not authored")))}
      </p>
      {multiple && !content && originalSolution && <p className="text-sm text-muted-foreground">{tx("已用原参考题解准备首篇草稿。请核对后保存、审核发布，再向学生开放；其他解法可继续追加。", "The first draft is prepared from the reference solution. Review, save and publish it for students; add other approaches alongside it.")}</p>}
      {multiple ? <SolutionAlternativesEditor value={value} onChange={edit} disabled={!canEdit} originalSolution={originalSolution} /> : <Field
        label={tx(
          "内容（Markdown，可包含代码块）",
          "Content (Markdown with code blocks)",
        )}
      >
        <textarea
          className={`${area} min-h-56 resize-none font-mono`}
          value={value.body}
          maxLength={200000}
          onChange={(event) => edit({ body: event.target.value })}
          disabled={!canEdit}
        />
      </Field>}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={!canSave}
          aria-busy={action.busy}
          onClick={() => commit(() => productionApi<AssistanceContent>("scholarship/contents", {
            method: "POST",
            body: {
              ...target,
              ...value,
              kind,
              language: kind === "FULL_TRANSLATION" ? "zh-CN" : "",
              expectedHash: draftBase ? draftBase.hash : content?.contentHash,
            },
          }), published
            ? tx("更新已保存为草稿，等待审核。", "Updates saved for review.")
            : tx("草稿已保存，审核发布后学生才能获取。", "Draft saved. Students can access it after review and publication."))}
        >
          {kind === "FULL_SOLUTION" ? tx("保存题解草稿", "Save solution draft") : tx("保存译文草稿", "Save translation draft")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={unavailable || !value.body.trim()}
          onClick={() => setPreview(!preview)}
        >
          {preview ? tx("收起预览", "Hide preview") : tx("预览", "Preview")}
        </Button>
        {(unsavedEdits || hasConflict) && <Button type="button" size="sm" variant="ghost" disabled={unavailable} onClick={() => unsavedEdits ? setDiscard(true) : reset()}>
          {hasConflict ? tx("重新载入", "Reload") : tx("放弃修改", "Discard changes")}
        </Button>}
      </div>
      {preview && (
        <div className="rounded-md border border-border p-4">
          {kind === "FULL_SOLUTION" ? <SolutionDraftPreview draft={value} /> : <LessonContent content={value.body} />}
        </div>
      )}
      {content && (!published || content.hasPendingSolutions) && !dirty && !hasConflict && (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              className="mt-1 accent-primary"
              type="checkbox"
              checked={reviewed}
              disabled={unavailable}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            {tx(
              "已核对当前题目与题解内容，并确认不包含私有批注或隐藏测试。",
              "I checked the current problem and solution and confirmed there are no private notes or hidden tests.",
            )}
          </label>
          <Button
            type="button"
            size="sm"
            disabled={unavailable || !reviewed}
            aria-busy={action.busy}
            onClick={() => commit(() => productionApi<AssistanceContent>(`scholarship/contents/${encodeURIComponent(content.id)}/publish`, {
              method: "POST", body: { reviewed: true, expectedHash: content.contentHash },
            }), tx("内容已审核发布。", "Content reviewed and published."))}
          >
            {tx("审核并发布", "Review and publish")}
          </Button>
        </>
      )}
      <Feedback action={action} />
      {hasConflict && <p className="text-sm text-destructive" role="alert">{tx("题解已被更新。你的未保存修改仍保留在上方，请核对并复制需要保留的内容，再重新载入。", "These solutions have changed. Your unsaved edits remain above. Review and copy any text you want to keep before reloading.")}</p>}
      {dirty && <p className="text-xs text-muted-foreground">{tx("保存或放弃修改后可切换内容类型。", "Save or discard edits to switch content type.")}</p>}
      {multiple && <SolutionHistory sources={legacySources ?? []} value={value} onChange={edit} disabled={!canEdit || hasConflict} />}
      {discard && <SolutionDiscardDialog reload={hasConflict} onCancel={() => setDiscard(false)} onDiscard={reset} />}
    </div>
  );
}

