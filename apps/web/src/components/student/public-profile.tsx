"use client";

import Image from "next/image";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Award, Flag, MessageCircle, Trash2 } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { ProfileHero } from "@/components/profile-hero";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
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

function Avatar({ avatar, nickname, size = 64 }: { avatar?: string | null; nickname: string; size?: number }) {
  return avatar ? (
    <Image src={avatar} unoptimized width={size} height={size} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-primary" style={{ width: size, height: size }}>
      {nickname.trim().slice(0, 1) || "学"}
    </span>
  );
}

function Pagination({ page, total, onChange, label }: { page: number; total: number; onChange: (page: number) => void; label: string }) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return <nav aria-label={`${label}分页`} className="mt-4 flex items-center justify-end gap-3 text-xs text-muted-foreground">
    <span>第 {page} / {pages} 页</span>
    <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</Button>
    <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>下一页</Button>
  </nav>;
}

/** Public information is always loaded from the public profile API, never from private CampusUser fields. */
export function StudentPublicProfile({ identityId, viewer, embedded = false, workspace = "student" }: { identityId: string; viewer: CampusUser; embedded?: boolean; workspace?: CampusRole }) {
  const search = useSearchParams();
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
  const origin = search.get("from");
  const classId = search.get("classId");
  const back = origin === "reports" && workspace === "admin"
    ? { href: "/admin/settings?tab=reports", label: "返回留言举报" }
    : origin === "points"
      ? { href: `/${workspace}/points${classId ? `?classId=${encodeURIComponent(classId)}` : ""}`, label: "返回积分榜" }
      : origin === "profile" && workspace === "student"
        ? { href: "/student/profile", label: "返回个人资料" }
        : { href: workspace === "student" ? "/" : workspace === "teacher" ? "/teacher" : "/admin", label: "返回工作区" };

  return <div className={embedded ? "mt-6 space-y-5" : "space-y-5"}>
    {embedded ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-bold">解题动态与留言</h2><p className="mt-1 text-sm text-muted-foreground">在公开主页展示解题进步，与同学交流。</p></div>
        <AppLink href={`${publicHref}?from=profile`} className={buttonVariants({ variant: "secondary" })}>查看公开主页</AppLink>
      </div>
    ) : (
      <><AppLink href={back.href} className="inline-flex min-h-9 items-center text-sm font-semibold text-primary hover:underline">← {back.label}</AppLink><h1 className="sr-only">学生主页</h1></>
    )}

    <State data={profile}>
      {person && !embedded && <ProfileHero avatar={person.avatar} nickname={person.nickname} bio={person.bio} self={person.isSelf} actions={person.isSelf ? <AppLink href={`/${workspace}/profile`} className={buttonVariants({ variant: "outline" })}>编辑个人资料</AppLink> : undefined}>
        <dl className="mt-5 grid max-w-xl grid-cols-3 gap-3 border-t border-border pt-4 text-sm"><div><dt className="text-xs text-muted-foreground">累计积分</dt><dd className="mt-1 text-lg font-bold tabular-nums">{person.points}</dd></div><div><dt className="text-xs text-muted-foreground">排行榜积分</dt><dd className="mt-1 text-lg font-bold tabular-nums">{person.rankPoints}</dd></div><div><dt className="text-xs text-muted-foreground">已解题目</dt><dd className="mt-1 text-lg font-bold tabular-nums">{person.solvedProblems}</dd></div></dl>
      </ProfileHero>}
    </State>

    {person && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <section className={`${panel} min-w-0`} aria-labelledby="profile-activity-heading">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Award size={18} className="text-primary"/><h3 id="profile-activity-heading" className="font-bold">解题动态</h3></div><Button size="sm" variant="ghost" disabled={activity.loading} onClick={activity.reload}>刷新</Button></div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">每道题首次 AC 后显示一条动态；未公布的限时训练成绩不会提前展示，非公开题目动态仅本人可见。</p>
        <State data={activity}>
          {activity.data?.items.length ? <ol className="mt-4 space-y-3">{activity.data.items.map(item => <li key={item.id} className="relative border-l-2 border-primary/25 py-1 pl-4">
            <span aria-hidden="true" className="absolute -left-[5px] top-2 size-2 rounded-full bg-primary"/>
            <p className="break-words text-sm">首次通过 <span className="font-semibold">{item.problemTitle}</span><span className="ml-2 font-semibold text-success">+{item.points} 分</span></p>
            <time className="mt-1 block text-xs text-muted-foreground" dateTime={item.createdAt}>{date(item.createdAt)}</time>
          </li>)}</ol> : <p className="mt-5 rounded-md bg-surface-subtle p-4 text-sm text-muted-foreground">暂无公开解题动态，完成首道题目后会出现在这里。</p>}
          <Pagination label="解题动态" page={activityPage} total={activity.data?.total ?? 0} onChange={setActivityPage}/>
        </State>
      </section>

      <section className={`${panel} min-w-0`} aria-labelledby="profile-messages-heading">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><MessageCircle size={18} className="text-primary"/><h3 id="profile-messages-heading" className="font-bold">主页留言</h3></div><Button size="sm" variant="ghost" disabled={messages.loading} onClick={messages.reload}>刷新</Button></div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">请友善交流，不要公开联系方式或其他个人信息。</p>
        {!own && workspace === "student" && viewer.roles.includes("student") && <form className="mt-4" onSubmit={event => { event.preventDefault(); if (!draft.trim()) return; setNotice(""); void post.run(async () => {
          await productionApi(`${base}/messages`, { method: "POST", body: { body: draft.trim() } });
          setDraft(""); setMessagePage(1); messages.reload(); post.success("留言已发布。");
        }); }}>
          <label htmlFor="profile-message-body" className="block text-sm font-semibold">写一条留言</label>
          <textarea id="profile-message-body" className={`mt-2 ${textarea}`} rows={3} maxLength={500} required value={draft} onChange={event => setDraft(event.target.value)} placeholder="写下你的鼓励或交流内容…"/>
          <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{draft.length} / 500 字</span><Button type="submit" size="sm" disabled={post.busy || !draft.trim()}>发布留言</Button></div>
          <Feedback action={post}/>
        </form>}
        {own && <p className="mt-4 rounded-md bg-surface-subtle p-3 text-xs text-muted-foreground">这是你的主页。你可以删除不合适的留言。</p>}
        {notice && <p role="status" className="mt-3 text-sm text-success">{notice}</p>}
        <State data={messages}>
          {messages.data?.items.length ? <ol className="mt-4 divide-y divide-border border-t border-border">{messages.data.items.map(item => <li key={item.id} className="py-4">
            <div className="flex items-start gap-3"><Avatar avatar={item.author.avatar} nickname={item.author.nickname} size={32}/>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-sm font-semibold">{item.author.nickname}</span><time dateTime={item.createdAt} className="text-xs text-muted-foreground">{date(item.createdAt)}</time></div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.body}</p>
                {item.reportedByMe && <span className="mt-2 inline-flex rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">已举报</span>}
                {(item.canDelete || item.canReport) && <div className="mt-2 flex gap-3">{item.canDelete && <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive hover:underline" onClick={() => { moderation.reset(); setSelected(item); setDialog("delete"); }}><Trash2 size={13}/>删除</button>}{workspace === "student" && item.canReport && <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => { moderation.reset(); setSelected(item); setReportReason("abuse"); setDialog("report"); }}><Flag size={13}/>举报</button>}</div>}
              </div>
            </div>
          </li>)}</ol> : <p className="mt-5 rounded-md bg-surface-subtle p-4 text-sm text-muted-foreground">还没有留言。</p>}
          <Pagination label="主页留言" page={messagePage} total={messages.data?.total ?? 0} onChange={setMessagePage}/>
        </State>
      </section>
    </div>}

    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !moderation.busy) { setDialog(null); setSelected(null); } }}>
      <DialogContent>
        <DialogTitle>{dialog === "report" ? "举报留言" : "删除留言"}</DialogTitle>
        <DialogDescription>{dialog === "report" ? "请选择举报原因，学校管理员可以查看并处理。" : "删除后，所有人都将无法再看到这条留言。"}</DialogDescription>
        {dialog === "report" && <label className="text-sm font-semibold">举报原因<select className="mt-2 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm" value={reportReason} onChange={event => setReportReason(event.target.value as ReportReason)}>{reportReasons.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label>}
        <DialogFooter><Button variant="secondary" disabled={moderation.busy} onClick={() => { setDialog(null); setSelected(null); }}>取消</Button><Button variant={dialog === "delete" ? "destructive" : "default"} disabled={moderation.busy || !selected} onClick={() => { if (!selected) return; void moderation.run(async () => {
          if (dialog === "report") { await productionApi(`${base}/messages/${encodeURIComponent(selected.id)}/report`, { method: "POST", body: { reason: reportReason } }); messages.reload(); setNotice("已提交举报。"); }
          else { await productionApi(`${base}/messages/${encodeURIComponent(selected.id)}`, { method: "DELETE" }); if (messages.data?.items.length === 1 && messagePage > 1) setMessagePage(messagePage - 1); else messages.reload(); setNotice("留言已删除。"); }
          setDialog(null); setSelected(null);
        }); }}>{moderation.busy ? "处理中…" : dialog === "report" ? "提交举报" : "确认删除"}</Button></DialogFooter>
        <Feedback action={moderation}/>
      </DialogContent>
    </Dialog>
  </div>;
}
