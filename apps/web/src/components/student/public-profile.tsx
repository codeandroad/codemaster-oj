"use client";

import Image from "next/image";
import { useState } from "react";
import { Award, Flag, MessageCircle, Trash2 } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { ProfileHero } from "@/components/profile-hero";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { productionApi, type CampusRole, type CampusUser } from "@/lib/production-api";
import { Feedback, State, date, panel, textarea, useData, useMutation } from "./shared";

interface PublicProfile {
  id: string;
  nickname: string;
  avatar: string | null;
  bio: string | null;
  points: number;
  rankPoints: number;
  solvedProblems: number;
  isSelf: boolean;
}
interface ProfileActivity {
  id: string;
  type: "first_ac";
  problemId: string;
  problemTitle: string;
  points: number;
  createdAt: string;
}
interface GuestbookMessage {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; nickname: string; avatar: string | null };
  canDelete: boolean;
  canReport: boolean;
  reportedByMe: boolean;
}
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const pageSize = 5;
const reportReasons = [
  { value: "spam", label: "广告或刷屏" },
  { value: "abuse", label: "辱骂或骚扰" },
  { value: "privacy", label: "泄露个人信息" },
  { value: "other", label: "其他不合适内容" },
] as const;
type ReportReason = typeof reportReasons[number]["value"];
const ui = (locale: AppLocale, zh: string, en: string) => locale === "en" ? en : zh;
const englishReportReasons: Record<ReportReason, string> = { spam: "Spam or advertising", abuse: "Abuse or harassment", privacy: "Personal information disclosed", other: "Other inappropriate content" };

function Avatar({ avatar, nickname, size = 64 }: { avatar?: string | null; nickname: string; size?: number }) {
  return avatar ? (
    <Image src={avatar} unoptimized width={size} height={size} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-primary" style={{ width: size, height: size }}>
      {nickname.trim().slice(0, 1) || "学"}
    </span>
  );
}

function Pagination({ page, total, onChange, label, locale }: { page: number; total: number; onChange: (page: number) => void; label: string; locale: AppLocale }) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return <nav aria-label={ui(locale, `${label}分页`, `${label} pagination`)} className="mt-4 flex items-center justify-end gap-3 text-xs text-muted-foreground">
    <span>{ui(locale, `第 ${page} / ${pages} 页`, `Page ${page} of ${pages}`)}</span>
    <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>{ui(locale, "上一页", "Previous")}</Button>
    <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>{ui(locale, "下一页", "Next")}</Button>
  </nav>;
}

/** Public information is always loaded from the public profile API, never from private CampusUser fields. */
export function StudentPublicProfile({ identityId, viewer, embedded = false, workspace = "student" }: { identityId: string; viewer: CampusUser; embedded?: boolean; workspace?: CampusRole }) {
  const { locale } = useLocale();
  const base = `profiles/${encodeURIComponent(identityId)}`;
  const profile = useData<{ profile: PublicProfile }>(base);
  const [activityPage, setActivityPage] = useState(1);
  const [messagePage, setMessagePage] = useState(1);
  const activity = useData<Page<ProfileActivity>>(`${base}/activity?page=${activityPage}&pageSize=${pageSize}`);
  const messages = useData<Page<GuestbookMessage>>(`${base}/messages?page=${messagePage}&pageSize=${pageSize}`);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<GuestbookMessage | null>(null);
  const [dialog, setDialog] = useState<"delete" | "report" | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>("abuse");
  const [notice, setNotice] = useState("");
  const post = useMutation();
  const moderation = useMutation();
  const person = profile.data?.profile;
  const own = person?.isSelf ?? identityId === viewer.identityId;
  const publicHref = `/${workspace}/people/${encodeURIComponent(identityId)}`;


  return <div className={embedded ? "mt-6 space-y-5" : "space-y-5"}>
    {embedded ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{ui(locale, "解题动态与留言", "Activity and messages")}</h2>
        <AppLink href={`${publicHref}?from=profile`} className={buttonVariants({ variant: "secondary" })}>{ui(locale, "查看公开主页", "View public profile")}</AppLink>
      </div>
    ) : (
      <h1 className="sr-only">{ui(locale, "学生主页", "Student profile")}</h1>
    )}

    <State data={profile}>
      {person && !embedded && <ProfileHero avatar={person.avatar} nickname={person.nickname} bio={person.bio} self={person.isSelf} selfLabel={ui(locale, "我的资料", "My profile")} actions={person.isSelf ? <AppLink href={`/${workspace}/profile`} className={buttonVariants({ variant: "outline" })}>{ui(locale, "编辑个人资料", "Edit profile")}</AppLink> : undefined}>
        <dl className="mt-5 grid max-w-xl grid-cols-3 gap-3 border-t border-border pt-4 text-sm"><div><dt className="text-xs text-muted-foreground">{ui(locale, "累计积分", "Total points")}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{person.points}</dd></div><div><dt className="text-xs text-muted-foreground">{ui(locale, "排行榜积分", "Leaderboard points")}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{person.rankPoints}</dd></div><div><dt className="text-xs text-muted-foreground">{ui(locale, "已解题目", "Solved problems")}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{person.solvedProblems}</dd></div></dl>
      </ProfileHero>}
    </State>

    {person && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <section className={`${panel} min-w-0`} aria-labelledby="profile-activity-heading">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Award size={18} className="text-primary"/><h3 id="profile-activity-heading" className="font-bold">{ui(locale, "解题动态", "Solving activity")}</h3></div><Button size="sm" variant="ghost" disabled={activity.loading} onClick={activity.reload}>{ui(locale, "刷新", "Refresh")}</Button></div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{ui(locale, "每道题首次 AC 后显示一条动态；未公布的限时训练成绩不会提前展示，非公开题目动态仅本人可见。", "A first AC creates one activity entry per problem. Unreleased timed-practice results stay hidden; private-problem activity is visible only to you.")}</p>
        <State data={activity}>
          {activity.data?.items.length ? <ol className="mt-4 space-y-3">{activity.data.items.map(item => <li key={item.id} className="relative border-l-2 border-primary/25 py-1 pl-4">
            <span aria-hidden="true" className="absolute -left-[5px] top-2 size-2 rounded-full bg-primary"/>
            <p className="break-words text-sm">{ui(locale, "首次通过", "First AC on")} <span className="font-semibold">{item.problemTitle}</span><span className="ml-2 font-semibold text-success">+{item.points} {ui(locale, "分", "points")}</span></p>
            <time className="mt-1 block text-xs text-muted-foreground" dateTime={item.createdAt}>{date(item.createdAt, locale)}</time>
          </li>)}</ol> : <p className="mt-5 rounded-md bg-surface-subtle p-4 text-sm text-muted-foreground">{ui(locale, "暂无公开解题动态，完成首道题目后会出现在这里。", "No public solving activity yet. Your first solved problem will appear here.")}</p>}
          <Pagination label={ui(locale, "解题动态", "Solving activity")} locale={locale} page={activityPage} total={activity.data?.total ?? 0} onChange={setActivityPage}/>
        </State>
      </section>

      <section className={`${panel} min-w-0`} aria-labelledby="profile-messages-heading">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><MessageCircle size={18} className="text-primary"/><h3 id="profile-messages-heading" className="font-bold">{ui(locale, "主页留言", "Profile messages")}</h3></div><Button size="sm" variant="ghost" disabled={messages.loading} onClick={messages.reload}>{ui(locale, "刷新", "Refresh")}</Button></div>
        {!own && workspace === "student" && viewer.roles.includes("student") && <form className="mt-3" onSubmit={event => { event.preventDefault(); if (!draft.trim()) return; setNotice(""); void post.run(async () => {
          await productionApi(`${base}/messages`, { method: "POST", body: { body: draft.trim() } });
          setDraft(""); setMessagePage(1); messages.reload(); post.success(ui(locale, "留言已发布。", "Message posted."));
        }); }}>
          <label htmlFor="profile-message-body" className="block text-sm font-semibold">{ui(locale, "留言内容", "Message")}</label>
          <textarea id="profile-message-body" className={`mt-1.5 ${textarea}`} rows={2} maxLength={500} required value={draft} onChange={event => setDraft(event.target.value)} placeholder={ui(locale, "写下你的鼓励或交流内容…", "Share encouragement or start a conversation…")}/>
          <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{draft.length} / 500 {ui(locale, "字", "characters")}</span><Button type="submit" size="sm" disabled={post.busy || !draft.trim()}>{ui(locale, "发布留言", "Post message")}</Button></div>
          <Feedback action={post}/>
        </form>}
        {notice && <p role="status" className="mt-3 text-sm text-success">{notice === "reported" ? ui(locale, "已提交举报。", "Report submitted.") : notice === "deleted" ? ui(locale, "留言已删除。", "Message deleted.") : notice}</p>}
        <State data={messages}>
          {messages.data?.items.length ? <ol className="mt-3 divide-y divide-border border-t border-border">{messages.data.items.map(item => <li key={item.id} className="py-3">
            <div className="flex items-start gap-3"><Avatar avatar={item.author.avatar} nickname={item.author.nickname} size={32}/>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-sm font-semibold">{item.author.nickname}</span><time dateTime={item.createdAt} className="text-xs text-muted-foreground">{date(item.createdAt, locale)}</time></div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{item.body}</p>
                {item.reportedByMe && <span className="mt-2 inline-flex rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">{ui(locale, "已举报", "Reported")}</span>}
                {(item.canDelete || item.canReport) && <div className="mt-2 flex gap-3">{item.canDelete && <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive hover:underline" onClick={() => { moderation.reset(); setSelected(item); setDialog("delete"); }}><Trash2 size={13}/>{ui(locale, "删除", "Delete")}</button>}{workspace === "student" && item.canReport && <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => { moderation.reset(); setSelected(item); setReportReason("abuse"); setDialog("report"); }}><Flag size={13}/>{ui(locale, "举报", "Report")}</button>}</div>}
              </div>
            </div>
          </li>)}</ol> : <p className="mt-3 rounded-md bg-surface-subtle p-3 text-sm text-muted-foreground">{ui(locale, "还没有留言。", "No messages yet.")}</p>}
          <Pagination label={ui(locale, "主页留言", "Profile messages")} locale={locale} page={messagePage} total={messages.data?.total ?? 0} onChange={setMessagePage}/>
        </State>
      </section>
    </div>}

    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !moderation.busy) { setDialog(null); setSelected(null); } }}>
      <DialogContent>
        <DialogTitle>{dialog === "report" ? ui(locale, "举报留言", "Report message") : ui(locale, "删除留言", "Delete message")}</DialogTitle>
        <DialogDescription>{dialog === "report" ? ui(locale, "请选择举报原因，学校管理员可以查看并处理。", "Choose a reason. School administrators will review the report.") : ui(locale, "删除后，所有人都将无法再看到这条留言。", "This message will no longer be visible to anyone after deletion.")}</DialogDescription>
        {dialog === "report" && <label className="text-sm font-semibold">{ui(locale, "举报原因", "Reason")}<select className="mt-2 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm" value={reportReason} onChange={event => setReportReason(event.target.value as ReportReason)}>{reportReasons.map(reason => <option key={reason.value} value={reason.value}>{ui(locale, reason.label, englishReportReasons[reason.value])}</option>)}</select></label>}
        <DialogFooter><Button variant="secondary" disabled={moderation.busy} onClick={() => { setDialog(null); setSelected(null); }}>{ui(locale, "取消", "Cancel")}</Button><Button variant={dialog === "delete" ? "destructive" : "default"} disabled={moderation.busy || !selected} onClick={() => { if (!selected) return; void moderation.run(async () => {
          if (dialog === "report") { await productionApi(`${base}/messages/${encodeURIComponent(selected.id)}/report`, { method: "POST", body: { reason: reportReason } }); messages.reload(); setNotice("reported"); }
          else { await productionApi(`${base}/messages/${encodeURIComponent(selected.id)}`, { method: "DELETE" }); if (messages.data?.items.length === 1 && messagePage > 1) setMessagePage(messagePage - 1); else messages.reload(); setNotice("deleted"); }
          setDialog(null); setSelected(null);
        }); }}>{moderation.busy ? ui(locale, "处理中…", "Processing…") : dialog === "report" ? ui(locale, "提交举报", "Submit report") : ui(locale, "确认删除", "Delete message")}</Button></DialogFooter>
        <Feedback action={moderation}/>
      </DialogContent>
    </Dialog>
  </div>;
}
