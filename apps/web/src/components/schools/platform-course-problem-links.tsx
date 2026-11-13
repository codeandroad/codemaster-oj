"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loading, inputClass, useData } from "@/components/admin/common";
import { useSchoolText } from "./school-ui";

export type PlatformProblemLink = { problemId: string; versionId: string; title?: string };
export function PlatformCourseProblemLinks({ courseId, links, onChange }: { courseId: string; links: PlatformProblemLink[]; onChange: (links: PlatformProblemLink[]) => void }) {
  const text = useSchoolText();
  const [query, setQuery] = useState(""), [selected, setSelected] = useState("");
  const data = useData<{ items: PlatformProblemLink[] }>(`platform/courses/problem-options${courseId ? `?courseId=${courseId}` : ""}`);
  const options = (data.data?.items ?? []).filter(item => !links.some(link => link.problemId === item.problemId) && item.title?.toLowerCase().includes(query.toLowerCase()));
  return <section className="space-y-3 rounded-md border border-border p-3">
    <h3 className="text-sm font-semibold">{text("Linked problems", "关联题目")} ({links.length})</h3>
    <p className="text-xs text-muted-foreground">{text("Learners access these problems through the course. Each link keeps its selected published version.", "学生通过课程权限访问这些题目；关联始终保留所选的已发布版本。")}</p>
    <ul className="divide-y divide-border">{links.map(link => <li key={link.problemId} className="flex items-start justify-between gap-2 py-2 text-sm"><span className="min-w-0 break-words">{link.title ?? link.problemId}</span><Button type="button" size="sm" variant="ghost" onClick={() => onChange(links.filter(item => item.problemId !== link.problemId))}>{text("Unlink", "移除关联")}</Button></li>)}</ul>
    <Loading resource={data}><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <label className="grid gap-1 text-sm sm:col-span-2">{text("Search problems", "搜索题目")}<input className={inputClass} value={query} onChange={e => { setQuery(e.target.value); setSelected(""); }}/></label>
      <select aria-label={text("Published platform problem", "已发布平台题目")} className={`${inputClass} min-w-0`} value={selected} onChange={e => setSelected(e.target.value)}><option value="">{text("Select a problem", "选择题目")}</option>{options.map(item => <option key={item.problemId} value={item.problemId}>{item.title}</option>)}</select>
      <Button type="button" size="sm" variant="secondary" disabled={!options.some(item => item.problemId === selected)} onClick={() => { const item = options.find(item => item.problemId === selected); if (item) { onChange([...links, item]); setSelected(""); } }}>{text("Link problem", "关联题目")}</Button>
    </div></Loading>
  </section>;
}
