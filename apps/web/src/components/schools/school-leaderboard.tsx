"use client";
import { LeaderboardStandings } from "@/components/leaderboard-view";
import styles from "@/components/points-page.module.css";
import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import { useData } from "@/components/teacher/shared";
import { inputClass } from "@/components/admin/common";
type Entry = {
  rank: number;
  identityId: string;
  accountId: string;
  name: string;
  avatar: string;
  isOwn: boolean;
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
    items = (data.data?.items ?? []).map(person => ({...person,id:person.identityId,solvedProblems:person.solved,
      acRate:person.acRate == null ? null : person.acRate*100,scholarshipBalance:person.scholarship}));
  const ranking = {...data,data:data.data ? {items,total:data.data.total} : null};
  return (
    <section className={styles.page}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} max-w-72`}
          aria-label={tx("搜索学生", "Search students")}
          placeholder={tx("搜索姓名或昵称", "Search name or nickname")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className={`${inputClass} max-w-52`}
          value={classId}
          aria-label={tx("班级", "Class")}
          onChange={(e) => {
            setClassId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{tx("全校", "Whole school")}</option>
          {data.data?.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="ml-auto text-xs text-muted-foreground">
          {tx(
            "积分 → AC 率 → 奖学金余额",
            "Points → AC rate → scholarship balance",
          )}
        </p>
      </div>
      <LeaderboardStandings ranking={ranking} leaders={page === 1 && !q ? {...ranking,data:data.data ? {items:items.slice(0,3)} : null} : undefined}
        visibleFields={{solvedProblems:!!fields.solved,attempts:!!fields.attempts,acRate:!!fields.acRate,scholarshipBalance:!!fields.scholarship}}
        isCurrent={person=>items.some(row=>row.id===person.id && row.isOwn)} profileHref={person=>`/schools?schoolId=${schoolId}&section=leaderboard&profileId=${person.id}`}
        page={page} pageSize={50} onPageChange={setPage} refresh={data.reload}/>
    </section>
  );
}
