"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { input } from "./data-state";
import problemStyles from "./problems-page.module.css";

export function ProblemCatalogSearch({ value, onChange, label, maxLength, onCompositionStart, onCompositionEnd }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  maxLength?: number;
  onCompositionStart?: () => void;
  onCompositionEnd?: (value: string) => void;
}) {
  const { locale } = useLocale();
  const ref = useRef<HTMLInputElement>(null);
  return <div className={`${problemStyles.search} min-w-40`}>
    <Search size={16} aria-hidden="true" />
    <input ref={ref} type="search" maxLength={maxLength} aria-label={label} placeholder={label} className={`${input} pr-8`} value={value}
      onChange={event => onChange(event.currentTarget.value)}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={event => onCompositionEnd?.(event.currentTarget.value)} />
    {value && <button type="button" className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" aria-label={locale === "en" ? "Clear search" : "清除搜索"} onClick={() => { onChange(""); ref.current?.focus(); }}><X size={14} aria-hidden="true" /></button>}
  </div>;
}
