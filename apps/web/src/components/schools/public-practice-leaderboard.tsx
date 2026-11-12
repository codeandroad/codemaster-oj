"use client";

import { useState } from "react";
import { Feedback, useMutation } from "@/components/admin/common";
import { LeaderboardStandings, rankNumber, type VisibleFields } from "@/components/leaderboard-view";
import styles from "@/components/points-page.module.css";
import { AppLink } from "@/components/navigation";
import { useData, useRefreshOnReturn } from "@/components/student/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

type PublicRankRow = {
  rank: number | null;
  name: string;
  avatar: string;
  isOwn: boolean;
  points: number;
  solved: number;
  attempts: number;
  acRate: number | null;
};

type PublicRanking = {
  items: PublicRankRow[];
  own: PublicRankRow;
  progress: { solved: number; rankingEnabled: boolean; historyIncluded: boolean };
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  pointsPerSolved: number;
};

const visibleFields: VisibleFields = { solvedProblems: true, attempts: true, acRate: true, scholarshipBalance: false };

export function PublicPracticeLeaderboard() {
  const text = useSchoolText();
  const [page, setPage] = useState(1);
  const { version, refresh } = useRefreshOnReturn();
  const ranking = useData<PublicRanking>(`practice/leaderboard?page=${page}`, version);
  const data = ranking.data?.page === page ? ranking.data : null;
  const own = ranking.data?.own;
  const progress = ranking.data?.progress;
  const enrollment = useMutation();
  const items = (data?.items ?? []).flatMap((item, index) => item.rank === null ? [] : [{
    id: String(index),
    name: item.name,
    avatar: item.avatar,
    rank: item.rank,
    points: item.points,
    solvedProblems: item.solved,
    attempts: item.attempts,
    acRate: item.acRate === null ? null : item.acRate * 100,
    isOwn: item.isOwn,
  }]);
  const standings = { ...ranking, loading: ranking.loading || (!data && !ranking.error),
    data: data && { items, total: data.total } };
  const ownId = items.find(item => item.isOwn)?.id;
  const title = text("Public practice leaderboard", "公开练习积分榜");
  const rankingOff = progress?.rankingEnabled === false;

  return (
    <section aria-label={title} className={styles.page}>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <p className="max-w-prose text-sm text-muted-foreground">
          {ranking.data ? text(
            `Each eligible first solve earns ${rankNumber.format(ranking.data.pointsPerSolved)} points. Higher first-solve AC rate breaks ties.`,
            `符合条件的题目每道首次通过得 ${rankNumber.format(ranking.data.pointsPerSolved)} 分。同分时按首解 AC 率排序。`,
          ) : title}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <AppLink className={buttonVariants({ size: "sm", variant: "secondary" })} href="/practice/settings#public-practice">
            {text("Manage ranking", "管理排名")}
          </AppLink>
          <AppLink className={buttonVariants({ size: "sm" })} href="/practice/problems">
            {text("Practice problems", "去做题")}
          </AppLink>
        </div>
      </div>

      {progress && own && (rankingOff || !progress.historyIncluded && progress.solved > own.solved) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-sm text-muted-foreground">{rankingOff
            ? text("Turn on public ranking to include eligible past submissions and show your entry on the leaderboard.", "开启公开排名后，符合条件的历史提交会计入排名，你的排名将显示在榜单上。")
            : text("You can include eligible public practice submissions from before you turned ranking on.", "可以将开启排名前符合条件的公开练习提交纳入榜单。")}</p>
          <Button size="sm" variant="secondary" disabled={enrollment.busy || ranking.loading} onClick={() => void enrollment.run(async () => {
            await productionApi("practice/preferences", { method: "PATCH", body: { rankingEnabled: true } });
            ranking.reload();
          })}>{rankingOff ? text("Enable ranking", "开启排名") : text("Include past submissions", "纳入历史提交")}</Button>
        </div>
      )}
      <Feedback action={enrollment}/>

      <LeaderboardStandings ranking={standings}
        leaders={page === 1 && !ranking.error ? { ...standings, data: data && { items: items.slice(0, 3) } } : undefined}
        visibleFields={visibleFields} isCurrent={person => person.id === ownId}
        page={page} pageSize={ranking.data?.pageSize ?? 50} onPageChange={setPage} refresh={refresh} publicPractice/>
    </section>
  );
}
