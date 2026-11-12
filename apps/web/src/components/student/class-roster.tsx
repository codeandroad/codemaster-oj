"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { ProfileAvatar } from "@/components/profile-hero";
import { ApiError, productionApi } from "@/lib/production-api";
import { presenceChanged } from "./student-presence";
import { StudentPresenceCard } from "./student-presence-card";

export interface ClassMember { id: string; displayName: string; avatar: string; isOnline?: boolean; }

export function ClassRoster({ classId, members: initialMembers }: { classId: string; members: ClassMember[] }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const panelId = useId();
  const [members, setMembers] = useState(initialMembers);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const triggers = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let queued = false;
    let stopped = false;
    async function refresh() {
      if (document.visibilityState !== "visible" || controller.signal.aborted || stopped) return;
      if (pending) { queued = true; return; }
      pending = true;
      try {
        const result = await productionApi<{ items: ClassMember[] }>(`classes/${encodeURIComponent(classId)}/members`, { signal: controller.signal });
        if (!controller.signal.aborted) {
          setMembers(result.items); setError(false); setUnavailable(false);
          setSelectedId(current => result.items.some(member => member.id === current) ? current : null);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(true);
          if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) {
            stopped = true; setUnavailable(true); setMembers([]); setSelectedId(null);
          }
        }
      } finally {
        pending = false;
        if (queued) { queued = false; void refresh(); }
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const refreshVisible = () => void refresh();
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener(presenceChanged, refreshVisible);
    return () => {
      controller.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.removeEventListener(presenceChanged, refreshVisible);
    };
  }, [classId, retry]);

  const query = search.trim().toLocaleLowerCase(locale);
  const visible = query ? members.filter(member => member.displayName.toLocaleLowerCase(locale).includes(query)) : members;
  function collapse() {
    if (selectedId) triggers.current.get(selectedId)?.focus({ preventScroll: true });
    setSelectedId(null);
  }

  return <section aria-label={tx("班级同学", "Students")} className="order-first overflow-hidden rounded-lg border border-border bg-surface panel-shadow xl:order-last" onKeyDown={event => {
    if (selectedId && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); collapse(); }
  }}>
    <div className="flex items-center justify-between border-b border-border px-3 py-2.5"><h2 className="text-sm font-semibold">{tx("班级同学", "Students")}</h2><span className="text-xs tabular-nums text-muted-foreground">{members.length}</span></div>
    {members.length > 0 && <div className="p-2"><input type="search" aria-label={tx("搜索班级同学", "Search classmates")} placeholder={tx("搜索同学", "Search students")} value={search} onChange={event => { setSearch(event.target.value); setSelectedId(null); }} className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"/></div>}
    {error && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{unavailable ? tx("班级名单暂不可访问。", "Class roster is unavailable.") : tx("暂时无法更新在线状态。", "Online status could not be updated.")} <button type="button" onClick={() => setRetry(value => value + 1)} className="text-primary underline focus-visible:outline-2 focus-visible:outline-primary">{tx("重试", "Retry")}</button></p>}
    {visible.length ? <ul className={`overflow-y-auto overscroll-contain xl:max-h-96 ${selectedId ? "max-h-96" : "max-h-64"}`}>
      {visible.map(member => {
        const expanded = selectedId === member.id;
        const status = error || member.isOnline === undefined ? tx("状态未知", "Unknown") : member.isOnline ? tx("在线", "Online") : tx("离线", "Offline");
        const online = !error && member.isOnline === true;
        const detailsId = `${panelId}-${member.id}`;
        return <li key={member.id}>
          <button
            ref={element => { if (element) triggers.current.set(member.id, element); else triggers.current.delete(member.id); }}
            type="button"
            aria-label={tx(`查看 ${member.displayName} 的学习近况`, `View recent activity for ${member.displayName}`)}
            aria-describedby={`${detailsId}-status`}
            aria-expanded={expanded}
            aria-controls={expanded ? detailsId : undefined}
            className={`flex min-h-12 w-full cursor-pointer items-center gap-2.5 border-t border-border px-3 py-2 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 ${expanded ? "bg-surface-subtle" : ""}`}
            onClick={() => setSelectedId(expanded ? null : member.id)}
          >
            <ProfileAvatar avatar={member.avatar} nickname={member.displayName}/>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary" title={member.displayName}>{member.displayName}</span>
            <span id={`${detailsId}-status`} className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><span aria-hidden="true" className={`size-1.5 rounded-full ${online ? "bg-success" : "bg-muted-foreground"}`}/>{status}</span>
            <ChevronDown size={15} aria-hidden="true" className={`shrink-0 text-muted-foreground ${expanded ? "rotate-180" : ""}`}/>
          </button>
          {expanded && <div id={detailsId} role="region" aria-label={tx(`${member.displayName} 的学习近况`, `Recent activity for ${member.displayName}`)} className="mx-2 mb-2 flex max-h-[min(280px,60dvh)] flex-col overflow-hidden rounded-md border border-border bg-surface p-1 text-xs">
            <StudentPresenceCard identityId={member.id} variant="disclosure" onBack={collapse} profileHref={`/student/people/${encodeURIComponent(member.id)}`}/>
          </div>}
        </li>;
      })}
    </ul> : !unavailable && <p className="px-3 py-4 text-sm text-muted-foreground">{members.length ? tx("没有匹配的同学", "No matching students") : tx("暂无已激活的学生主页", "No student profiles available yet")}</p>}
  </section>;
}
