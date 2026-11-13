"use client";

import type { ReactNode } from "react";
import { AppLink } from "@/components/navigation";
import { useCatalogFilterUrl } from "@/components/use-catalog-filter-preferences";
import { PublicCourseCatalog, PublicCoursePage } from "./public-course-catalog";
import { PublicReviewNotebook, PublicSubmissions } from "./public-study-records";
import { PublicPractice } from "./school-practice";
import { useSchoolText } from "./school-ui";

type ResourceSection = "problems" | "courses" | "submissions" | "review-notebook";
const scopeKeys = ["scope"];

type LearnerResourceScopeProps = { schoolHref: string; children: ReactNode } & (
  { section: "problems"; accountId: string } |
  { section: Exclude<ResourceSection, "problems">; accountId?: never }
);

export function LearnerResourceScope({ section, schoolHref, children, accountId }: LearnerResourceScopeProps) {
  const text = useSchoolText();
  const { search, ready } = useCatalogFilterUrl(
    `campus-judge:problem-scope:v1:${accountId}:${schoolHref}`, scopeKeys, section === "problems",
  );
  const showPublic = search.get("scope") === "public";
  const scopeHref = schoolHref + (schoolHref.includes("?") ? "&" : "?") + "scope=";
  const publicHref = scopeHref + "public";
  const courseId = search.get("publicCourseId");

  return <div className="space-y-4">
    <nav aria-label={text("Learning scope", "学习范围")} className="flex flex-wrap gap-1 border-b border-border">
      {[
        { href: section === "problems" ? scopeHref + "school" : schoolHref, active: !showPublic, label: text("My school", "本校") },
        { href: publicHref, active: showPublic, label: text("Platform public", "平台公开") },
      ].map(tab => <AppLink key={tab.href} href={tab.href} aria-current={tab.active ? "page" : undefined}
        className={`border-b-2 px-4 py-2 text-sm font-semibold ${tab.active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
        {tab.label}
      </AppLink>)}
    </nav>
    {!ready ? <p role="status" className="text-sm text-muted-foreground">{text("Loading problems…", "正在加载题目…")}</p> : showPublic ? (
      section === "problems" ? <PublicPractice accountId={accountId}/>
        : section === "submissions" ? <PublicSubmissions/>
          : section === "review-notebook" ? <PublicReviewNotebook/>
            : courseId ? <PublicCoursePage key={courseId} id={courseId} homeHref={publicHref}/>
              : <PublicCourseCatalog courseHref={id => `${publicHref}&publicCourseId=${encodeURIComponent(id)}`}/>
    ) : children}
  </div>;
}
