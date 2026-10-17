"use client";

import { useState } from "react";
import { Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-context";
import { addAudienceSelection, filterAudienceStudents, type AudienceStudent, type AudienceClass } from "./student-audience";

const control = "min-h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary";
const emptySet = new Set<string>();

export function StudentAudienceSelector({ students, classes, selectedIds, onChange, loading = false, error = "", onReload, disabled = false, lockedIds = emptySet, exemptIds = emptySet }: {
  students: AudienceStudent[];
  classes: AudienceClass[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  error?: string;
  onReload?: () => void;
  disabled?: boolean;
  lockedIds?: ReadonlySet<string>;
  exemptIds?: ReadonlySet<string>;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [scope, setScope] = useState("all"), [query, setQuery] = useState(""), [selectionError, setSelectionError] = useState("");
  const shown = filterAudienceStudents(students, scope, query, selectedIds);
  const selectable = shown.filter(student => !exemptIds.has(student.id));
  const selected = new Set(selectedIds);
  const classLabels = (student: AudienceStudent) => student.classNames?.length ? student.classNames.join(" / ") : student.classIds?.length ? student.classIds.map(id => classes.find(item => item.id === id)?.name ?? tx("班级", "Class")).join(" / ") : student.historical ? tx("历史名单成员", "Historical recipient") : tx("未分班", "No class");
  function add(ids: string[]) {
    setSelectionError("");
    try { onChange(addAudienceSelection(selectedIds, ids, exemptIds)); }
    catch { setSelectionError(tx("最多选择 500 名学生，请缩小筛选范围后选择。", "Select up to 500 students. Narrow the filter before selecting all.")); }
  }
  return <section aria-label={tx("选择布置学生", "Select recipients")} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm"><Users size={17} aria-hidden="true"/><strong>{tx(`已选择 ${selectedIds.length} 名学生`, `${selectedIds.length} students selected`)}</strong><span className="text-xs text-muted-foreground">{tx(`当前显示 ${shown.length} 人`, `${shown.length} shown`)}</span></div>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" disabled={disabled || loading || !selectable.length} onClick={() => add(selectable.map(student => student.id))}>{tx("选择筛选结果", "Select matching")}</Button><Button type="button" size="sm" variant="ghost" disabled={disabled || !selectedIds.some(id => !lockedIds.has(id))} onClick={() => { setSelectionError(""); onChange(selectedIds.filter(id => lockedIds.has(id))); }}>{tx("清空可移除项", "Clear removable")}</Button></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-[minmax(180px,1fr)_minmax(220px,2fr)]">
      <label className="grid gap-1 text-sm font-semibold">{tx("班级筛选", "Class filter")}<select className={control} value={scope} onChange={event => setScope(event.target.value)}><option value="all">{tx("全部学生（含未分班）", "All students (including no class)")}</option><option value="unassigned">{tx("未分班学生", "Students without a class")}</option><option value="selected">{tx("仅已选学生", "Selected students")}</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold">{tx("搜索学生", "Search students")}<span className="relative"><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-muted-foreground"/><input type="search" onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} className={`${control} w-full pl-9`} value={query} onChange={event => setQuery(event.target.value)} placeholder={tx("姓名或学号", "Name or student number")}/></span></label>
    </div>
    <p className="text-xs text-muted-foreground">{tx("可跨班级选择，也可选择未分班学生；切换筛选不会清空已选名单。", "Select across classes or choose students without a class. Changing filters keeps your selection.")}</p>
    {loading && <p role="status" className="text-sm text-muted-foreground">{tx("正在加载学生名单…", "Loading students…")}</p>}
    {error && <div role="alert" className="text-sm text-destructive">{error}{onReload && <Button type="button" size="sm" variant="secondary" className="ml-2" onClick={onReload}>{tx("重试", "Retry")}</Button>}</div>}
    {selectionError && <p role="alert" className="text-sm text-destructive">{selectionError}</p>}
    <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
      {shown.map(student => {
        const checked = selected.has(student.id), locked = checked && lockedIds.has(student.id), exempt = exemptIds.has(student.id);
        return <label key={student.id} className={`flex min-h-16 items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 ${checked ? "bg-info-soft" : "bg-surface hover:bg-surface-subtle"}`}><input type="checkbox" className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-primary" checked={checked} disabled={disabled || locked || exempt || (!checked && selectedIds.length >= 500)} onChange={event => event.target.checked ? add([student.id]) : onChange(selectedIds.filter(id => id !== student.id))}/><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{student.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{student.number}</span></span><span className="mt-1 block text-xs text-muted-foreground">{classLabels(student)}</span>{locked && <span className="mt-1 block text-xs text-muted-foreground">{tx("已有分配记录，须保留在名单中", "This existing recipient must remain assigned")}</span>}{exempt && <span className="mt-1 block text-xs text-muted-foreground">{tx("已豁免，请在进度页恢复", "Exempt; restore access on the progress page")}</span>}</span><span className={`shrink-0 text-xs ${checked ? "font-semibold text-primary" : "text-muted-foreground"}`}>{exempt ? tx("已豁免", "Exempt") : checked ? tx("已选", "Selected") : tx("未选", "Not selected")}</span></label>;
      })}
      {!loading && !shown.length && <p className="p-5 text-center text-sm text-muted-foreground">{tx("没有符合条件的学生。", "No students match these filters.")}</p>}
    </div>
  </section>;
}
