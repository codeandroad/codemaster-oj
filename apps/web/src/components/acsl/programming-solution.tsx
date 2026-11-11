"use client";

import { useState } from "react";
import { CodeTokens } from "@/components/student/code-editor";
import { Button } from "@/components/ui/button";
import { AcslRichContent } from "./rich-content";
import type { AcslLanguage } from "./model";
import type { AcslProgrammingSolution } from "./teacher-model";

export function AcslProgrammingSolutionView({
  solution,
  language,
  printable = false,
}: {
  solution: Omit<AcslProgrammingSolution<string>, "provenance">;
  language: AcslLanguage;
  printable?: boolean;
}) {
  const zh = language === "zh";
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(solution.code);
      setMessage(zh ? "代码已复制。" : "Code copied.");
    } catch {
      setMessage(zh ? "复制失败，请选中下方代码复制。" : "Copy failed. Select and copy the code below.");
    }
  }
  return (
    <div
      className="min-w-0 space-y-4 border-t border-border pt-4"
      data-od-id="acsl-programming-solution"
      lang={language}
    >
      <h3 className="font-semibold">
        {zh ? "参考实现 · Python 3" : "Reference implementation · Python 3"}
      </h3>
      <p className="text-sm text-muted-foreground">
        {zh
          ? "每次运行读取一组标准输入，输出题目要求的结果。"
          : "Each run reads one case from standard input and prints the required result."}
      </p>
      <AcslRichContent content={solution.explanation} language={language} zoomable={false} />
      <div>
        <h4 className="mb-2 text-sm font-semibold">{zh ? "复杂度" : "Complexity"}</h4>
        <AcslRichContent content={solution.complexity} language={language} zoomable={false} />
      </div>
      {!printable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void copy()}>
            {zh ? "复制 Python 代码" : "Copy Python code"}
          </Button>
          <span role="status" className="text-sm text-muted-foreground">{message}</span>
        </div>
      )}
      <pre
        className="max-w-full overflow-auto rounded-md border border-border bg-surface-subtle p-3 text-xs leading-6 print:[&_span]:text-inherit"
        tabIndex={printable ? undefined : 0}
        aria-label={zh ? "Python 3 参考代码" : "Python 3 reference code"}
      >
        <code><CodeTokens code={solution.code} language={solution.language} /></code>
      </pre>
    </div>
  );
}
