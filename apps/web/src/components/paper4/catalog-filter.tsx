"use client";

import { useLocale } from "@/components/locale-context";
import type { Paper4PaperSummary } from "./model";
import { paper4Years } from "./paper4-catalog";
import styles from "./catalog-filter.module.css";

export function Paper4CatalogFilter({ items, year, session, onYear, onSession, compact = false }: {
  items: Paper4PaperSummary[]; year: string; session: string; onYear: (value: string) => void; onSession: (value: string) => void; compact?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const style = "min-h-10 max-w-full rounded-md border border-input bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary";
  return <div className={compact ? styles.compact : "flex flex-wrap items-center gap-3"}>
    <label className="inline-flex items-center gap-2 text-sm font-medium">{tx("年份", "Year")}<select className={style} value={year} onChange={event => onYear(event.target.value)}>
      <option value="">{tx("全部年份", "All years")}</option>
      {paper4Years(items).map(value => <option key={value} value={String(value)}>{value}</option>)}
      {items.some(item => item.examYear == null) && <option value="unclassified">{tx("未分类", "Unclassified")}</option>}
    </select></label>
    <label className="inline-flex items-center gap-2 text-sm font-medium">{tx("考季", "Session")}<select className={style} value={session} onChange={event => onSession(event.target.value)}>
      <option value="">{tx("全部考季", "All sessions")}</option><option value="summer">{tx("夏季 May/June", "May/June")}</option><option value="autumn">{tx("秋季 October/November", "October/November")}</option>
    </select></label>
  </div>;
}
