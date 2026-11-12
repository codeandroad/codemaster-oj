"use client";

import Image from "next/image";
import { useId } from "react";
import { ChevronLeft, ChevronRight, CircleHelp, Medal, Trophy, UsersRound } from "lucide-react";
import { useLocale, type AppLocale } from "./locale-context";
import { AppLink as Link } from "./navigation";
import { ScholarshipIcon } from "./scholarship/scholarship-icon";
import { State } from "./student/shared";
import { Button } from "./ui/button";
import styles from "./points-page.module.css";

export interface RankedStudent {
  id: string;
  name: string;
  avatar?: string;
  points: number;
  rank: number;
  solvedProblems?: number;
  attempts?: number;
  acRate?: number | null;
  scholarshipBalance?: number;
}

export type OptionalField = "solvedProblems" | "attempts" | "acRate" | "scholarshipBalance";
export type VisibleFields = Record<OptionalField, boolean>;

export const rankNumber = new Intl.NumberFormat("zh-CN");
const ui = (locale: AppLocale, zh: string, en: string) => locale === "en" ? en : zh;
export const fieldName = (locale: AppLocale, field: OptionalField) => {
  const names: Record<OptionalField, [string, string]> = {
    solvedProblems: ["解题数", "Solved"],
    attempts: ["提交次数", "Attempts"],
    acRate: ["首解 AC 率", "First-solve AC rate"],
    scholarshipBalance: ["奖学金", "Scholarship"],
  };
  return ui(locale, ...names[field]);
};

function pageNumbers(current: number, last: number): (number | "…")[] {
  const visible = [...new Set([1, last, current - 1, current, current + 1])]
    .filter((value) => value >= 1 && value <= last)
    .sort((a, b) => a - b);
  return visible.flatMap((value, index) => {
    if (index === 0) return [value];
    const gap = value - visible[index - 1];
    return gap === 2 ? [value - 1, value] : gap > 2 ? ["…" as const, value] : [value];
  });
}

function StudentAvatar({ person, podium = false }: { person: RankedStudent; podium?: boolean }) {
  const className = podium ? styles.podiumAvatar : styles.avatar;
  return person.avatar ? (
    <Image src={person.avatar} unoptimized width={podium ? 80 : 40} height={podium ? 80 : 40} alt="" className={className} />
  ) : (
    <span aria-hidden="true" className={`${className} ${styles.avatarFallback}`}>{person.name.trim().slice(0, 1) || "学"}</span>
  );
}

function LeaderboardPodium({ people, visibleFields, isCurrent, profileHref, publicPractice }: { people: RankedStudent[]; visibleFields: VisibleFields; isCurrent: Current; profileHref?: ProfileLink; publicPractice: boolean }) {
  const { locale } = useLocale();
  if (!people.length) return null;
  return (
    <div className={styles.podium} data-count={people.length} role="group" aria-label={publicPractice ? ui(locale, "领先学习者", "Leading learners") : ui(locale, "领先学生", "Leading students")}>
      {people.map((person, index) => {
        const href = profileHref?.(person);
        const card = { className: styles.podiumCard, "data-slot": index + 1, "data-rank": person.rank };
        const content = <>
          <Trophy className={styles.podiumWatermark} aria-hidden="true" strokeWidth={1} />
          <span className={styles.podiumRank}><Trophy size={14} aria-hidden="true" />{ui(locale, `第 ${person.rank} 名`, `RANK ${person.rank}`)}</span>
          <StudentAvatar person={person} podium />
          <span className={styles.podiumName}>{person.name}{isCurrent(person) && <span className={styles.podiumMe}>{ui(locale, "我", "You")}</span>}</span>
          <span className={styles.podiumPoints}>{rankNumber.format(person.points)}<span>{ui(locale, "积分", "points")}</span></span>
          {visibleFields.scholarshipBalance && person.scholarshipBalance != null && <span className="mt-1 inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground" title={ui(locale, "当前奖学金余额", "Current Scholarship balance")}><ScholarshipIcon size={14} aria-hidden="true" /><span>{rankNumber.format(person.scholarshipBalance)}</span><span className="sr-only">{ui(locale, "奖学金", "Scholarship")}</span></span>}
        </>;
        return href ? <Link key={person.id} href={href} {...card} aria-label={ui(locale,
          `${person.name}，第 ${person.rank} 名，${person.points} 积分，查看主页`,
          `${person.name}, rank ${person.rank}, ${person.points} points, view profile`)}>{content}</Link>
          : <div key={person.id} {...card}>{content}</div>;
      })}
    </div>
  );
}

function LeaderboardRow({ person, current, pinned = false, visibleFields, href }: { person: RankedStudent; current: boolean; pinned?: boolean; visibleFields: VisibleFields; href?: string }) {
  const { locale } = useLocale();
  const student = <>
    <StudentAvatar person={person} />
    <span className={styles.studentName}>{person.name}{current && <span className={styles.meTag}>{ui(locale, "我", "You")}</span>}</span>
  </>;
  return (
    <tr className={`${styles.row} ${current ? styles.currentRow : ""} ${pinned ? styles.pinnedRow : ""}`}>
      <td className={styles.rankCell}>
        <span className={styles.rank} data-rank={person.rank}>
          {person.rank <= 3 && <Medal size={19} aria-hidden="true" />}
          <span>{rankNumber.format(person.rank)}</span>
        </span>
      </td>
      <td className={styles.studentCell}>
        {href ? <Link href={href} className={styles.studentLink}>{student}</Link> : <span className={styles.studentLink}>{student}</span>}
      </td>
      <td className={styles.pointsCell}>{rankNumber.format(person.points)}</td>
      {visibleFields.solvedProblems && <td className={styles.numberCell}>{person.solvedProblems == null ? "—" : rankNumber.format(person.solvedProblems)}</td>}
      {visibleFields.attempts && <td className={styles.numberCell}>{person.attempts == null ? "—" : rankNumber.format(person.attempts)}</td>}
      {visibleFields.acRate && <td className={`${styles.numberCell} ${person.acRate != null ? styles.rateCell : ""}`}>{person.acRate == null ? "—" : `${Number.isInteger(person.acRate) ? person.acRate : person.acRate.toFixed(1)}%`}</td>}
      {visibleFields.scholarshipBalance && <td className={styles.numberCell}>{person.scholarshipBalance == null ? "—" : <span className="inline-flex items-center gap-1.5"><ScholarshipIcon size={14} aria-hidden="true" />{rankNumber.format(person.scholarshipBalance)}</span>}</td>}
    </tr>
  );
}

type Current = (person: RankedStudent) => boolean;
type ProfileLink = (person: RankedStudent) => string | undefined;
type RankingsResource = Parameters<typeof State>[0]["data"] & {
  data: { items: RankedStudent[]; total?: number } | null;
};

export function LeaderboardStandings({ ranking, leaders, visibleFields, leaderFields, isCurrent, profileHref, pinned,
  page, pageSize, onPageChange, refresh, refreshing, publicPractice = false }: {
  ranking: RankingsResource; leaders?: RankingsResource;
  visibleFields: VisibleFields; leaderFields?: VisibleFields;
  isCurrent: Current; profileHref?: ProfileLink; pinned?: RankedStudent | null;
  page: number; pageSize: number; onPageChange: (page: number) => void;
  refresh: () => void; refreshing?: boolean; publicPractice?: boolean;
}) {
  const { locale } = useLocale();
  const total = ranking.data?.total ?? 0;
  const headingId = useId();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  const showMe = pinned && !ranking.data?.items.some(person => person.id === pinned.id) ? pinned : null;
  const optionalCount = Object.values(visibleFields).filter(Boolean).length;
  const tableWidth = ["min-w-[420px]", "min-w-[500px]", "min-w-[580px]", "min-w-[700px]", "min-w-[820px]"][optionalCount];

  return (<>
      {leaders && <div className={styles.podiumArea} aria-busy={leaders.loading} hidden={!leaders.loading && !leaders.error && !leaders.data?.items.length}>
        {leaders.loading ? (
          <div className={styles.podiumLoading} role="status"><Trophy size={30} aria-hidden="true" /><span>{ui(locale, "正在加载领先排名…", "Loading leading rankings…")}</span></div>
        ) : (
          <State data={leaders}>
            <LeaderboardPodium people={leaders.data?.items ?? []} visibleFields={leaderFields ?? visibleFields} isCurrent={isCurrent} profileHref={profileHref} publicPractice={publicPractice} />
          </State>
        )}
      </div>}
      <section className={styles.rankingsPanel} aria-labelledby={headingId}>
        <div className={styles.tableHeading}>
          <h2 id={headingId}>{ui(locale, "全部排名", "All rankings")}</h2>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{publicPractice ? ui(locale, `${rankNumber.format(total)} 人上榜`, `${rankNumber.format(total)} ranked`) : ui(locale, `${rankNumber.format(total)} 名学生`, `${rankNumber.format(total)} students`)}</span>
            <Button type="button" size="sm" variant="ghost" disabled={ranking.loading || leaders?.loading || refreshing} onClick={refresh}>{ui(locale, "刷新", "Refresh")}</Button>
          </div>
        </div>
        <State data={ranking}>
          {ranking.loading ? (
            <p role="status" className={styles.tableLoading}>{ui(locale, "正在更新排行榜…", "Updating leaderboard…")}</p>
          ) : (
            <>
              <div className={styles.tableScroll} role="region" aria-label={ui(locale, "排名表格", "Rankings table")} tabIndex={0}>
                <table className={`${styles.table} ${tableWidth}`} aria-labelledby={headingId}>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.rankCell}>{ui(locale, "排名", "Rank")}</th>
                      <th scope="col" className={styles.studentCell}>{publicPractice ? ui(locale, "学习者", "Learner") : ui(locale, "学生", "Student")}</th>
                      <th scope="col" className={styles.numberCell}>{ui(locale, "积分", "Points")}</th>
                      {visibleFields.solvedProblems && <th scope="col" className={styles.numberCell}><abbr title={publicPractice ? ui(locale, "仅统计计入公开排名的首次通过。", "Counts first solves included in public ranking.") : ui(locale, "仅统计所选时间范围内计入排行榜的解题记录。", "Counts only solves that earned leaderboard credit in the selected period.")}>{fieldName(locale, "solvedProblems")}<CircleHelp size={12} aria-hidden="true" /></abbr></th>}
                      {visibleFields.attempts && <th scope="col" className={styles.numberCell}>{publicPractice ? ui(locale, "计分提交", "Scored attempts") : fieldName(locale, "attempts")}</th>}
                      {visibleFields.acRate && <th scope="col" className={styles.numberCell}>
                        <abbr title={publicPractice ? ui(locale, "每道题计至首次有效 AC。", "Results count through the first valid AC per problem.") : ui(locale, "纳入统计的 AC 数 ÷ 有效判题数。普通练习和作业计至同一版本首次有效 AC，限时训练和 Paper 4 按正式提交统计。", "Accepted results ÷ valid results included in the rate. Practice and assignments count through the first valid AC per version. Timed practice and Paper 4 count formal submissions.")}>{fieldName(locale, "acRate")}<CircleHelp size={12} aria-hidden="true" /></abbr>
                      </th>}
                      {visibleFields.scholarshipBalance && <th scope="col" className={styles.numberCell}><abbr title={ui(locale, "当前可用余额；不受排行榜时间筛选影响", "Current available balance, independent of the selected time period")}>{fieldName(locale, "scholarshipBalance")}<CircleHelp size={12} aria-hidden="true" /></abbr></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.data?.items.map((person) => <LeaderboardRow key={person.id} person={person} current={isCurrent(person)} visibleFields={visibleFields} href={profileHref?.(person)} />)}
                    {showMe && <LeaderboardRow person={showMe} current pinned visibleFields={visibleFields} href={profileHref?.(showMe)} />}
                  </tbody>
                </table>
                {!ranking.data?.items.length && !showMe && <div className={styles.empty}><UsersRound size={30} aria-hidden="true" /><p>{publicPractice
                  ? total === 0 ? ui(locale, "目前还没有学习者上榜。", "No learners are ranked yet.") : ui(locale, "当前页暂无排名。", "No rankings on this page.")
                  : ui(locale, "当前范围暂无学生。", "No students in this scope.")}</p></div>}
              </div>
              {(!publicPractice || pages > 1 || page > 1) && <div className={styles.footer}>
                <span>{total ? ui(locale, `显示 ${start}–${end} / ${rankNumber.format(total)} ${publicPractice ? "名学习者" : "名学生"}`, `Showing ${start}–${end} of ${rankNumber.format(total)} ${publicPractice ? "learners" : "students"}`) : ui(locale, "暂无学生", "No students")}{showMe ? ui(locale, " · 我的数据单独显示", " · My result shown separately") : ""}</span>
                <nav aria-label={ui(locale, "排行榜分页", "Leaderboard pagination")} className={styles.pagination}>
                  <button type="button" aria-label={ui(locale, "上一页", "Previous page")} disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
                  {pageNumbers(page, pages).map((number, index) => number === "…" ? (
                    <span key={`gap-${index}`} aria-hidden="true">…</span>
                  ) : (
                    <button
                      key={number}
                      type="button"
                      aria-label={ui(locale, `第 ${number} 页`, `Page ${number}`)}
                      aria-current={page === number ? "page" : undefined}
                      onClick={() => onPageChange(number)}
                    >
                      {number}
                    </button>
                  ))}
                  <button type="button" aria-label={ui(locale, "下一页", "Next page")} disabled={page >= pages} onClick={() => onPageChange(page + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
                </nav>
              </div>}
            </>
          )}
        </State>
      </section>
    </>
  );
}
