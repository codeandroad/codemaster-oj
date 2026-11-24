"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Bell, BookOpen, CircleCheck, CircleX, Gift, Inbox, MessageCircle, MessageSquareText } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { productionApi } from "@/lib/production-api";
import { date, useData } from "./data-state";
import { notificationFeed, notificationTabs, type Notification, type NotificationTab } from "./notification-feed";

interface NotificationPage {
  items: Notification[];
  unreadCount: number;
  total: number;
}
const ui = (locale: AppLocale, zh: string, en: string) => locale === "en" ? en : zh;
const tabNames = { social: ["互动", "Social"], updates: ["动态", "Updates"], events: ["活动", "Events"] } as const;
const tabStorageKey = "notification-dropdown-tab";

function readStoredTab(): NotificationTab | null {
  try {
    const value = window.localStorage.getItem(tabStorageKey);
    return value && (notificationTabs as readonly string[]).includes(value) ? value as NotificationTab : null;
  } catch { return null; }
}

function writeStoredTab(tab: NotificationTab) {
  try { window.localStorage.setItem(tabStorageKey, tab); } catch { /* ignore */ }
}

function notificationContent(item: Notification, locale: AppLocale, scholarshipHref: string, schoolId?: string, role: "student" | "teacher" | "admin" = "student") {
  switch (item.kind) {
    case "guestbook":
      return {
        title: item.interaction === "mention"
          ? ui(locale, `${item.authorNickname} 在主页留言中提到了你`, `${item.authorNickname} mentioned you in a profile message`)
          : item.interaction === "reply"
            ? ui(locale, `${item.authorNickname} 回复了主页留言`, `${item.authorNickname} replied to a profile message`)
            : ui(locale, `${item.authorNickname} 给你的主页留言`, `${item.authorNickname} left a message on your profile`),
        body: item.body, href: `/${item.practice ? "practice" : role}/people/${encodeURIComponent(item.profileIdentityId)}?from=profile#profile-guestbook`, icon: MessageCircle,
      };
    case "teacher_feedback":
      return {
        title: ui(locale, "收到教师反馈", "New teacher feedback"), body: item.problemTitle,
        href: schoolId && item.submissionId ? `/schools?${new URLSearchParams({schoolId,section:"submissions",submissionId:item.submissionId})}` : `/student/review-notebook/${encodeURIComponent(item.reviewId)}`, icon: MessageSquareText,
      };
    case "assignment_change": {
      const labels = {
        assigned: ui(locale, "新作业已发布", "New assignment published"),
        cancelled: ui(locale, "作业已取消", "Assignment cancelled"),
        extended: ui(locale, "作业截止时间已延后", "Assignment deadline extended"),
        exempted: ui(locale, "你已获作业豁免", "You have been exempted"),
        reinstated: ui(locale, "已恢复作业参与", "Assignment reinstated"),
      };
      const deadline = item.dueAt ? ui(locale, `截止 ${date(item.dueAt, locale)}`, `Due ${date(item.dueAt, locale)}`) : undefined;
      const query = schoolId ? new URLSearchParams({ schoolId, section: "assignments" }) : null;
      return {
        title: labels[item.action],
        body: [item.activityTitle, deadline, item.reason].filter(Boolean).join(" · "),
        href: query ? `/schools?${query}` : "/student/assignments",
        icon: BookOpen,
      };
    }
    case "assignment_reminder": {
      const query = schoolId ? new URLSearchParams({ schoolId, section: "assignments" }) : null;
      return {
        title: ui(locale, "作业截止提醒", "Assignment deadline reminder"),
        body: [item.activityTitle, ui(locale, `截止 ${date(item.dueAt, locale)}`, `Due ${date(item.dueAt, locale)}`)].join(" · "),
        href: query ? `/schools?${query}` : `/student/assignments/${encodeURIComponent(item.assignmentId)}`,
        icon: BookOpen,
      };
    }
    case "course_application": {
      const query = new URLSearchParams({ courseId: item.courseId, applicationId: item.id });
      if (schoolId) {
        query.set("schoolId", schoolId);
        query.set("section", "course-admissions");
      }
      return {
        title: ui(locale, "新的课程访问申请", "New course access request"), body: item.courseTitle,
        href: `${schoolId ? "/schools" : "/admin/course-admissions"}?${query}`, icon: BookOpen,
      };
    }
    case "course_application_result":
      return item.outcome === "approved"
        ? {
            title: ui(locale, "课程申请已批准", "Course request approved"),
            body: item.courseTitle,
            href: `/practice/courses/${encodeURIComponent(item.listingId)}`,
            icon: CircleCheck,
          }
        : {
            title: ui(locale, "课程申请已拒绝", "Course request declined"),
            body: item.courseTitle,
            href: undefined,
            icon: CircleX,
          };
    case "scholarship_grant":
    case "activity_reward":
      return {
        title: item.kind === "activity_reward"
          ? ui(locale, `任务奖励到账 · +${item.amount} 金`, `Activity reward received · +${item.amount}`)
          : ui(locale, `奖学金到账 · +${item.amount} 金`, `Scholarship received · +${item.amount}`),
        body: item.activityTitle || item.reason, href: scholarshipHref, icon: Gift,
      };
  }
}

export function NotificationDropdown({ schoolId, scholarshipHref = "/student/scholarship", workspace = "student", role = "student" }: {
  schoolId?: string;
  scholarshipHref?: string;
  workspace?: "student" | "staff" | "public" | "platform";
  role?: "student" | "teacher" | "admin";
} = {}) {
  const { locale } = useLocale();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState<NotificationTab | null>(null);

  function selectTab(tab: NotificationTab) {
    setSelectedTab(tab);
    writeStoredTab(tab);
  }
  const [position, setPosition] = useState({ left: 0, top: 0, width: 360 });
  const [markError, setMarkError] = useState("");
  const [marking, setMarking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const legacyStudent = workspace === "student" && !schoolId;
  const site = useData<{ announcement: string }>(legacyStudent ? "site-info" : "");
  const inboxPath = workspace === "platform" || workspace === "public" ? "account-notifications"
    : `${schoolId ? `schools/${encodeURIComponent(schoolId)}/` : ""}${workspace}-notifications`;
  const messages = useData<NotificationPage>(inboxPath ? `${inboxPath}?pageSize=10` : "");
  const reloadMessages = messages.reload;

  useEffect(() => {
    if (open) return;
    const poll = () => { if (document.visibilityState === "visible") reloadMessages(); };
    const timer = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [open, reloadMessages]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const feed = useMemo(() => notificationFeed(messages.data?.items), [messages.data?.items]);
  const activeTab = selectedTab ?? feed.latestTab;
  const nativeTabFocus = open && Object.hasOwn(HTMLElement.prototype, "focusGroup");
  const activeEntries = feed.entries[activeTab];
  const announcement = activeTab === "updates" ? site.data?.announcement : undefined;
  const unread = messages.data?.unreadCount ?? 0;
  const error = messages.error || (activeTab === "updates" && site.error);
  const loading = messages.loading || (activeTab === "updates" && site.loading);
  const empty = !announcement && !activeEntries.length;
  const refresh = () => { if (activeTab === "updates") site.reload(); reloadMessages(); };

  function markRead(item: Notification) {
    if (!item.readAt) void productionApi(`${inboxPath}/${encodeURIComponent(item.id)}/read`, { method: "POST" })
      .then(messages.reload).catch(() => setMarkError("failed"));
  }

  async function markAllRead() {
    if (!unread || marking) return;
    setMarking(true); setMarkError("");
    try {
      await productionApi(`${inboxPath}/read-all`, { method: "POST" });
      messages.reload();
    } catch { setMarkError("failed"); }
    finally { setMarking(false); }
  }

  return <div ref={root} className="relative shrink-0" data-od-id="notification-dropdown"
    onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" aria-label={unread ? ui(locale, `通知，${unread} 条未读`, `Notifications, ${unread} unread`) : ui(locale, "通知", "Notifications")} title={ui(locale, "通知", "Notifications")}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => {
        if (open) { setOpen(false); return; }
        const rect = trigger.current?.getBoundingClientRect();
        if (rect) {
          const width = Math.min(360, window.innerWidth - 24);
          setPosition({ width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), top: rect.bottom + 8 });
        }
        setSelectedTab(readStoredTab());
        setOpen(true);
        site.reload();
        reloadMessages();
      }} className="relative grid h-11 w-11 place-items-center rounded-md text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
      <Bell size={19} strokeWidth={1.7}/>
      {unread > 0 && <span aria-hidden="true" className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
    </button>
    {open && <section id={panelId} aria-label={ui(locale, "通知列表", "Notification list")} style={{ position: "fixed", ...position, maxHeight: `calc(100dvh - ${position.top + 12}px)` }}
      onFocusCapture={() => setSelectedTab(current => current ?? activeTab)}
      className="z-[60] flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-xl">
      <header className="flex shrink-0 flex-wrap items-center justify-between border-b border-border px-2">
        <div role="tablist" aria-label={ui(locale, "通知分类", "Notification categories")} className="flex"
          {...{ focusgroup: "tablist nomemory wrap" }}>
          {notificationTabs.map((tab, index) => <button key={tab} type="button" role="tab" id={`${panelId}-${tab}`}
            aria-selected={activeTab === tab} tabIndex={nativeTabFocus ? undefined : activeTab === tab ? 0 : -1}
            {...(activeTab === tab ? { focusgroupstart: "" } : {})}
            onFocus={() => selectTab(tab)} onClick={() => selectTab(tab)}
            onKeyDown={event => {
              const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? notificationTabs.length - 1
                : !nativeTabFocus && event.key === "ArrowRight" ? (index + 1) % notificationTabs.length
                : !nativeTabFocus && event.key === "ArrowLeft" ? (index + notificationTabs.length - 1) % notificationTabs.length
                : null;
              if (nextIndex === null) return;
              event.preventDefault();
              document.getElementById(`${panelId}-${notificationTabs[nextIndex]}`)?.focus();
            }}
            className="relative h-11 cursor-pointer whitespace-nowrap px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary aria-selected:text-foreground aria-selected:after:absolute aria-selected:after:inset-x-2.5 aria-selected:after:bottom-0 aria-selected:after:border-b-2 aria-selected:after:border-current sm:text-sm">
            {tabNames[tab][locale === "en" ? 1 : 0]}
            {feed.unread[tab] && <><span aria-hidden="true" className="absolute right-1 top-2 size-1.5 rounded-full bg-primary"/><span className="sr-only">{ui(locale, "（有未读）", " (unread)")}</span></>}
          </button>)}
        </div>
        <Button type="button" size="sm" variant="ghost" aria-disabled={!unread || marking} onClick={() => void markAllRead()}
          className="cursor-pointer px-2 aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground">
          {ui(locale, "全部已读", "Mark all read")}
        </Button>
      </header>
      {notificationTabs.map(tab => <div key={tab} role="tabpanel" aria-labelledby={`${panelId}-${tab}`} hidden={activeTab !== tab}
        tabIndex={activeTab === tab ? 0 : undefined}
        className="max-h-[480px] min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
        {activeTab === tab && <>
        {markError && <p role="alert" className="px-4 py-2 text-xs text-destructive">{markError === "failed" ? ui(locale, "标记失败，请重试。", "Could not mark notifications as read. Try again.") : markError}</p>}
        {error && <div role="alert" className="border-b border-border p-4 text-sm"><p className="text-destructive">{error}</p><button type="button" className="mt-2 min-h-9 rounded border border-border px-3 hover:bg-muted" onClick={refresh}>{ui(locale, "重试", "Retry")}</button></div>}
        {announcement && <article className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">{ui(locale, "站点公告", "Announcement")}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5">{announcement}</p></article>}
        {activeEntries.map(entry => {
          const { item } = entry;
          const { title, body, href, icon: Icon } = notificationContent(item, locale, scholarshipHref, schoolId, role);
          const rowClass = `flex w-full gap-3 border-b border-border px-4 py-3 text-left text-foreground ${item.readAt ? "" : "bg-accent/40"}`;
          const interactiveClass = `${rowClass} hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary`;
          const badge = item.kind === "guestbook"
            ? (item.authorAvatar
              ? <Image src={item.authorAvatar} width={40} height={40} unoptimized alt="" className="size-10 shrink-0 rounded-full object-cover"/>
              : <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-primary">{Array.from(item.authorNickname)[0]}</span>)
            : <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-primary"/>;
          const row = <>
            {badge}
            <span className="min-w-0">
              <span className={`block break-words text-sm ${item.readAt ? "font-normal" : "font-medium"}`}>{title}</span>
              {body && <span className="mt-1 line-clamp-2 block break-words text-xs text-muted-foreground">{body}</span>}
              <time dateTime={item.createdAt} className="mt-1 block text-xs text-muted-foreground">{date(item.createdAt, locale)}</time>
            </span>
            {!item.readAt && <span className="ml-auto mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={ui(locale, "未读", "Unread")}/>}
          </>;
          if (href) return <AppLink key={item.id} href={href} onNavigate={() => {
            setOpen(false);
            markRead(item);
          }} className={interactiveClass}>{row}</AppLink>;
          if (item.readAt) return <article key={item.id} className={rowClass}>{row}</article>;
          return <button key={item.id} type="button" className={interactiveClass} onClick={() => {
            markRead(item);
            trigger.current?.focus();
          }}>{row}</button>;
        })}
        {loading && empty && <p role="status" className="min-h-32 p-5 text-sm text-muted-foreground">{ui(locale, "正在加载…", "Loading…")}</p>}
        {!loading && empty && !error && <div className="flex min-h-32 flex-col items-center justify-center gap-3 px-4 py-6 text-muted-foreground"><Inbox size={26} strokeWidth={1.4} aria-hidden="true"/><p className="text-sm">{ui(locale, "暂无近期通知", "No recent notifications")}</p></div>}
        </>}
      </div>)}
      {legacyStudent && activeTab === "events" && <footer className="shrink-0 px-4 py-2"><AppLink href="/student/assignments" onNavigate={() => setOpen(false)} className="flex min-h-10 items-center justify-center rounded-md text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">{ui(locale, "查看全部作业", "View all assignments")}</AppLink></footer>}
    </section>}
  </div>;
}
