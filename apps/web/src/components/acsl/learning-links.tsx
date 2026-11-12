"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import {
  acslLearningHref,
  courseReturnHref,
} from "@/components/course-acsl-navigation";
import type { AcslLanguage } from "./model";
import { acslLearningLinkApplies } from "@/components/course-acsl";

export type AcslLearningLink = {
  courseId: string;
  chapterId: string;
  title: string;
  chapterTitle: string;
  localizations?: Partial<
    Record<AcslLanguage, { title: string; chapterTitle: string }>
  >;
  href: string;
  questionIds?: string[];
  written?: boolean;
  programming?: boolean;
};

export function AcslLearningLinks({
  links,
  schoolId,
  language,
  questionIds,
}: {
  links: AcslLearningLink[];
  schoolId: string;
  language: AcslLanguage;
  questionIds?: string[];
}) {
  const params = useSearchParams(),
    pathname = usePathname(),
    { locale } = useLocale(),
    tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const source = courseReturnHref(params, schoolId);
  const sourceUrl = source ? new URL(source, "https://campus.invalid") : null;
  const permittedSource =
    sourceUrl &&
    links.some(
      (link) =>
        sourceUrl.pathname ===
          `/student/learning-paths/${link.courseId}/chapters/${link.chapterId}` ||
        (sourceUrl.pathname === `/practice/courses/${link.courseId}` &&
          sourceUrl.searchParams.get("chapterId") === link.chapterId) ||
        (sourceUrl.pathname === "/schools" &&
          sourceUrl.searchParams.get("courseId") === link.courseId &&
          sourceUrl.searchParams.get("chapterId") === link.chapterId),
    );
  const items = links.filter(link => acslLearningLinkApplies(link, { programming: params.get("coding") === "1", questionIds }))
    .map((link) => ({
      ...link,
      localized: link.localizations?.[language],
      target: acslLearningHref(
        link.href,
        `${pathname}?${params}`,
        schoolId,
        language,
      ),
    }))
    .filter((link) => link.target);
  if (!items.length && !permittedSource) return null;
  return (
    <div
      className="space-y-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
      data-od-id="acsl-learning-links"
    >
      {permittedSource && source && (
        <AppLink
          href={source}
          className="inline-flex min-h-9 items-center gap-2 font-semibold text-primary hover:underline"
          data-od-id="acsl-return-course"
        >
          <ArrowLeft size={15} />
          {tx("Return to chapter", "返回来源章节")}
        </AppLink>
      )}
      {!!items.length && (
        <details>
          <summary className="flex min-h-9 cursor-pointer items-center gap-2 font-semibold text-primary">
            <BookOpen size={15} />
            {tx("Review related lessons", "复习相关课程")}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({items.length})
            </span>
          </summary>
          <ul className="mt-2 space-y-1 border-t border-border pt-2">
            {items.map((link) => (
              <li key={`${link.courseId}:${link.chapterId}`}>
                <AppLink
                  href={link.target!}
                  className="block rounded px-2 py-2 text-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-ring"
                  data-od-id="acsl-related-chapter"
                >
                  {link.localized?.title ?? link.title} ·{" "}
                  {link.localized?.chapterTitle ?? link.chapterTitle}
                </AppLink>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
