"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { Loading } from "@/components/admin/common";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { ProfileAvatar } from "@/components/profile-hero";
import { useData } from "@/components/teacher/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { LeaderboardPodium } from "./leaderboard-podium";
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
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  pointsPerSolved: number;
};

export function PublicPracticeLeaderboard() {
  const text = useSchoolText();
  const { locale } = useLocale();
  const [page, setPage] = useState(1);
  const ranking = useData<PublicRanking>(`practice/leaderboard?page=${page}`);
  const data = ranking.data?.page === page ? ranking.data : null;
  const own = ranking.data?.own;
  const number = new Intl.NumberFormat(locale === "en" ? "en" : "zh-CN");
  const percent = new Intl.NumberFormat(locale === "en" ? "en" : "zh-CN", {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const pageLoading = ranking.loading || (!data && !ranking.error);
  const title = text("Public practice leaderboard", "公开练习积分榜");

  return (
    <section aria-label={title} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Trophy className="size-5 text-primary" aria-hidden="true" />
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">
            {ranking.data ? text(
              `With ranking enabled, each eligible solved problem earns ${number.format(ranking.data.pointsPerSolved)} points. Higher AC rate breaks ties.`,
              `开启排名后，每通过一道符合条件的题得 ${number.format(ranking.data.pointsPerSolved)} 分。同分时按 AC 率排序。`,
            ) : text("Public ranking is optional.", "公开练习排名可自主开启。")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppLink className={buttonVariants({ size: "sm", variant: "secondary" })} href="/practice/settings#public-practice">
            {text("Manage ranking", "管理排名")}
          </AppLink>
          <AppLink className={buttonVariants({ size: "sm" })} href="/practice/problems">
            {text("Practice problems", "去做题")}
          </AppLink>
        </div>
      </div>

      {own && (
        <dl aria-label={text("My public ranking stats", "我的公开排名数据")} className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-surface">
          {[
            { label: text("My rank", "我的排名"), value: own.rank === null ? text("Unranked", "暂未上榜") : `#${number.format(own.rank)}` },
            { label: text("My points", "我的积分"), value: number.format(own.points) },
            { label: text("Ranked solves", "计入排名的解题数"), value: number.format(own.solved) },
          ].map(metric => (
            <div key={metric.label} className="space-y-1 px-3 py-3 sm:px-4">
              <dt className="text-xs text-muted-foreground">{metric.label}</dt>
              <dd className="break-words text-base font-semibold tabular-nums sm:text-lg">{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <Loading resource={{ ...ranking, loading: pageLoading }}>
        {data && (
          <>
            {data.page === 1 && (
              <LeaderboardPodium leaders={data.items.slice(0, 3).map((item, index) => ({ ...item, key: index }))} />
            )}
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h3 id="public-rankings-title" className="font-semibold">{text("All rankings", "全部排名")}</h3>
                <p className="text-sm text-muted-foreground">{text(
                  `${number.format(data.total)} ranked`,
                  `${number.format(data.total)} 人上榜`,
                )}</p>
              </div>
              {data.items.length ? (
                <div className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring" role="region" aria-labelledby="public-rankings-title" tabIndex={0}>
                  <table aria-labelledby="public-rankings-title" className="w-full text-left text-sm">
                    <thead className="bg-surface-subtle text-muted-foreground">
                      <tr>
                        <th scope="col" className="whitespace-nowrap p-3">{text("Rank", "排名")}</th>
                        <th scope="col" className="whitespace-nowrap p-3">{text("Learner", "学习者")}</th>
                        <th scope="col" className="whitespace-nowrap p-3 text-right">{text("Points", "积分")}</th>
                        <th scope="col" className="whitespace-nowrap p-3 text-right">{text("Solved", "解题数")}</th>
                        <th scope="col" className="whitespace-nowrap p-3 text-right">{text("Scored attempts", "计分提交")}</th>
                        <th scope="col" className="whitespace-nowrap p-3 text-right">{text("AC rate", "AC 率")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((item, index) => (
                        <tr key={index} className={`border-t border-border ${item.isOwn ? "bg-primary/5" : ""}`}>
                          <td className="p-3 font-semibold tabular-nums">{item.rank === null ? "—" : number.format(item.rank)}</td>
                          <th scope="row" className="p-3 font-medium">
                            <div className="flex items-center gap-2">
                              <span className="shrink-0"><ProfileAvatar avatar={item.avatar} nickname={item.name} /></span>
                              <span className="break-words">{item.name}</span>
                              {item.isOwn && <span className="text-xs text-muted-foreground">{text("You", "你")}</span>}
                            </div>
                          </th>
                          <td className="p-3 text-right font-semibold tabular-nums">{number.format(item.points)}</td>
                          <td className="p-3 text-right tabular-nums">{number.format(item.solved)}</td>
                          <td className="p-3 text-right tabular-nums">{number.format(item.attempts)}</td>
                          <td className="p-3 text-right tabular-nums">{item.acRate === null ? "—" : percent.format(item.acRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {data.total === 0
                    ? text("Solve a public problem to take the first spot.", "完成一道公开练习题，争取成为第一位上榜的学习者。")
                    : text("No rankings on this page.", "本页暂无排名。")}
                </p>
              )}
            </div>
          </>
        )}
      </Loading>

      {(page > 1 || ranking.data?.hasMore) && (
        <nav className="flex flex-wrap items-center justify-end gap-2" aria-label={text("Leaderboard pages", "积分榜分页")}>
          <Button size="sm" variant="secondary" disabled={page === 1 || pageLoading} onClick={() => setPage(page - 1)}>
            {text("Previous", "上一页")}
          </Button>
          <span className="px-1 text-xs text-muted-foreground" aria-live="polite">
            {text(`Page ${number.format(page)}`, `第 ${number.format(page)} 页`)}
          </span>
          <Button size="sm" variant="secondary" disabled={!data?.hasMore || pageLoading} onClick={() => setPage(page + 1)}>
            {text("Next", "下一页")}
          </Button>
        </nav>
      )}
    </section>
  );
}
