"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { inputClass } from "@/components/admin/common";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { courseSearchHref, courseSearchMaxLength, courseSearchParameter, courseSearchQuery } from "./learning-course-search-model";

export function useCourseCatalogQuery() {
  const search = useSearchParams();
  const query = courseSearchQuery(search.get(courseSearchParameter) ?? "");
  return [query, (value: string) => {
    const { pathname, search, hash } = window.location;
    const next = courseSearchHref(pathname + search + hash, value);
    if (next !== pathname + search + hash) window.history.replaceState(null, "", next);
  }] as const;
}

export function CourseCatalogSearch({ query, onSearch, onRefresh }: {
  query: string;
  onSearch: (value: string) => void;
  onRefresh?: () => void;
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const label = text("按课程名称或简介搜索", "Search by course title or description");
  const [draft, setDraft] = useState({ query, value: query });
  const input = useRef<HTMLInputElement>(null);
  const value = draft.query === query ? draft.value : query;

  function submit(value: string) {
    const next = courseSearchQuery(value);
    setDraft({ query: next, value: next });
    onSearch(next);
  }

  return <form role="search" aria-label={text("搜索课程", "Search courses")} className="flex min-w-0 flex-wrap items-center gap-2"
    onSubmit={event => { event.preventDefault(); submit(value); }}>
    <input ref={input} type="search" aria-label={label} placeholder={label} maxLength={courseSearchMaxLength} value={value}
      onChange={event => setDraft({ query, value: event.target.value })}
      onKeyDown={event => {
        if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
      }}
      className={`${inputClass} h-9 min-w-0 sm:w-72`} />
    <Button type="submit" size="sm" variant="secondary">{text("搜索", "Search")}</Button>
    {(value || query) && <Button type="button" size="sm" variant="ghost" onClick={() => { submit(""); input.current?.focus(); }}>{text("清除", "Clear")}</Button>}
    {onRefresh && <Button type="button" variant="ghost" size="icon" aria-label={text("刷新", "Refresh")} onClick={onRefresh}>
      <RefreshCw size={15} />
    </Button>}
  </form>;
}
