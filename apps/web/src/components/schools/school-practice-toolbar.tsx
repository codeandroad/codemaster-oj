"use client";

import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";

export type PracticeNavigation = {
  items: { id: string; title: string }[];
  currentId: string;
  onSelect: (id: string) => void;
};

export function PracticeToolbar({ title, onBack, backLabel, navigation }: {
  title: string;
  onBack: () => void;
  backLabel?: string;
  navigation?: PracticeNavigation;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const index = navigation?.items.findIndex(item => item.id === navigation.currentId) ?? -1;
  const previous = index > 0 ? navigation?.items[index - 1] : undefined;
  const next = index >= 0 ? navigation?.items[index + 1] : undefined;
  return <nav className="flex min-w-0 flex-wrap items-center gap-1" aria-label={tx("题目导航", "Problem navigation")}>
    <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={15} aria-hidden="true"/>{backLabel ?? tx("题目列表", "Problem list")}</Button>
    {navigation && <>
      <span className="mx-1 h-5 border-l border-border" aria-hidden="true"/>
      <Button size="sm" variant="ghost" disabled={!previous} aria-label={tx("上一题", "Previous problem")} title={previous?.title ?? tx("上一题", "Previous problem")} onClick={() => { if (previous) navigation.onSelect(previous.id); }}><ChevronLeft size={17} aria-hidden="true"/></Button>
      <Button size="sm" variant="ghost" disabled={!next} aria-label={tx("下一题", "Next problem")} title={next?.title ?? tx("下一题", "Next problem")} onClick={() => { if (next) navigation.onSelect(next.id); }}><ChevronRight size={17} aria-hidden="true"/></Button>
      {index >= 0 && <span className="px-1 text-xs tabular-nums text-muted-foreground">{index + 1}/{navigation.items.length}</span>}
    </>}
    <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium" title={title}>{title}</span>
  </nav>;
}
