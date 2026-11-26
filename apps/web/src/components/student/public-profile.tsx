"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Award, MessageCircle, Pencil } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { ProfileHero } from "@/components/profile-hero";
import { Button, buttonVariants } from "@/components/ui/button";
import { useLocale, type AppLocale } from "@/components/locale-context";
import type { CampusRole, CampusUser } from "@/lib/production-api";
import { State, date, panel, useData, useRefreshOnReturn } from "./data-state";
import { ProfileDetails, ProfileEditor } from "../profile-editor";
import { ProfileCoverEditor } from "../profile-cover-editor";
import type { SchoolRole } from "../schools/school-ui";
import { ProfileGuestbook } from "./profile-guestbook";
import { platformMemberProfileHref, schoolWorkspaceHref } from "../schools/school-workspace-location";

interface PublicProfile {
  nickname: string;
  avatar: string | null;
  coverImage?: string;
  bio?: string | null;
  points?: number;
  scholarship?: number;
  solvedProblems?: number;
  isSelf: boolean;
}
interface ProfileActivity {
  id: string;
  type: "first_ac";
  problemId: string;
  problemTitle: string;
  points?: number;
  createdAt: string;
}
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

const pageSize = 5;
const ui = (locale: AppLocale, zh: string, en: string) => locale === "en" ? en : zh;

function Pagination({ page, total, onChange, label, locale }: { page: number; total: number; onChange: (page: number) => void; label: string; locale: AppLocale }) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return <nav aria-label={ui(locale, `${label}分页`, `${label} pagination`)} className="mt-4 flex items-center justify-end gap-3 text-xs text-muted-foreground">
    <span>{ui(locale, `第 ${page} / ${pages} 页`, `Page ${page} of ${pages}`)}</span>
    <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>{ui(locale, "上一页", "Previous")}</Button>
    <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>{ui(locale, "下一页", "Next")}</Button>
  </nav>;
}

function ProfileMessagesPanel({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const headingId = useId();
  return <section className={`${panel} min-w-0`} aria-labelledby={headingId}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><MessageCircle size={18} className="text-primary"/><h3 id={headingId} className="font-bold">{ui(locale, "主页留言", "Profile messages")}</h3></div>
    </div>
    {children}
  </section>;
}

export function StudentPublicProfile({ judgingHistoryHref, profileId, viewer, onUserSaved, schoolRoles, detailsOpen, workspace = "student", schoolId }: {
  judgingHistoryHref?: string; schoolId?: string; profileId: string; viewer: CampusUser;
  onUserSaved?: (next: CampusUser) => void; schoolRoles?: SchoolRole[]; detailsOpen?: boolean;
  workspace?: CampusRole | "practice" | "platform";
}) {
  const ownPage = Boolean(onUserSaved);
  const { locale } = useLocale();
  const practice = workspace === "practice";
  const preview = workspace === "platform";
  const schoolScope = schoolId ? `schools/${encodeURIComponent(schoolId)}/` : "";
  const base = `${practice ? "practice/" : preview ? "platform/" + schoolScope : schoolScope}profiles/${encodeURIComponent(profileId)}`;
  const peoplePath = preview && schoolId ? platformMemberProfileHref(schoolId, "") : schoolId
    ? schoolWorkspaceHref(schoolId, "leaderboard", workspace === "teacher" ? "teacher" : undefined) + "&profileId="
    : `/${workspace}/people`;
  const { version, refresh } = useRefreshOnReturn();
  const profile = useData<{ profile: PublicProfile }>(base, version);
  const [activityPage, setActivityPage] = useState(1);
  const person = profile.data?.profile;
  const showActivity = practice ? ownPage : person?.points !== undefined;
  const activity = useData<Page<ProfileActivity>>(showActivity ? `${base}/activity?page=${activityPage}&pageSize=${pageSize}` : "", version);
  const editButton = useRef<HTMLButtonElement>(null);
  const [editState, setEditState] = useState<"view" | "editing" | "saved">("view");
  const editing = editState === "editing";
  function finishEditing(state: "view" | "saved") {
    setEditState(state);
    requestAnimationFrame(() => editButton.current?.focus());
  }
  const hero = ownPage && practice && person?.isSelf
    ? { avatar: viewer.avatar, nickname: viewer.nickname || viewer.name, bio: viewer.bio }
    : person;
  const canWrite = practice || Boolean(schoolId);
  const stats = person?.points !== undefined && <dl className={`mt-5 grid max-w-xl ${person.scholarship === undefined ? "grid-cols-2" : "grid-cols-3"} gap-3 border-t border-border pt-4 text-sm`}>
    <div><dt className="text-xs text-muted-foreground">{practice ? ui(locale, "排名积分", "Ranking points") : ui(locale, "积分", "Points")}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{person.points}</dd></div>
    {person.scholarship !== undefined && <div><dt className="text-xs text-muted-foreground">{ui(locale, "奖学金", "Scholarship")}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{person.scholarship}</dd></div>}
    <div><dt className="text-xs text-muted-foreground">{ui(locale, "已解题目", "Solved problems")}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{person.solvedProblems}</dd></div>
  </dl>;

  let profileAction;
  if (person?.isSelf && onUserSaved && !editing) {
    profileAction = <Button ref={editButton} type="button" variant="outline" onClick={() => setEditState("editing")}>
      <Pencil size={15} aria-hidden="true"/>{ui(locale, "编辑个人资料", "Edit profile")}
    </Button>;
  } else if (person?.isSelf && !ownPage) {
    profileAction = <AppLink href={schoolId ? schoolWorkspaceHref(schoolId, "me", workspace === "teacher" ? "teacher" : undefined) + "&details=1" : "/practice/me?details=1"}
      className={buttonVariants({variant:"outline"})}>{ui(locale, "个人资料", "Profile details")}</AppLink>;
  }
  return <div className="space-y-5">
    {!ownPage && <h1 className="sr-only">{ui(locale, "个人主页", "Profile")}</h1>}
    <State data={profile}>
      {person && hero && <ProfileHero avatar={hero.avatar} nickname={hero.nickname} bio={hero.bio}
        presenceEndpoint={practice ? "practice/presence" : undefined}
        presenceIdentityId={!schoolId && (!practice || (ownPage && person.isSelf)) ? profileId : undefined}
        coverImage={person.coverImage} coverAction={person.isSelf && ownPage && <ProfileCoverEditor coverImage={person.coverImage} onSaved={profile.reload}/>}
        showBio={!practice || ownPage} self={person.isSelf} selfLabel={ui(locale, "我的主页", "My homepage")} actions={profileAction}>
        {person.isSelf && onUserSaved && <>
          <ProfileDetails user={viewer} schoolRoles={schoolRoles} initiallyOpen={detailsOpen} hidden={editing}/>
          {editing && <ProfileEditor user={viewer} schoolRoles={schoolRoles} onCancel={() => finishEditing("view")}
            onSaved={next => { onUserSaved(next); finishEditing("saved"); refresh(); }}/>}
          {editState === "saved" && <p role="status" className="mt-3 text-sm text-success">{ui(locale, "个人资料已保存。", "Profile saved.")}</p>}
        </>}
        {(!practice || ownPage) && stats}
        {judgingHistoryHref && showActivity && <AppLink className={buttonVariants({variant:"secondary",className:"mt-4"})} href={judgingHistoryHref}>{ui(locale,"完整判题记录","Complete judging history")}</AppLink>}
      </ProfileHero>}
    </State>

    {person && <div className={`grid items-start gap-5 ${showActivity ? "xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]" : ""}`}>
      <ProfileMessagesPanel>
        <ProfileGuestbook key={base} base={base} peoplePath={peoplePath} canPost={canWrite} refreshVersion={version}/>
      </ProfileMessagesPanel>

      {showActivity && <section className={`${panel} min-w-0`} aria-labelledby="profile-activity-heading">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Award size={18} className="text-primary"/><h3 id="profile-activity-heading" className="font-bold">{ui(locale, "解题动态", "Solving activity")}</h3></div><Button size="sm" variant="ghost" disabled={profile.loading || activity.loading} onClick={refresh}>{ui(locale, "刷新", "Refresh")}</Button></div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{practice ? ui(locale, "公开练习的首次正式通过记录仅本人可见。", "Only you can see your first accepted submission for each public practice problem.") : ui(locale, "每道题首次 AC 后显示一条动态；未公布的限时训练成绩不会提前展示，非公开题目动态仅本人可见。", "A first AC creates one activity entry per problem. Unreleased timed-practice results stay hidden; private-problem activity is visible only to you.")}</p>
        <State data={activity}>
          {activity.data?.items.length ? <ol className="mt-4 space-y-3">{activity.data.items.map(item => <li key={item.id} className="relative border-l-2 border-primary/25 py-1 pl-4">
            <span aria-hidden="true" className="absolute -left-[5px] top-2 size-2 rounded-full bg-primary"/>
            <p className="break-words text-sm">{ui(locale, "首次通过", "First AC on")} <span className="font-semibold">{item.problemTitle}</span>{item.points != null && item.points > 0 && <span className="ml-2 font-semibold text-success">+{item.points} {ui(locale, "分", "points")}</span>}</p>
            <time className="mt-1 block text-xs text-muted-foreground" dateTime={item.createdAt}>{date(item.createdAt, locale)}</time>
          </li>)}</ol> : <p className="mt-5 rounded-md bg-surface-subtle p-4 text-sm text-muted-foreground">{ui(locale, "暂无公开解题动态，完成首道题目后会出现在这里。", "No public solving activity yet. Your first solved problem will appear here.")}</p>}
          <Pagination label={ui(locale, "解题动态", "Solving activity")} locale={locale} page={activityPage} total={activity.data?.total ?? 0} onChange={setActivityPage}/>
        </State>
      </section>}

    </div>}
  </div>;
}
