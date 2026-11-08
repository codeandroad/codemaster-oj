"use client";

import { useEffect, useState } from "react";
import { productionApi } from "@/lib/production-api";
import { LessonContent } from "./shared";

export type ProblemTutorialContent = { source: "course"; courseTitle: string; title: string; body: string }
  | { source: "custom"; body: string };

export function useProblemTutorial(endpoint = "", tutorial?: ProblemTutorialContent) {
  const [result, setResult] = useState<{ endpoint: string; tutorial: ProblemTutorialContent | null } | null>(null);
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    productionApi<{ tutorial: ProblemTutorialContent | null }>(endpoint, { signal: controller.signal })
      .then(response => {
        if (!controller.signal.aborted) setResult({ endpoint, tutorial: response.tutorial });
      })
      .catch(() => { /* An unavailable tutorial leaves the problem workspace usable. */ });
    return () => controller.abort();
  }, [endpoint]);
  return tutorial ?? (result?.endpoint === endpoint ? result.tutorial : null);
}

export function ProblemTutorial({ tutorial }: { tutorial: ProblemTutorialContent }) {
  return <article data-od-id="problem-tutorial-content">
    {tutorial.source === "course" && <header className="mb-5">
      <p className="break-words text-sm text-muted-foreground">{tutorial.courseTitle}</p>
      <h2 className="mt-1 break-words font-semibold">{tutorial.title}</h2>
    </header>}
    <LessonContent content={tutorial.body} />
  </article>;
}
