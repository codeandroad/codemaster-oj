"use client";

import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import type { AcslLanguage, AcslPaper } from "./model";
import { AcslRichContent } from "./rich-content";
import { AcslResultSummary } from "./stage-components";
import {
  acslReviewHref,
  acslStageSummary,
  type AcslReviewMode,
} from "./stage-model";

export function AcslReviewPanel({
  paper,
  language,
  baseHref,
  onSelect,
  initialMode = "all",
}: {
  paper: AcslPaper;
  language: AcslLanguage;
  baseHref: string;
  onSelect: (questionId: string, expandExplanation: boolean) => void;
  initialMode?: AcslReviewMode;
}) {
  const { locale } = useLocale();
  const params = useSearchParams();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const mode: AcslReviewMode = params.has("review")
    ? params.get("reviewMode") === "wrong"
      ? "wrong"
      : "all"
    : initialMode;
  if (!paper.graded) return null;
  const stage = acslStageSummary(paper);
  const questions =
    mode === "wrong"
      ? paper.questions.filter((question) =>
          stage.wrongQuestionIds.includes(question.id),
        )
      : paper.questions;
  function changeMode(next: AcslReviewMode) {
    window.history.replaceState(
      null,
      "",
      acslReviewHref(baseHref, paper.id, next, language),
    );
  }
  return (
    <div className="space-y-4" data-od-id="acsl-review-panel">
      <section
        className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5"
        aria-labelledby="acsl-review-heading"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="acsl-review-heading" className="font-semibold">
            {tx("Results and review", "成绩与复盘")}
          </h2>
          <p
            className={`text-sm ${stage.complete ? "text-success" : "text-muted-foreground"}`}
            data-od-id="acsl-review-stage"
          >
            {stage.complete
              ? tx("Paper completed", "整卷已完成")
              : tx(
                  "Written section submitted · Programming pending",
                  "笔试已交卷 · 编程题尚未通过",
                )}
          </p>
        </div>
        <AcslResultSummary paper={paper} />
      </section>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={tx("Review filter", "复盘筛选")}
      >
        <Button
          variant={mode === "all" ? "secondary" : "ghost"}
          aria-pressed={mode === "all"}
          onClick={() => changeMode("all")}
          data-od-id="acsl-review-filter-all"
        >
          {tx("All questions", "全部题目")} ({paper.questions.length})
        </Button>
        <Button
          variant={mode === "wrong" ? "secondary" : "ghost"}
          aria-pressed={mode === "wrong"}
          onClick={() => changeMode("wrong")}
          data-od-id="acsl-review-filter-wrong"
        >
          {tx("Incorrect answers", "仅错题")} ({stage.wrongQuestionIds.length})
        </Button>
      </div>
      {!questions.length && (
        <div
          className="rounded-lg border border-border bg-surface p-6"
          data-od-id="acsl-review-empty"
        >
          <p className="font-semibold">
            {tx("All written answers are correct.", "笔试全部答对了。")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx(
              "You can still review each question and open its explanation.",
              "仍可查看全部题目，并按需打开解析。",
            )}
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => changeMode("all")}
          >
            {tx("View all questions", "查看全部题目")}
          </Button>
        </div>
      )}
      {questions.map((question) => {
        const last = question.lastSubmission;
        return (
          <section
            key={question.id}
            className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5"
            data-od-id="acsl-review-question"
            data-question-id={question.id}
            aria-labelledby={`acsl-review-${question.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`acsl-review-${question.id}`} className="font-semibold">
                {question.number}. {question.topic[language]}
              </h3>
              <span
                className={`inline-flex items-center gap-1.5 text-sm ${last ? (last.correct ? "text-success" : "text-destructive") : "text-muted-foreground"}`}
                data-od-id="acsl-review-verdict"
              >
                {last ? (
                  <>
                    {last.correct ? (
                      <CheckCircle2 size={16} aria-hidden="true" />
                    ) : (
                      <XCircle size={16} aria-hidden="true" />
                    )}
                    {last.correct
                      ? tx("Correct", "正确")
                      : tx("Incorrect", "错误")}
                  </>
                ) : (
                  tx("Result unavailable", "结果暂不可用")
                )}
              </span>
            </div>
            <div lang={language}>
              <AcslRichContent
                content={question.statement[language]}
                diagrams={question.statementDiagrams?.[language]}
                language={language}
              />
            </div>
            <ol
              className="space-y-2"
              aria-label={tx("Answer options", "答案选项")}
            >
              {question.options.map((option) => {
                const selected = last?.selectedOptionIds.includes(option.id);
                return (
                  <li
                    key={option.id}
                    className={`flex min-w-0 items-baseline gap-3 rounded-md border p-3 ${selected ? "border-primary/40 bg-primary/5" : "border-border"}`}
                    data-option-id={option.id}
                    data-selected={Boolean(selected)}
                  >
                    <span className="shrink-0 text-sm font-semibold">
                      {option.id}.
                    </span>
                    <div className="min-w-0 flex-1" lang={language}>
                      <AcslRichContent
                        content={option.text[language]}
                        diagrams={option.diagrams?.[language]}
                        language={language}
                        compact
                        zoomable={false}
                      />
                    </div>
                    {selected && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {tx("Your choice", "已选")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSelect(question.id, true)}
              disabled={!last}
              data-od-id="acsl-review-explanation"
            >
              {tx("View explanation", "查看解析")}
            </Button>
          </section>
        );
      })}
    </div>
  );
}
