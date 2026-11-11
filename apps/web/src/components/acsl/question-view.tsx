"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { useNavigationBlocker } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { ApiError, apiMessage, productionApi } from "@/lib/production-api";
import { AcslRichContent } from "./rich-content";
import { acslAnswerOptionClassName } from "./answer-option";
import { createAcslAnswerSaveQueue, type AcslAnswerSaveState } from "./answer-save-queue";
import type { AcslDiagrams } from "./diagram-model";
import {
  sameSelection,
  type AcslAssets,
  type AcslDraft,
  type AcslLanguage,
  type AcslQuestion,
  type LocalizedText,
} from "./model";

const StableRichContent = memo(AcslRichContent);

export function AcslQuestionView({
  schoolId,
  paperId,
  versionId,
  writtenRevision,
  question,
  language,
  onChanged,
  graded,
  locked,
  onEditingChange,
  onReload,
  autoExpandExplanation = false,
}: {
  schoolId: string;
  paperId: string;
  versionId: string;
  writtenRevision: string;
  question: AcslQuestion;
  language: AcslLanguage;
  onChanged: (question: AcslQuestion) => void;
  graded: boolean;
  locked: boolean;
  onEditingChange: (blocked: boolean) => void;
  onReload: () => void;
  autoExpandExplanation?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const [saveState, setSaveState] = useState<AcslAnswerSaveState>({
    selected: question.draft.selectedOptionIds, draft: question.draft,
    saving: false, pending: false, error: null, conflict: false,
  });
  const selected = saveState.selected;
  const draft = saveState.draft;
  const last = graded ? question.lastSubmission : null;
  const mounted = useRef(true);
  const saveStatusRef = useRef<HTMLSpanElement>(null);
  const [explanationBusy, setExplanationBusy] = useState(false);
  const explanationBusyRef = useRef(false);
  const [explanationError, setExplanationError] = useState("");
  const [explanationConflict, setExplanationConflict] = useState(false);
  const busy = saveState.saving || explanationBusy;
  const error = saveState.error !== null ? apiMessage(saveState.error) : explanationError;
  const conflict = saveState.conflict || explanationConflict;
  const reviewConfirmation = useRef(false);
  const [explanation, setExplanation] = useState<{
    correctOptionIds: string[];
    explanation: LocalizedText;
    explanationAssets?: AcslAssets;
    explanationDiagrams?: AcslDiagrams;
  } | null>(null);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const requestedExplanation = useRef(false);
  const dirty = !sameSelection(selected, draft.selectedOptionIds);
  const base = `schools/${schoolId}/acsl/${encodeURIComponent(paperId)}/questions/${encodeURIComponent(question.id)}`;
  const [saveQueue] = useState(() => createAcslAnswerSaveQueue(question.draft, {
    send: (next, expectedRevision, signal) => productionApi<
      AcslDraft & Pick<AcslQuestion, "requiresReview">
    >(`${base}/draft`, {
      method: "PATCH", signal,
      body: { versionId, writtenRevision, expectedRevision, selectedOptionIds: next },
    }),
    onState: next => {
      setSaveState(next);
      onEditingChange(next.pending);
    },
    onSaved: saved => {
      onChanged({ ...question,
        draft: { selectedOptionIds: saved.selectedOptionIds, revision: saved.revision },
        requiresReview: saved.requiresReview, lastSubmission: null });
    },
  }));
  useEffect(() => {
    if (!question.requiresReview && reviewConfirmation.current) {
      reviewConfirmation.current = false;
      saveStatusRef.current?.focus();
    }
  }, [question.requiresReview]);
  useNavigationBlocker(saveState.pending || explanationBusy);
  useEffect(() => {
    mounted.current = true;
    saveQueue.activate();
    return () => {
      mounted.current = false;
      saveQueue.dispose();
      onEditingChange(false);
    };
  }, [onEditingChange, saveQueue]);
  useEffect(() => {
    if (!saveState.pending && !explanationBusy) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [saveState.pending, explanationBusy]);

  function report(reason: unknown) {
    setExplanationConflict(reason instanceof ApiError && reason.status === 409);
    setExplanationError(apiMessage(reason));
  }
  function selectOption(optionId: string) {
    if (conflict || graded || locked) return;
    setExplanationError("");
    reviewConfirmation.current = false;
    const current = saveQueue.snapshot().selected;
    void saveQueue.select(question.type === "single" ? [optionId]
      : current.includes(optionId) ? current.filter(id => id !== optionId) : [...current, optionId]);
  }
  function retrySave(confirmReview = false) {
    if (conflict || graded || locked) return;
    reviewConfirmation.current = confirmReview;
    void saveQueue.retry();
  }
  const toggleExplanation = useCallback(async () => {
    if (explanation) {
      setExplanationOpen((value) => !value);
      return;
    }
    if (explanationBusyRef.current || locked || !last) return;
    explanationBusyRef.current = true;
    setExplanationBusy(true);
    setExplanationError("");
    try {
      const result = await productionApi<{
        correctOptionIds: string[];
        explanation: LocalizedText;
        explanationAssets?: AcslAssets;
        explanationDiagrams?: AcslDiagrams;
      }>(`${base}/explanation?${new URLSearchParams({ versionId })}`);
      if (!mounted.current) return;
      setExplanation(result);
      setExplanationOpen(true);
    } catch (reason) {
      if (mounted.current) report(reason);
    } finally {
      explanationBusyRef.current = false;
      if (mounted.current) setExplanationBusy(false);
    }
  }, [explanation, locked, last, base, versionId]);
  useEffect(() => {
    if (
      !autoExpandExplanation ||
      !graded ||
      !last ||
      locked ||
      requestedExplanation.current
    )
      return;
    requestedExplanation.current = true;
    void toggleExplanation();
  }, [autoExpandExplanation, graded, last, locked, toggleExplanation]);
  return (
    <section
      className="min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-6"
      data-od-id="acsl-question"
      aria-busy={busy}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {question.number}. {question.topic[language]}
        </h3>
        <span className="text-xs text-muted-foreground">
          {question.type === "single"
            ? tx("Single choice", "单选题")
            : tx("Multiple choice", "多选题")}
        </span>
      </div>
      <div className="max-w-3xl text-base leading-7" lang={language}>
        <StableRichContent
          content={question.statement[language]}
          diagrams={question.statementDiagrams?.[language]}
          language={language}
        />
      </div>
      {!graded && question.requiresReview && (
        <p
          id="acsl-question-review-notice"
          role="status"
          data-od-id="acsl-question-review-notice"
          className="mt-4 rounded-md border border-border bg-surface-subtle p-3 text-sm"
        >
          {tx(
            "This question has been corrected. Review the options, then confirm your saved answer.",
            "此题已校订，请核对选项后确认已保存答案。",
          )}
        </p>
      )}
      <fieldset
        className="mt-5 space-y-2"
        disabled={conflict || graded || locked}
        aria-describedby={
          !graded && question.requiresReview
            ? "acsl-choice-help acsl-question-review-notice"
            : "acsl-choice-help"
        }
      >
        <legend className="mb-3 text-sm font-medium" id="acsl-choice-help">
          {question.type === "single"
            ? tx("Select one answer", "请选择一个答案")
            : tx(
                "Select all correct answers. Full credit requires an exact match.",
                "请选择所有正确答案，全部选对才得分。",
              )}
        </legend>
        {question.options.map((option) => (
          <label
            key={option.id}
            className={`flex min-h-12 items-baseline gap-3 rounded-md border p-3 text-sm ${acslAnswerOptionClassName(selected.includes(option.id), last?.correct)} ${graded ? "cursor-default" : conflict || locked ? "cursor-not-allowed" : selected.includes(option.id) ? "cursor-pointer" : "cursor-pointer hover:bg-muted"}`}
          >
            <input
              type={question.type === "single" ? "radio" : "checkbox"}
              name={`acsl-${question.id}`}
              value={option.id}
              checked={selected.includes(option.id)}
              onChange={() => selectOption(option.id)}
              className="mt-0.5 size-4 shrink-0 self-start accent-primary"
            />
            <span className="font-semibold">{option.id}.</span>
            <div className="min-w-0" lang={language}>
              <StableRichContent
                content={option.text[language]}
                diagrams={option.diagrams?.[language]}
                language={language}
                compact
                zoomable={false}
              />
            </div>
          </label>
        ))}
      </fieldset>
      <div className="mt-4 flex min-h-9 flex-wrap items-center gap-3">
        <span
          ref={saveStatusRef}
          tabIndex={-1}
          className="text-xs text-muted-foreground"
          role="status"
        >
          {graded
            ? tx("Written section submitted", "笔试已交卷")
            : busy
              ? tx("Saving…", "正在保存…")
              : dirty || saveState.error !== null
                ? tx("Answer not saved", "答案尚未保存")
                : question.requiresReview
                  ? tx("Saved answer needs review", "已保存答案待复核")
                  : tx("Saved to your account", "已保存到你的账号")}
        </span>
        {!graded && question.requiresReview && (
          <Button
            variant="secondary"
            size="sm"
            data-od-id="acsl-confirm-reviewed-answer"
            disabled={busy || conflict || locked || selected.length === 0}
            onClick={() => retrySave(true)}
          >
            {dirty || saveState.error !== null
              ? tx("Retry save", "重试保存")
              : tx("Confirm saved answer", "确认已保存答案")}
          </Button>
        )}
        {saveState.error !== null && !question.requiresReview && !conflict && !graded && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || locked}
            onClick={() => retrySave()}
          >
            {tx("Retry save", "重试保存")}
          </Button>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-destructive/30 p-3 text-sm text-destructive"
        >
          <p>{error}</p>
          {conflict && (
            <p className="mt-2">
              {tx(
                "This paper changed on another page. Your selection is kept here. Load the saved paper to replace it with the current answers and submission status.",
                "试卷已在其他页面更新。当前选择仍保留在页面中，加载已保存试卷会将其替换为服务器的答案和交卷状态。",
              )}
            </p>
          )}
          {conflict && (
            <Button
              className="mt-3"
              variant="secondary"
              size="sm"
              disabled={busy || locked}
              onClick={onReload}
            >
              {tx("Load saved paper", "加载已保存试卷")}
            </Button>
          )}
        </div>
      )}
      {last && (
        <div className="mt-5 border-t border-border pt-4">
          <p
            role="status"
            className={`flex items-center gap-2 text-sm font-semibold ${last.correct ? "text-success" : "text-destructive"}`}
          >
            {last.correct ? (
              <CheckCircle2 size={17} aria-hidden="true" />
            ) : (
              <XCircle size={17} aria-hidden="true" />
            )}
            {last.correct
              ? tx("Correct", "回答正确")
              : tx("Incorrect", "回答错误")}
            <span className="font-normal text-muted-foreground">
              {tx("Submitted answer", "已提交答案")}{" "}
              {last.selectedOptionIds.join(", ")}
            </span>
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={busy || locked}
            aria-expanded={explanationOpen}
            aria-controls="acsl-explanation"
            onClick={() => void toggleExplanation()}
            data-od-id="acsl-show-explanation"
          >
            {explanationOpen
              ? tx("Hide explanation", "收起解析")
              : tx("Show explanation", "展开解析")}
          </Button>
        </div>
      )}
      {explanationOpen && explanation && (
        <div
          id="acsl-explanation"
          className="mt-4 rounded-md border border-border bg-surface-subtle p-4"
          lang={language}
        >
          <p className="mb-3 text-sm font-semibold">
            {tx("Correct answer", "正确答案")}{" "}
            {explanation.correctOptionIds.join(", ")}
          </p>
          <StableRichContent
            content={explanation.explanation[language]}
            diagrams={explanation.explanationDiagrams?.[language]}
            language={language}
          />
        </div>
      )}
    </section>
  );
}
