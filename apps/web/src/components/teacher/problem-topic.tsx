"use client";

import { useLocale } from "@/components/locale-context";
import { StatusPill } from "@/components/page-chrome";
import type { ProductionProblem } from "@/lib/production-api";
import styles from "./problem-banks.module.css";

export function ProblemTopic({ tags, draftTags }: Pick<ProductionProblem, "tags" | "draftTags">) {
  const topics = (draftTags ?? tags)?.join(" · ");
  return <span className={`${styles.singleLine} text-xs text-muted-foreground`} title={topics}>{topics || "—"}</span>;
}

export function ProblemTopicDraftStatus({ problem }: { problem: Pick<ProductionProblem, "published" | "tags" | "draftTags" | "draftReviewStatus"> }) {
  const { locale } = useLocale();
  const { published, tags, draftTags } = problem;
  if (problem.draftReviewStatus === "pending") return <StatusPill status={locale === "zh" ? "待平台审核" : "In review"} tone="warning" />;
  if (!published || !draftTags || (draftTags.length === (tags?.length ?? 0) && draftTags.every((tag, index) => tag === tags?.[index]))) return null;
  return <StatusPill status={locale === "zh" ? "有草稿" : "Draft"} tone="warning" />;
}
