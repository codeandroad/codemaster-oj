"use client";
import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import { useData } from "@/components/teacher/shared";
import { inputClass } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/profile-hero";
import { ScholarshipIcon } from "@/components/luq/scholarship-icon";
import { LeaderboardPodium } from "./leaderboard-podium";
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
    items = data.data?.items ?? [];
  return (
    <div className="space-y-4">
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
      {data.error && (
        <p role="alert" className="text-sm text-destructive">
          {data.error}
        </p>
      )}
      {page === 1 && !q && (
        <LeaderboardPodium leaders={items.slice(0, 3).map(item => ({ ...item, key: item.identityId }))} />
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">{tx("全部排名", "All rankings")}</h2>
          <span className="text-sm text-muted-foreground">
            {data.data?.total ?? 0} {tx("名学生", "students")}
          </span>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-subtle text-muted-foreground">
            <tr>
              <th className="p-3">{tx("排名", "Rank")}</th>
              <th className="p-3">{tx("学生", "Student")}</th>
              <th className="p-3">{tx("积分", "Points")}</th>
              {fields.solved && (
                <th className="p-3">{tx("解题数", "Solved")}</th>
              )}
              {fields.attempts && (
                <th className="p-3">{tx("提交数", "Attempts")}</th>
              )}
              {fields.acRate && (
                <th className="p-3">{tx("AC 率", "AC rate")}</th>
              )}
              {fields.scholarship && (
                <th className="p-3">
                  <span className="inline-flex items-center gap-1">
                    <ScholarshipIcon className="size-4" />
                    {tx("奖学金", "Scholarship")}
                  </span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr
                key={i.identityId}
                className={`border-t border-border ${i.isOwn ? "bg-primary/5" : ""}`}
              >
                <td className="p-3 font-semibold">{i.rank}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <ProfileAvatar avatar={i.avatar} nickname={i.name} />
                    <span className="font-medium">{i.name}</span>
                    {i.isOwn && (
                      <span className="text-xs text-muted-foreground">
                        {tx("你", "You")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-3 font-semibold">{i.points}</td>
                {fields.solved && <td className="p-3">{i.solved}</td>}
                {fields.attempts && <td className="p-3">{i.attempts}</td>}
                {fields.acRate && (
                  <td className="p-3 text-emerald-700">
                    {i.acRate === null
                      ? "—"
                      : `${((i.acRate ?? 0) * 100).toFixed(1)}%`}
                  </td>
                )}
                {fields.scholarship && <td className="p-3">{i.scholarship}</td>}
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-muted-foreground"
                >
                  {data.loading
                    ? tx("加载中…", "Loading…")
                    : tx("暂无符合条件的学生。", "No matching students.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          {tx("上一页", "Previous")}
        </Button>
        <Button
          variant="secondary"
          disabled={!data.data?.hasMore}
          onClick={() => setPage(page + 1)}
        >
          {tx("下一页", "Next")}
        </Button>
      </div>
    </div>
  );
}
