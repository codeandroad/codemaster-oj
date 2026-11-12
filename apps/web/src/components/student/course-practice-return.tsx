"use client";

import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { acslReturnHref } from "@/components/course-acsl-navigation";

export function CoursePracticeReturn({ schoolId }: { schoolId: string }) {
  const params = useSearchParams(),
    { locale } = useLocale(),
    href = acslReturnHref(params, schoolId);
  return href ? (
    <div className="mt-4" data-od-id="course-return-acsl">
      <AppLink
        href={href}
        className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-primary hover:underline"
      >
        <ArrowLeft size={15} />
        {!new URL(href, "https://campus.invalid").searchParams.has("paperId")
          ? locale === "en" ? "Return to ACSL papers" : "返回 ACSL 试卷目录"
          : locale === "en" ? "Return to ACSL practice / review" : "返回 ACSL 练习与复盘"}
      </AppLink>
    </div>
  ) : null;
}
