"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AppLink } from "@/components/navigation";
import { PublicCourseCatalog, PublicCoursePage } from "./public-course-catalog";
import { PublicReviewNotebook, PublicSubmissions } from "./public-study-records";
import { PublicPractice } from "./school-practice";
import { useSchoolText } from "./school-ui";

type ResourceSection = "problems" | "courses" | "submissions" | "review-notebook";

export function LearnerResourceScope({ section, schoolHref, children }: {
  section: ResourceSection;
  schoolHref: string;
  children: ReactNode;
}) {
  const text = useSchoolText();
  const search = useSearchParams();
  const showPublic = search.get("scope") === "public";
  const publicHref = schoolHref + (schoolHref.includes("?") ? "&" : "?") + "scope=public";
  const courseId = search.get("publicCourseId");

  return <div className="space-y-4">
    <nav aria-label={text("Learning scope", "学习范围")} className="flex flex-wrap gap-1 border-b border-border">
      {[
        { href: schoolHref, active: !showPublic, label: text("My school", "本校") },
        { href: publicHref, active: showPublic, label: text("Platform public", "平台公开") },
      ].map(tab => <AppLink key={tab.href} href={tab.href} aria-current={tab.active ? "page" : undefined}
        className={`border-b-2 px-4 py-2 text-sm font-semibold ${tab.active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
        {tab.label}
      </AppLink>)}
    </nav>
    {showPublic ? (
      section === "problems" ? <PublicPractice/>
        : section === "submissions" ? <PublicSubmissions/>
          : section === "review-notebook" ? <PublicReviewNotebook/>
            : courseId ? <PublicCoursePage key={courseId} id={courseId} homeHref={publicHref}/>
              : <PublicCourseCatalog courseHref={id => `${publicHref}&publicCourseId=${encodeURIComponent(id)}`}/>
    ) : children}
  </div>;
}
