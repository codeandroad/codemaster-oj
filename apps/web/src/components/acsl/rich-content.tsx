"use client";

import { LessonContent } from "@/components/student/shared";
import { AcslNativeDiagram } from "./native-diagram";
import { acslContentParts, type AcslDiagram } from "./diagram-model";
import type { AcslLanguage } from "./model";

export function AcslRichContent({
  content,
  diagrams = [],
  language,
  compact = false,
  zoomable = true,
}: {
  content: string;
  diagrams?: AcslDiagram[];
  language: AcslLanguage;
  compact?: boolean;
  zoomable?: boolean;
}) {
  if (!diagrams.length)
    return <LessonContent content={content} compact={compact} />;
  const byId = new Map(diagrams.map((diagram) => [diagram.id, diagram]));
  return (
    <>
      {acslContentParts(
        content,
        diagrams.map((diagram) => diagram.id),
      ).map((part, index) =>
        part.kind === "text" ? (
          <LessonContent key={index} content={part.text} compact={compact} />
        ) : (
          <AcslNativeDiagram
            key={`${index}:${part.id}`}
            diagram={byId.get(part.id)!}
            language={language}
            zoomable={zoomable}
          />
        ),
      )}
    </>
  );
}
