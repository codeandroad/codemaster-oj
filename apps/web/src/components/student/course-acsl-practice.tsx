"use client";

import { useSearchParams } from "next/navigation";
import { CheckCircle2, FileQuestion } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { useCourseLanguage } from "@/components/course-language";
import { AppLink } from "@/components/navigation";
import { buttonVariants } from "@/components/ui/button";
import {
  courseAcslKey,
  courseAcslLabel,
  type CourseAcslLink,
} from "@/components/course-acsl";
import {
  acslPracticeHref,
  preserveAcslLearningContext,
} from "@/components/course-acsl-navigation";

export function CourseAcslPractice({
  links,
  schoolId,
  legacy = false,
  courseHref,
}: {
  links: CourseAcslLink[];
  schoolId: string;
  legacy?: boolean;
  courseHref: string;
}) {
  const { locale } = useLocale(),
    { language } = useCourseLanguage(),
    search = useSearchParams();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  return (
    <>
      {links.map((link) => {
        const params = new URLSearchParams(
          legacy ? {} : { schoolId, section: "acsl", schoolRole: "student" },
        );
        if (link.paperId) params.set("paperId", link.paperId);
        if (link.versionId) params.set("paperVersionId", link.versionId);
        if (link.kind === "question" && link.questionId)
          params.set("questionId", link.questionId);
        if (link.kind === "programming") params.set("coding", "1");
        const target = `${legacy ? "/student/acsl" : "/schools"}?${params}`;
        const href =
          link.available !== false && link.paperId
            ? acslPracticeHref(
                target,
                preserveAcslLearningContext(courseHref, search, schoolId) ??
                  courseHref,
                schoolId,
                language,
              )
            : null;
        const state =
          link.available === false
            ? tx(
                "This linked edition is unavailable. Ask your teacher to update it.",
                "关联版本暂不可用，请老师更新关联。",
              )
            : link.completed
              ? link.kind === "programming"
                ? tx("Accepted in formal judging", "正式判题已通过")
                : link.kind === "written"
                  ? tx("Written section submitted", "笔试已交卷")
                  : tx("Answered correctly", "已答对")
              : link.status === "submitted"
                ? tx("Submitted · review this question", "已交卷 · 需要复盘")
                : link.status === "draft"
                  ? tx(
                      "Answer saved · written section not submitted",
                      "已保存答案 · 笔试未交卷",
                    )
                  : tx("Not completed", "尚未完成");
        return (
          <div
            key={courseAcslKey(link)}
            className="mt-4 flex flex-col items-stretch justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center"
            data-od-id="course-acsl-practice"
          >
            <div className="min-w-0 sm:flex-1">
              <h3 className="flex items-start gap-2 font-semibold">
                <FileQuestion
                  size={17}
                  className="mt-0.5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                {href ? (
                  <AppLink
                    href={href}
                    className="min-w-0 break-words text-primary hover:underline"
                  >
                    {courseAcslLabel(link, language)}
                  </AppLink>
                ) : (
                  <span>{courseAcslLabel(link, language)}</span>
                )}
              </h3>
              <p
                className={`mt-2 flex items-center gap-1.5 text-xs ${link.completed && href ? "text-success" : "text-muted-foreground"}`}
              >
                {link.completed && href && (
                  <CheckCircle2 size={14} aria-hidden="true" />
                )}
                {state}
              </p>
              {link.historical && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {tx(
                    "Progress is from your saved historical submission.",
                    "此进度来自已保存的历史答卷。",
                  )}
                </p>
              )}
            </div>
            {href && (
              <AppLink
                href={href}
                className={`${buttonVariants({ variant: "secondary" })} shrink-0 self-start sm:self-center`}
              >
                {link.status === "submitted" || link.completed
                  ? tx("Open practice / review", "进入练习与复盘")
                  : tx("Open ACSL practice", "进入 ACSL 练习")}
              </AppLink>
            )}
          </div>
        );
      })}
    </>
  );
}
