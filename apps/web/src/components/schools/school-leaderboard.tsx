"use client";
import { LeaderboardStandings } from "@/components/leaderboard-view";
import { AppLink } from "@/components/navigation";
import styles from "@/components/points-page.module.css";
import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-context";
import { useData } from "@/components/teacher/shared";
import { inputClass, Loading, panelClass } from "@/components/admin/common";
import { Button, buttonVariants } from "@/components/ui/button";
import { Search, SlidersHorizontal } from "lucide-react";
import { RoleLabel, useSchoolText, type SchoolRole } from "./school-ui";
import { schoolWorkspaceHref } from "./school-workspace-location";
type Entry = {
  rank: number;
  identityId: string;
  accountId: string;
  name: string;
  avatar: string;
  isOwn: boolean;
  isOnline?: boolean;
  points: number;
  solved?: number;
  attempts?: number;
  acRate?: number | null;
  scholarship?: number;
};
export function SchoolLeaderboard({ schoolId }: { schoolId: string }) {
  const search = useSearchParams();
  const role = search.get("schoolRole") === "teacher" ? "teacher" : undefined;
  const href = schoolWorkspaceHref(schoolId, "leaderboard", role);
  if (search.get("memberProfiles") === "1") return <SchoolMemberProfiles schoolId={schoolId} href={href}/>;
  return <SchoolRankings schoolId={schoolId} href={href}/>;
}

function SchoolMemberProfiles({ schoolId, href }: { schoolId: string; href: string }) {
  const text = useSchoolText();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const profiles = useData<{ items: { id: string; name: string; role: SchoolRole; avatar: string }[]; hasMore: boolean }>(
    `schools/${schoolId}/profiles?${new URLSearchParams({ q: query.trim(), page: String(page), pageSize: "20" })}`,
  );
  return <section className={`${panelClass} space-y-4 p-4`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{text("Member profiles", "成员主页")}</h2>
      <AppLink href={href} className={buttonVariants({ variant: "secondary", size: "sm" })}>{text("Back to leaderboard", "返回排行榜")}</AppLink>
    </div>
    <div className="grid max-w-sm gap-1 text-sm">
      <label htmlFor={searchId}>{text("Search by name or nickname", "搜索姓名或昵称")}</label>
      <input id={searchId} type="search" maxLength={100} className={inputClass} value={query}
        onChange={event => { setQuery(event.target.value); setPage(1); }}/>
    </div>
    <Loading resource={profiles}>
      {profiles.data?.items.length ? <ul className="divide-y divide-border">
        {profiles.data.items.map(member => <li key={member.id}>
          <AppLink href={`${href}&profileId=${encodeURIComponent(member.id)}`}
            className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
            <Image src={member.avatar} width={32} height={32} unoptimized alt="" className="size-8 shrink-0 rounded-full object-cover"/>
            <span className="min-w-0 flex-1 break-words font-medium">{member.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground"><RoleLabel role={member.role}/></span>
          </AppLink>
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">{text("No matching members.", "没有符合条件的成员。")}</p>}
      {(page > 1 || profiles.data?.hasMore) && <nav className="flex items-center justify-end gap-2" aria-label={text("Member pages", "成员分页")}>
        <Button size="sm" variant="secondary" disabled={profiles.loading || page === 1} onClick={() => setPage(page - 1)}>{text("Previous", "上一页")}</Button>
        <span className="text-sm">{page}</span>
        <Button size="sm" variant="secondary" disabled={profiles.loading || !profiles.data?.hasMore} onClick={() => setPage(page + 1)}>{text("Next", "下一页")}</Button>
      </nav>}
    </Loading>
  </section>;
}

function SchoolRankings({ schoolId, href }: { schoolId: string; href: string }) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "en" ? en : zh),
    [q, setQ] = useState(""),
    [classId, setClassId] = useState(""),
    [page, setPage] = useState(1),
    [filterOpen, setFilterOpen] = useState(false),
    [draftQ, setDraftQ] = useState(""),
    [draftClassId, setDraftClassId] = useState(""),
    data = useData<{
      items: Entry[];
      total: number;
      hasMore: boolean;
      displayFields: Record<string, boolean>;
      classes: { id: string; name: string }[];
    }>(
      `schools/${schoolId}/leaderboard?${new URLSearchParams({ q, page: String(page), ...(classId ? { classId } : {}) })}`,
    );
  const fields = data.data?.displayFields ?? {},
    items = (data.data?.items ?? []).map(person => ({...person,id:person.identityId,online:person.isOnline,solvedProblems:person.solved,
      acRate:person.acRate == null ? null : person.acRate*100,scholarshipBalance:person.scholarship}));
  const ranking = {...data,data:data.data ? {items,total:data.data.total} : null};
  const filterCount = Number(Boolean(q.trim())) + Number(Boolean(classId));
  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filterOpen) return;
    function outside(event: Event) {
      if (event.target instanceof Node && filterRef.current && !filterRef.current.contains(event.target)) setFilterOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [filterOpen]);
  return (
    <section className={styles.page}>
      <div ref={filterRef} className="relative flex flex-wrap items-center justify-end gap-2" onKeyDown={event => {
        if (filterOpen && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setFilterOpen(false); }
      }}>
        <AppLink href={href + "&memberProfiles=1"} className={styles.filterButton}>{tx("成员主页", "Member profiles")}</AppLink>
        <button type="button" className={styles.filterButton} aria-haspopup="dialog" aria-expanded={filterOpen}
          onClick={() => { setDraftQ(q); setDraftClassId(classId); setFilterOpen(value => !value); }}>
          <SlidersHorizontal size={16} aria-hidden="true" />{tx("筛选", "Filters")}
          {filterCount > 0 && <span className={styles.filterCount}>{filterCount}</span>}
        </button>
        {filterOpen && (
          <div role="dialog" aria-label={tx("排行榜筛选", "Leaderboard filters")}
            className="absolute right-0 top-full z-50 mt-2 flex w-72 max-w-[calc(100vw-16px)] flex-col gap-5 rounded-lg border border-border bg-surface p-4 text-foreground shadow-lg">
            <label className="flex flex-col gap-2">
              <span className={styles.filterLabel}><Search size={15} aria-hidden="true" />{tx("搜索", "Search")}</span>
              <input
                className={`${inputClass} w-full`}
                aria-label={tx("搜索学生", "Search students")}
                placeholder={tx("搜索姓名或昵称", "Search name or nickname")}
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className={styles.filterLabel}>{tx("班级", "Class")}</span>
              <select
                className={styles.scopeSelect}
                value={draftClassId}
                aria-label={tx("班级", "Class")}
                onChange={(e) => setDraftClassId(e.target.value)}
              >
                <option value="">{tx("全校", "Whole school")}</option>
                {data.data?.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setDraftQ(""); setDraftClassId(""); }}>{tx("重置", "Reset")}</Button>
              <Button type="button" onClick={() => { setFilterOpen(false); setPage(1); setQ(draftQ.trim()); setClassId(draftClassId); }}>{tx("应用筛选", "Apply filters")}</Button>
            </div>
          </div>
        )}
      </div>
      <LeaderboardStandings ranking={ranking} leaders={page === 1 && !q ? {...ranking,data:data.data ? {items:items.slice(0,3)} : null} : undefined}
        visibleFields={{online:true,solvedProblems:!!fields.solved,attempts:!!fields.attempts,acRate:!!fields.acRate,scholarshipBalance:!!fields.scholarship}}
        isCurrent={person=>items.some(row=>row.id===person.id && row.isOwn)} profileHref={person=>`${href}&profileId=${person.id}`}
        page={page} pageSize={50} onPageChange={setPage} refresh={data.reload}/>
    </section>
  );
}
