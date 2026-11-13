"use client";

import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 50;

/** Filtering retains the full catalog; only the current page's rows are mounted. */
export function useCatalogPagination<T>(rows: readonly T[], scope: string) {
  const [position, setPosition] = useState({ scope, page: 1 });
  if (position.scope !== scope) setPosition({ scope, page: 1 });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(position.scope === scope ? position.page : 1, pageCount);
  const offset = (page - 1) * PAGE_SIZE;
  return {
    rows: rows.slice(offset, offset + PAGE_SIZE),
    total: rows.length,
    start: rows.length ? offset + 1 : 0,
    end: Math.min(offset + PAGE_SIZE, rows.length),
    page,
    pageCount,
    onPage: (next: number) => setPosition({ scope, page: Math.max(1, Math.min(next, pageCount)) }),
  };
}

export function CatalogPagination({ total, start, end, page, pageCount, onPage }: {
  total: number; start: number; end: number; page: number; pageCount: number; onPage: (page: number) => void;
}) {
  const { locale } = useLocale();
  if (!total) return null;
  return <nav aria-label={locale === "en" ? "Problem list pages" : "题目列表分页"} className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
    <span aria-live="polite" className="text-muted-foreground">
      {locale === "en" ? `${start}–${end} of ${total} problems` : `第 ${start}–${end} 道，共 ${total} 道题`}
    </span>
    {pageCount > 1 && <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}>{locale === "en" ? "Previous page" : "上一页"}</Button>
      <span>{page} / {pageCount}</span>
      <Button variant="secondary" size="sm" disabled={page === pageCount} onClick={() => onPage(page + 1)}>{locale === "en" ? "Next page" : "下一页"}</Button>
    </div>}
  </nav>;
}
