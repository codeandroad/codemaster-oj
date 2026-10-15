"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { apiMessage, productionApi, type Submission } from "@/lib/production-api";
import { CodeBlock } from "./student/shared";

export function SubmissionCodeComparison({
  originalId,
  currentId,
  currentCode,
}: {
  originalId: string;
  currentId: string;
  currentCode: string;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState<Submission | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setOriginal(null);
    setError("");
    productionApi<Submission>(`submissions/${originalId}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setOriginal(data);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(apiMessage(reason));
      });
    return () => controller.abort();
  }, [open, originalId, retry]);
  return (
    <details
      className="mt-5 border-t border-border pt-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer py-2 text-sm font-semibold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        {tx("对比原提交与订正代码", "Compare original and corrected code")}
      </summary>
      {open && error ? (
        <div role="alert" className="mt-3 text-sm">
          <p className="text-destructive">{error}</p>
          <button
            type="button"
            className="mt-2 min-h-11 px-3 text-primary underline"
            onClick={() => setRetry((value) => value + 1)}
          >
            {tx("重新加载", "Retry")}
          </button>
        </div>
      ) : open && !original ? (
        <p role="status" className="py-4 text-sm text-muted-foreground">
          {tx("正在加载原提交…", "Loading original submission…")}
        </p>
      ) : open && original ? (
        <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-2">
          <section className="min-w-0">
            <h3 className="mb-2 text-sm font-semibold">{tx("原提交", "Original submission")} · {originalId}</h3>
            <CodeBlock code={original.code} />
          </section>
          <section className="min-w-0">
            <h3 className="mb-2 text-sm font-semibold">{tx("订正提交", "Corrected submission")} · {currentId}</h3>
            <CodeBlock code={currentCode} />
          </section>
        </div>
      ) : null}
    </details>
  );
}
