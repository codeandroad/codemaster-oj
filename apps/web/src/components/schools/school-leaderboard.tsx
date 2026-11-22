"use client";
import { LeaderboardStandings } from "@/components/leaderboard-view";
import styles from "@/components/points-page.module.css";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { useData } from "@/components/teacher/shared";
import { inputClass } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Search, SlidersHorizontal } from "lucide-react";
import { presenceChanged } from "@/components/student/student-presence";
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
  useEffect(() => {
    const reload = () => data.reload();
    window.addEventListener(presenceChanged, reload);
    return () => window.removeEventListener(presenceChanged, reload);
  }, [data]);
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
        visibleFields={{solvedProblems:!!fields.solved,attempts:!!fields.attempts,acRate:!!fields.acRate,scholarshipBalance:!!fields.scholarship}}
        isCurrent={person=>items.some(row=>row.id===person.id && row.isOwn)} profileHref={person=>`/schools?schoolId=${schoolId}&section=leaderboard&profileId=${person.id}`}
        page={page} pageSize={50} onPageChange={setPage} refresh={data.reload}/>
    </section>
  );
}
