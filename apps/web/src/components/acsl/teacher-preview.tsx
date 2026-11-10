"use client";

import { useLocale } from "@/components/locale-context";
import { AcslRichContent } from "./rich-content";
import type { AcslLanguage } from "./model";
import type { AcslTeacherPaper, AcslTeacherQuestion } from "./teacher-model";

export function AcslTeacherQuestionPreview({
  question,
  language,
}: {
  question: AcslTeacherQuestion;
  language: AcslLanguage;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  return (
    <section
      className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6"
      data-od-id="acsl-teacher-question"
      lang={language}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          {question.number}. {question.topic[language]}
        </h2>
        <span className="text-xs text-muted-foreground">
          {question.type === "single"
            ? tx("Single choice", "单选题")
            : tx("Multiple choice", "多选题")}
        </span>
      </div>
      <AcslRichContent
        content={question.statement[language]}
        diagrams={question.statementDiagrams?.[language]}
        language={language}
      />
      <div className="space-y-2">
        {question.options.map((option) => (
          <div
            key={option.id}
            className="flex min-w-0 items-baseline gap-3 rounded-md border border-border p-3 text-sm"
          >
            <span className="shrink-0 font-semibold">{option.id}.</span>
            <div className="min-w-0">
              <AcslRichContent
                content={option.text[language]}
                diagrams={option.diagrams?.[language]}
                language={language}
                compact
              />
            </div>
          </div>
        ))}
      </div>
      <div
        className="border-t border-border pt-4"
        data-od-id="acsl-teacher-answer"
      >
        <p className="mb-3 text-sm font-semibold">
          {tx("Correct answer", "正确答案")}:{" "}
          {question.correctOptionIds.join(", ")}
        </p>
        <AcslRichContent
          content={question.explanation[language]}
          diagrams={question.explanationDiagrams?.[language]}
          language={language}
        />
      </div>
    </section>
  );
}

export function AcslTeacherProgrammingPreview({
  programming,
  language,
}: {
  programming: NonNullable<AcslTeacherPaper["programming"]>;
  language: AcslLanguage;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  return (
    <section
      className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6"
      data-od-id="acsl-teacher-programming"
    >
      <h2 className="font-semibold">{programming.title}</h2>
      <p className="text-xs text-muted-foreground">
        {tx("Judge settings (read only)", "判题设置（只读）")} ·{" "}
        {programming.readOnlyJudge.mode} ·{" "}
        {programming.readOnlyJudge.comparator} ·{" "}
        {programming.readOnlyJudge.timeLimitMs} ms ·{" "}
        {programming.readOnlyJudge.memoryLimitMb} MB ·{" "}
        {programming.readOnlyJudge.testCount} {tx("formal tests", "组正式测试")}
      </p>
      <div lang={language}>
        <AcslRichContent
          content={
            language === "en" ? programming.statement : programming.statementZh
          }
          diagrams={programming.statementDiagrams?.[language]}
          language={language}
        />
      </div>
      {programming.samples.map((sample, index) => (
        <div key={index}>
          <h3 className="mb-2 text-sm font-semibold">
            {tx(`Sample ${index + 1}`, `样例 ${index + 1}`)}
          </h3>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {[
              [tx("Input", "输入"), sample.input],
              [tx("Expected output", "预期输出"), sample.expected],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <p className="mb-1 text-xs text-muted-foreground">{label}</p>
                <pre className="max-w-full overflow-auto rounded-md border border-border bg-surface-subtle p-3 text-xs leading-6">
                  {value}
                </pre>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
