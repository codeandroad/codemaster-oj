"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BookOpen, CircleCheck, CircleX, Gift, Inbox, MessageCircle, MessageSquareText } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { productionApi } from "@/lib/production-api";
import type { Assignment } from "@/lib/production-api";
import { date, useData } from "./shared";

interface NotificationBase {
  id: string;
  createdAt: string;
  readAt: string | null;
}
interface GuestbookNotification extends NotificationBase {
  kind: "guestbook";
  messageId: string;
  profileIdentityId: string;
  body: string;
  authorNickname: string;
}
interface ScholarshipNotification extends NotificationBase {
  kind: "scholarship_grant" | "activity_reward";
  amount: number;
  reason?: string;
  activityTitle?: string;
}
interface FeedbackNotification extends NotificationBase {
  kind: "teacher_feedback";
  reviewId: string;
  problemTitle: string;
}
interface CourseApplicationNotification extends NotificationBase {
  kind: "course_application";
  courseId: string;
  courseTitle: string;
}
interface CourseApplicationResultNotification extends NotificationBase {
  kind: "course_application_result";
  listingId: string;
  courseTitle: string;
  outcome: "approved" | "rejected";
}
type Notification = GuestbookNotification | ScholarshipNotification | FeedbackNotification | CourseApplicationNotification | CourseApplicationResultNotification;
interface NotificationPage {
  items: Notification[];
  unreadCount: number;
  total: number;
}
const ui = (locale: AppLocale, zh: string, en: string) => locale === "en" ? en : zh;

function notificationContent(item: Notification, locale: AppLocale, scholarshipHref: string, schoolId?: string) {
  switch (item.kind) {
    case "guestbook":
      return {
        title: ui(locale, `${item.authorNickname} 给你的主页留言`, `${item.authorNickname} left a message on your profile`),
        body: item.body, href: `/student/people/${encodeURIComponent(item.profileIdentityId)}?from=profile`, icon: MessageCircle,
      };
    case "teacher_feedback":
      return {
        title: ui(locale, "收到教师反馈", "New teacher feedback"), body: item.problemTitle,
        href: `/student/review-notebook/${encodeURIComponent(item.reviewId)}`, icon: MessageSquareText,
      };
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

export function NotificationDropdown({ schoolId, scholarshipHref = "/student/scholarship", workspace = "student" }: {
  schoolId?: string;
  scholarshipHref?: string;
  workspace?: "student" | "staff" | "public" | "platform";
} = {}) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 360 });
  const [markError, setMarkError] = useState("");
  const [marking, setMarking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const legacyStudent = workspace === "student" && !schoolId;
  const assignments = useData<{ items: Assignment[] }>(legacyStudent && open ? "assignments" : "");
  const site = useData<{ announcement: string }>(legacyStudent ? "site-info" : "");
  const inboxPath = workspace === "platform" || workspace === "public" ? "account-notifications"
    : `${schoolId ? `schools/${encodeURIComponent(schoolId)}/` : ""}${workspace}-notifications`;
  const messages = useData<NotificationPage>(inboxPath ? `${inboxPath}?pageSize=10` : "");
  const reloadMessages = messages.reload;

  useEffect(() => {
    if (!inboxPath) return;
    const poll = () => { if (document.visibilityState === "visible") reloadMessages(); };
    const timer = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [inboxPath, reloadMessages]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const refresh = () => { if (open) assignments.reload(); site.reload(); messages.reload(); };
  const unread = messages.data?.unreadCount ?? 0;
  const error = messages.error || assignments.error || site.error;
  const loading = messages.loading || assignments.loading || site.loading;
  const empty = !site.data?.announcement && !messages.data?.items.length && !assignments.data?.items.length;

  function markRead(item: Notification) {
    if (!item.readAt) void productionApi(`${inboxPath}/${encodeURIComponent(item.id)}/read`, { method: "POST" })
      .then(messages.reload).catch(() => setMarkError("failed"));
  }

  async function markAllRead() {
    setMarking(true); setMarkError("");
    try {
      await productionApi(`${inboxPath}/read-all`, { method: "POST" });
      messages.reload();
    } catch { setMarkError("failed"); }
    finally { setMarking(false); }
  }

  return <div ref={root} className="relative shrink-0" data-od-id="notification-dropdown"
    onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={trigger} type="button" aria-label={unread ? ui(locale, `通知，${unread} 条未读`, `Notifications, ${unread} unread`) : ui(locale, "通知", "Notifications")} title={ui(locale, "通知", "Notifications")}
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
    {open && <section id="classroom-notifications" aria-label={ui(locale, "通知列表", "Notification list")} style={{ position: "fixed", ...position }}
      className="z-[60] w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-surface text-foreground shadow-xl">
      <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div><h2 className="text-sm font-semibold">{ui(locale, "通知", "Notifications")}</h2><p className="mt-1 text-xs text-muted-foreground">{legacyStudent
          ? ui(locale, "奖学金、教师反馈、留言和作业提醒", "Scholarships, teacher feedback, profile messages, and assignment reminders")
          : workspace === "student"
            ? ui(locale, "奖学金与学习通知", "Scholarship and learning notifications")
            : ui(locale, "工作区通知", "Workspace notifications")}</p></div>
        {unread > 0 && <Button size="sm" variant="ghost" disabled={marking} onClick={() => void markAllRead()}>{ui(locale, "全部已读", "Mark all read")}</Button>}
      </header>
      <div className="max-h-[min(480px,70dvh)] overflow-y-auto">
        {markError && <p role="alert" className="px-4 py-2 text-xs text-destructive">{markError === "failed" ? ui(locale, "标记失败，请重试。", "Could not mark notifications as read. Try again.") : markError}</p>}
        {error && <div role="alert" className="border-b border-border p-4 text-sm"><p className="text-destructive">{error}</p><button type="button" className="mt-2 min-h-9 rounded border border-border px-3 hover:bg-muted" onClick={refresh}>{ui(locale, "重试", "Retry")}</button></div>}
        {site.data?.announcement && <article className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">{ui(locale, "站点公告", "Announcement")}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5">{site.data.announcement}</p></article>}
        {messages.data?.items.map(item => {
          const { title, body, href, icon: Icon } = notificationContent(item, locale, scholarshipHref, schoolId);
          const rowClass = `flex w-full gap-3 border-b border-border px-4 py-3 text-left text-foreground ${item.readAt ? "" : "bg-accent/40"}`;
          const interactiveClass = `${rowClass} hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary`;
          const row = <>
            <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-primary"/>
            <span className="min-w-0">
              <span className="block break-words text-sm font-medium">{title}</span>
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
        {assignments.data?.items.map(item => <AppLink key={item.id} href={`/student/assignments/${item.id}`} onNavigate={() => setOpen(false)}
          className="block border-b border-border px-4 py-3 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
          <p className="break-words text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{ui(locale, "截止：", "Due: ")}{new Date(item.dueAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}</p>
        </AppLink>)}
        {loading && empty && <p role="status" className="p-5 text-sm text-muted-foreground">{ui(locale, "正在加载…", "Loading…")}</p>}
        {!loading && empty && !error && <div className="flex min-h-32 flex-col items-center justify-center gap-3 px-4 py-6 text-muted-foreground"><Inbox size={26} strokeWidth={1.4}/><p className="text-sm">{ui(locale, "暂无通知", "No notifications")}</p></div>}
      </div>
      {legacyStudent && <footer className="px-4 py-2"><AppLink href="/student/assignments" onNavigate={() => setOpen(false)} className="flex min-h-10 items-center justify-center rounded-md text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">{ui(locale, "查看全部作业", "View all assignments")}</AppLink></footer>}
    </section>}
  </div>;
}
