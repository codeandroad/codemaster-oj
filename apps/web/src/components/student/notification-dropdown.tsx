"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Inbox, MessageCircle } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import type { Assignment } from "@/lib/production-api";
import { date, useData } from "./shared";

interface GuestbookNotification {
  id: string;
  messageId: string;
  profileIdentityId: string;
  body: string;
  authorNickname: string;
  createdAt: string;
  readAt: string | null;
}
interface NotificationPage {
  items: GuestbookNotification[];
  unreadCount: number;
  total: number;
}

export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 360 });
  const [markError, setMarkError] = useState("");
  const [marking, setMarking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const assignments = useData<{ items: Assignment[] }>("assignments");
  const site = useData<{ announcement: string }>("site-info");
  const messages = useData<NotificationPage>("student-notifications?pageSize=10");
  const reloadMessages = messages.reload;

  useEffect(() => {
    const poll = () => { if (document.visibilityState === "visible") reloadMessages(); };
    const timer = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [reloadMessages]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const refresh = () => { assignments.reload(); site.reload(); messages.reload(); };
  const unread = messages.data?.unreadCount ?? 0;
  const error = messages.error || assignments.error || site.error;
  const loading = messages.loading || assignments.loading || site.loading;
  const empty = !site.data?.announcement && !messages.data?.items.length && !assignments.data?.items.length;

  async function markAllRead() {
    setMarking(true); setMarkError("");
    try {
      await productionApi("student-notifications/read-all", { method: "POST" });
      messages.reload();
    } catch { setMarkError("标记失败，请重试。"); }
    finally { setMarking(false); }
  }

  return <div ref={root} className="relative shrink-0" data-od-id="notification-dropdown"
    onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={trigger} type="button" aria-label={unread ? `通知，${unread} 条未读` : "通知"} title="通知"
      aria-expanded={open} aria-controls="classroom-notifications"
      onClick={() => {
        const rect = trigger.current?.getBoundingClientRect();
        if (rect) {
          const width = Math.min(360, window.innerWidth - 24);
          setPosition({ width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), top: rect.bottom + 8 });
        }
        setOpen(!open);
        if (!open) refresh();
      }} className="relative grid h-11 w-11 place-items-center rounded-md text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
      <Bell size={19} strokeWidth={1.7}/>
      {unread > 0 && <span aria-hidden="true" className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
    </button>
    {open && <section id="classroom-notifications" aria-label="通知列表" style={{ position: "fixed", ...position }}
      className="z-[60] w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-xl">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div><h2 className="text-sm font-semibold">通知</h2><p className="mt-1 text-xs text-muted-foreground">主页留言、站点公告与作业提醒</p></div>
        {unread > 0 && <Button size="sm" variant="ghost" disabled={marking} onClick={() => void markAllRead()}>全部已读</Button>}
      </header>
      <div className="max-h-[min(480px,70dvh)] overflow-y-auto">
        {markError && <p role="alert" className="px-4 py-2 text-xs text-destructive">{markError}</p>}
        {error && <div role="alert" className="border-b border-border p-4 text-sm"><p className="text-destructive">{error}</p><button type="button" className="mt-2 min-h-9 rounded border border-border px-3 hover:bg-muted" onClick={refresh}>重试</button></div>}
        {site.data?.announcement && <article className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">站点公告</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5">{site.data.announcement}</p></article>}
        {messages.data?.items.map(item => <AppLink key={item.id} href={`/student/people/${encodeURIComponent(item.profileIdentityId)}?from=profile`}
          onNavigate={() => {
            setOpen(false);
            if (!item.readAt) void productionApi(`student-notifications/${encodeURIComponent(item.id)}/read`, { method: "POST" }).then(messages.reload).catch(() => {});
          }}
          className={`flex gap-3 border-b border-border px-4 py-3 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary ${item.readAt ? "" : "bg-accent/40"}`}>
          <MessageCircle size={16} className="mt-0.5 shrink-0 text-primary"/>
          <span className="min-w-0"><span className="block break-words text-sm font-medium">{item.authorNickname} 给你的主页留言</span><span className="mt-1 line-clamp-2 block break-words text-xs text-muted-foreground">{item.body}</span><time dateTime={item.createdAt} className="mt-1 block text-xs text-muted-foreground">{date(item.createdAt)}</time></span>
          {!item.readAt && <span className="ml-auto mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="未读"/>}
        </AppLink>)}
        {assignments.data?.items.map(item => <AppLink key={item.id} href={`/student/assignments/${item.id}`} onNavigate={() => setOpen(false)}
          className="block border-b border-border px-4 py-3 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
          <p className="break-words text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">截止：{new Date(item.dueAt).toLocaleString("zh-CN", { hour12: false })}</p>
        </AppLink>)}
        {loading && empty && <p role="status" className="p-5 text-sm text-muted-foreground">正在加载…</p>}
        {!loading && empty && !error && <div className="flex min-h-32 flex-col items-center justify-center gap-3 px-4 py-6 text-muted-foreground"><Inbox size={26} strokeWidth={1.4}/><p className="text-sm">暂无通知</p></div>}
      </div>
      <footer className="px-4 py-2"><AppLink href="/student/assignments" onNavigate={() => setOpen(false)} className="flex min-h-10 items-center justify-center rounded-md text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">查看全部作业</AppLink></footer>
    </section>}
  </div>;
}
