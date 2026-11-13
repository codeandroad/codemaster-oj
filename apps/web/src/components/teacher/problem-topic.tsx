"use client";

import { useLocale } from "@/components/locale-context";
import type { ProductionProblem } from "@/lib/production-api";
import styles from "./problem-banks.module.css";

export function ProblemTopic({ tags, draftTags }: Pick<ProductionProblem, "tags" | "draftTags">) {
  const { locale } = useLocale();
  const topics = (draftTags ?? tags)?.join(" · ");
  const hasDraftTopics = draftTags !== undefined && (
    draftTags.length !== (tags?.length ?? 0) || draftTags.some((tag, index) => tag !== tags?.[index])
  );
  return <div className="text-xs text-muted-foreground">
    <span className={styles.singleLine} title={topics}>{topics || "—"}</span>
    {hasDraftTopics && <span className="block">{locale === "zh" ? "草稿标签" : "Draft tags"}</span>}
  </div>;
}
