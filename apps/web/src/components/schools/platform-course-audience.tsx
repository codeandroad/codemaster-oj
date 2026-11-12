"use client";

import { useState } from "react";
import { inputClass, Loading, useData } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { useSchoolText } from "./school-ui";
import type { AudienceMember, CourseAudience } from "./platform-course-model";

export function PlatformCourseAudience({ scope, onScope, selected, onSelected }: {
  scope: CourseAudience; onScope: (scope: CourseAudience) => void;
  selected: AudienceMember[]; onSelected: (items: AudienceMember[]) => void;
}) {
  const text = useSchoolText();
  return <section className="space-y-3">
    <label className="grid gap-2 text-sm font-semibold">{text("Publication audience", "公开范围")}
      <select className={inputClass} value={scope} onChange={event => onScope(event.target.value as CourseAudience)}>
        <option value="all">{text("Everyone on the platform", "全平台公开")}</option>
        <option value="schools">{text("Selected schools", "指定学校公开")}</option>
        <option value="students">{text("Selected students", "指定学生公开")}</option>
      </select>
    </label>
    {scope !== "all" && <AudiencePicker key={scope} kind={scope} selected={selected} onSelected={onSelected}/>}
    <p className="text-xs leading-6 text-muted-foreground">{scope === "all"
      ? text("All signed-in users can study this course once it is published.", "发布后，所有已登录用户均可学习。")
      : scope === "schools" ? text("Current members of the selected schools can study this course.", "所选学校的当前成员可以学习，退出学校后不再具有该范围的访问权限。")
        : text("Only the selected students can study this course.", "仅所选学生可以学习。")}</p>
  </section>;
}

function AudiencePicker({ kind, selected, onSelected }: {
  kind: "schools" | "students"; selected: AudienceMember[]; onSelected: (items: AudienceMember[]) => void;
}) {
  const text = useSchoolText();
  const [query, setQuery] = useState("");
  const resource = useData<{ items: AudienceMember[] }>(`platform/courses/audience?${new URLSearchParams({ kind, q: query })}`);
  const toggle = (item: AudienceMember) => onSelected(selected.some(value => value.id === item.id)
    ? selected.filter(value => value.id !== item.id) : [...selected, item]);
  return <div className="space-y-3 rounded-md border border-border p-3">
    <p className="text-sm font-semibold">{text(`${selected.length} selected`, `已选择 ${selected.length} 项`)}</p>
    {selected.length > 0 && <ul className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">{selected.map(item => <li key={item.id}>
      <Button type="button" size="sm" variant="secondary" aria-label={text(`Remove ${item.name}`, `移除 ${item.name}`)} onClick={() => toggle(item)}>{item.name}{item.username ? ` (${item.username})` : ""} ×</Button>
    </li>)}</ul>}
    <label className="grid gap-2 text-sm">{kind === "schools" ? text("Search schools", "搜索学校") : text("Search name, username or student number", "搜索姓名、用户名或学号")}
      <input type="search" className={inputClass} maxLength={100} value={query} onChange={event => setQuery(event.target.value)}/>
    </label>
    {resource.pending ? <p role="status" className="text-sm text-muted-foreground">{text("Loading…", "正在加载…")}</p> : <Loading resource={resource}>
      <div className="max-h-48 overflow-y-auto">{resource.data?.items.map(item => <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border py-2 text-sm last:border-0">
        <input type="checkbox" className="size-4 accent-primary" checked={selected.some(value => value.id === item.id)} onChange={() => toggle(item)}/>
        <span className="min-w-0 break-words">{item.name}{item.username && <span className="ml-2 text-muted-foreground">{item.username}</span>}</span>
      </label>)}</div>
      {!resource.data?.items.length && <p className="text-sm text-muted-foreground">{kind === "students" && query.length < 2
        ? text("Enter at least two characters to find students.", "输入至少两个字符查找学生。") : text("No matches.", "没有找到匹配项。")}</p>}
    </Loading>}
  </div>;
}
