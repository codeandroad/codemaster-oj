"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { AppLink as Link } from "./navigation";
import { ChevronLeft, ChevronRight, CircleHelp, Medal, SlidersHorizontal, Trophy, UsersRound } from "lucide-react";
import styles from "./points-page.module.css";
import { ScholarshipIcon } from "./scholarship/scholarship-icon";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { useLocale, type AppLocale } from "./locale-context";
import { PageHeader } from "./page-chrome";
import {
  apiMessage,
  productionApi,
  type Assignment,
  type CampusRole,
  type CampusUser,
  type ProductionProblem,
} from "@/lib/production-api";
import { State, useData, useRefreshOnReturn } from "./student/shared";

interface RankedStudent {
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

type RankingPeriod = "all" | "month" | "week";
type OptionalField = "solvedProblems" | "attempts" | "acRate" | "scholarshipBalance";
type VisibleFields = Record<OptionalField, boolean>;
interface LeaderboardContext {
  id: string;
  name: string;
}
interface LeaderboardContextsResponse {
  items: LeaderboardContext[];
  visibleFields: VisibleFields;
  canManage: boolean;
}
interface LeaderboardResponse {
  items: RankedStudent[];
  total: number;
  page: number;
  pageSize: number;
  me?: RankedStudent | null;
  classId: string | null;
  visibleFields: VisibleFields;
}

const allFieldsVisible: VisibleFields = { solvedProblems: true, attempts: true, acRate: true, scholarshipBalance: true };
const fieldLabels: { field: OptionalField; label: string }[] = [
  { field: "solvedProblems", label: "解题数" },
  { field: "attempts", label: "提交次数" },
  { field: "acRate", label: "首解 AC 率" },
  { field: "scholarshipBalance", label: "奖学金" },
];

const rankingPeriods: { value: RankingPeriod; label: string }[] = [
  { value: "all", label: "全部时间" },
  { value: "month", label: "本月" },
  { value: "week", label: "本周" },
];
const rankNumber = new Intl.NumberFormat("zh-CN");
const ui = (locale: AppLocale, zh: string, en: string) => locale === "en" ? en : zh;
const fieldName = (locale: AppLocale, field: OptionalField) => {
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

function profileHref(person: RankedStudent, workspace: CampusRole, classId: string) {
  const query = new URLSearchParams({ from: "points" });
  if (classId) query.set("classId", classId);
  return `/${workspace}/people/${encodeURIComponent(person.id)}?${query}`;
}

function StudentAvatar({ person, podium = false }: { person: RankedStudent; podium?: boolean }) {
  const className = podium ? styles.podiumAvatar : styles.avatar;
  return person.avatar ? (
    <Image src={person.avatar} unoptimized width={podium ? 80 : 40} height={podium ? 80 : 40} alt="" className={className} />
  ) : (
    <span aria-hidden="true" className={`${className} ${styles.avatarFallback}`}>{person.name.trim().slice(0, 1) || "学"}</span>
  );
}

function LeaderboardPodium({ people, user, workspace, classId, visibleFields }: { people: RankedStudent[]; user: CampusUser; workspace: CampusRole; classId: string; visibleFields: VisibleFields }) {
  const { locale } = useLocale();
  if (!people.length) return null;
  return (
    <div className={styles.podium} data-count={people.length} role="group" aria-label={ui(locale, "领先学生", "Leading students")}>
      {people.map((person, index) => (
        <Link
          key={person.id}
          href={profileHref(person, workspace, classId)}
          className={styles.podiumCard}
          data-slot={index + 1}
          data-rank={person.rank}
          aria-label={ui(locale, `${person.name}，第 ${person.rank} 名，${person.points} 积分，查看主页`, `${person.name}, rank ${person.rank}, ${person.points} points, view profile`)}
        >
          <Trophy className={styles.podiumWatermark} aria-hidden="true" strokeWidth={1} />
          <span className={styles.podiumRank}><Trophy size={14} aria-hidden="true" />{ui(locale, `第 ${person.rank} 名`, `RANK ${person.rank}`)}</span>
          <StudentAvatar person={person} podium />
          <span className={styles.podiumName}>{person.name}{person.id === user.identityId && <span className={styles.podiumMe}>{ui(locale, "我", "You")}</span>}</span>
          <span className={styles.podiumPoints}>{rankNumber.format(person.points)}<span>{ui(locale, "积分", "points")}</span></span>
          {visibleFields.scholarshipBalance && person.scholarshipBalance != null && <span className="mt-1 inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground" title={ui(locale, "当前奖学金余额", "Current Scholarship balance")}><ScholarshipIcon size={14} aria-hidden="true" /><span>{rankNumber.format(person.scholarshipBalance)}</span><span className="sr-only">{ui(locale, "奖学金", "Scholarship")}</span></span>}
        </Link>
      ))}
    </div>
  );
}

function LeaderboardRow({ person, current, pinned = false, visibleFields, workspace, classId }: { person: RankedStudent; current: boolean; pinned?: boolean; visibleFields: VisibleFields; workspace: CampusRole; classId: string }) {
  const { locale } = useLocale();
  return (
    <tr className={`${styles.row} ${current ? styles.currentRow : ""} ${pinned ? styles.pinnedRow : ""}`}>
      <td className={styles.rankCell}>
        <span className={styles.rank} data-rank={person.rank}>
          {person.rank <= 3 && <Medal size={19} aria-hidden="true" />}
          <span>{rankNumber.format(person.rank)}</span>
        </span>
      </td>
      <td className={styles.studentCell}>
        <Link href={profileHref(person, workspace, classId)} className={styles.studentLink}>
          <StudentAvatar person={person} />
          <span className={styles.studentName}>{person.name}{current && <span className={styles.meTag}>{ui(locale, "我", "You")}</span>}</span>
        </Link>
      </td>
      <td className={styles.pointsCell}>{rankNumber.format(person.points)}</td>
      {visibleFields.solvedProblems && <td className={styles.numberCell}>{person.solvedProblems == null ? "—" : rankNumber.format(person.solvedProblems)}</td>}
      {visibleFields.attempts && <td className={styles.numberCell}>{person.attempts == null ? "—" : rankNumber.format(person.attempts)}</td>}
      {visibleFields.acRate && <td className={`${styles.numberCell} ${person.acRate != null ? styles.rateCell : ""}`}>{person.acRate == null ? "—" : `${Number.isInteger(person.acRate) ? person.acRate : person.acRate.toFixed(1)}%`}</td>}
      {visibleFields.scholarshipBalance && <td className={styles.numberCell}>{person.scholarshipBalance == null ? "—" : <span className="inline-flex items-center gap-1.5"><ScholarshipIcon size={14} aria-hidden="true" />{rankNumber.format(person.scholarshipBalance)}</span>}</td>}
    </tr>
  );
}

function LeaderboardTable({
  user, classId, classes, onClassChange, configuredFields, canManage, staff, workspace, onSettingsUpdated, refreshVersion, refresh, refreshingPoints,
}: {
  user: CampusUser;
  classId: string;
  classes: LeaderboardContext[];
  onClassChange: (classId: string) => void;
  configuredFields: VisibleFields;
  canManage: boolean;
  staff: boolean;
  workspace: CampusRole;
  onSettingsUpdated: () => void;
  refreshVersion: number;
  refresh: () => void;
  refreshingPoints: boolean;
}) {
  const { locale } = useLocale();
  const [period, setPeriod] = useState<RankingPeriod>("all");
  const filterKey = `${classId}/${period}`;
  const [pagination, setPagination] = useState({ filterKey, page: 1 });
  // Reset before committing a new scope, including navigation back to an earlier filter.
  if (pagination.filterKey !== filterKey) setPagination({ filterKey, page: 1 });
  const page = pagination.filterKey === filterKey ? pagination.page : 1;
  const setPage = (next: number | ((current: number) => number)) => setPagination({ filterKey, page: typeof next === "function" ? next(page) : next });
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftClassId, setDraftClassId] = useState(classId);
  const [draftPeriod, setDraftPeriod] = useState<RankingPeriod>(period);
  const filterCount = Number(Boolean(classId)) + Number(period !== "all");
  const [draftFields, setDraftFields] = useState<VisibleFields>(configuredFields);
  const [savedFields, setSavedFields] = useState<VisibleFields>(configuredFields);
  const [saving, setSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const pageSize = 10;
  const ranking = useData<LeaderboardResponse>(`points/leaderboard?${new URLSearchParams({ ...(classId ? { classId } : {}), period, page: String(page), pageSize: String(pageSize) })}`, refreshVersion);
  const leaders = useData<LeaderboardResponse>(`points/leaderboard?${new URLSearchParams({ ...(classId ? { classId } : {}), period, page: "1", pageSize: "3" })}`, refreshVersion);
  const total = ranking.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  const me = ranking.data?.me;
  const showMe = me && !ranking.data?.items.some((person) => person.id === me.id);
  const visibleFields = staff ? allFieldsVisible : ranking.data?.visibleFields ?? configuredFields;
  const optionalCount = fieldLabels.filter(({ field }) => visibleFields[field]).length;
  const tableWidth = optionalCount === 4 ? "min-w-[820px]" : optionalCount === 3 ? "min-w-[700px]" : optionalCount === 2 ? "min-w-[580px]" : optionalCount === 1 ? "min-w-[500px]" : "min-w-[420px]";
  const dirtySettings = fieldLabels.some(({ field }) => draftFields[field] !== savedFields[field]);

  async function saveVisibleFields() {
    setSaving(true);
    setSettingsMessage("");
    setSettingsError(false);
    try {
      const { solvedProblems, attempts, acRate, scholarshipBalance } = draftFields;
      await productionApi("points/leaderboard/settings", {
        method: "PATCH",
        body: { visibleFields: { solvedProblems, attempts, acRate, scholarshipBalance } },
      });
      setSavedFields({ ...draftFields });
      setSettingsMessage("saved");
      onSettingsUpdated();
      ranking.reload();
    } catch (error) {
      setSettingsMessage(apiMessage(error));
      setSettingsError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <div className={styles.pageActions}>
          <DialogTrigger asChild>
            <button type="button" className={styles.filterButton} onClick={() => { setDraftClassId(classId); setDraftPeriod(period); }}>
              <SlidersHorizontal size={16} aria-hidden="true" />{ui(locale, "筛选", "Filters")}
              {filterCount > 0 && <span className={styles.filterCount}>{filterCount}</span>}
            </button>
          </DialogTrigger>
        </div>
        <DialogContent className={styles.filterDrawer} aria-describedby={undefined}>
          <DialogTitle className={styles.drawerTitle}>{ui(locale, "排行榜筛选", "Leaderboard filters")}</DialogTitle>
          <div className={styles.drawerBody}>
            <div className={styles.toolbar}>
              <label className={styles.scopeLabel}>
                <span className={styles.filterLabel}><UsersRound size={16} aria-hidden="true" />{ui(locale, "范围", "Scope")}</span>
                <select
                  value={draftClassId}
                  onChange={(event) => setDraftClassId(event.target.value)}
                  className={styles.scopeSelect}
                >
                  <option value="">{ui(locale, "全校学生", "All students")}</option>
                  {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <fieldset className={styles.periodField}>
                <legend>{ui(locale, "时间", "Time period")}</legend>
                <div role="group" aria-label={ui(locale, "排行榜时间范围", "Leaderboard time period")} className={styles.periods}>
                {rankingPeriods.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={draftPeriod === option.value}
                    onClick={() => setDraftPeriod(option.value)}
                    className={styles.periodButton}
                  >
                    {ui(locale, option.label, option.value === "all" ? "All time" : option.value === "month" ? "This month" : "This week")}
                  </button>
                ))}
                </div>
              </fieldset>
              <div className={styles.toolbarActions}>
                <button type="button" aria-expanded={showRules} aria-controls="leaderboard-rules" onClick={() => setShowRules((value) => !value)} className={styles.textButton}><CircleHelp size={16} aria-hidden="true" />{ui(locale, "积分规则", "Points rules")}</button>
                {canManage && <button type="button" aria-expanded={showSettings} aria-controls="leaderboard-fields" onClick={() => setShowSettings((value) => !value)} className={styles.textButton}><SlidersHorizontal size={16} aria-hidden="true" />{ui(locale, "显示字段", "Visible fields")}</button>}
              </div>
            </div>
            {showRules && (
              <div id="leaderboard-rules" className={styles.disclosure}>
                <p>{ui(locale, "积分来自审核公开题目的首次有效 AC、Paper 4 正式交卷后每道大题首次通过全部自动测试的 10 分，以及已启用奖励的 ACSL 试卷所得积分。作业与训练额外奖励以奖学金入账。积分相同时比较未四舍五入的首解 AC 率，暂无有效统计样本者排在已有比率者之后。积分和首解 AC 率均相同时比较当前奖学金余额，三项均相同则并列。", "Points come from the first valid AC on approved public problems, 10 points for each Paper 4 question that first passes all automatic tests after formal submission, and awards on ACSL papers with points enabled. Assignment and practice bonuses are paid as Scholarship. When points match, higher unrounded first-solve AC rates rank first. Students without results included in the rate rank below those with a rate. Current scholarship balance breaks any remaining tie. Students with all three values equal share a rank.")}</p>
                {optionalCount > 0 && <p className="mt-1">{ui(locale, "解题数按获榜分的普通题和 Paper 4 大题统计。首解 AC 率是纳入统计的有效判题结果中 AC 的比例。普通练习和作业按接收顺序计至同一题目版本的首次有效 AC，之后的重交仍计入提交次数。限时训练按正式提交统计，Paper 4 每次交卷中每道大题各计一次。", "Solved counts distinct regular and Paper 4 questions earning leaderboard points. The first-solve AC rate is the share of included judging results that passed. For practice and assignments, results count in submission order through the first valid AC on each problem version. Later resubmissions still count as attempts. Timed practice counts formal submissions, and Paper 4 counts each question per formal submission.")}</p>}
              </div>
            )}
            {canManage && showSettings && (
              <fieldset id="leaderboard-fields" className={`${styles.disclosure} ${styles.fieldSettings}`}>
                <legend className="sr-only">{ui(locale, "全校学生端排行榜字段", "Student leaderboard fields")}</legend>
                <p className="text-sm font-semibold">{ui(locale, "学生端显示字段", "Fields shown to students")} <span className="ml-2 text-xs font-normal text-muted-foreground">{ui(locale, "排名、姓名或昵称和积分始终显示", "Rank, display name, and points are always shown")}</span></p>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3">
                  {fieldLabels.map(({ field, label }) => (
                    <label key={field} className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={saving}
                        checked={draftFields[field]}
                        onChange={(event) => { setDraftFields((value) => ({ ...value, [field]: event.target.checked })); setSettingsMessage(""); setSettingsError(false); }}
                        className="size-4 accent-primary"
                      />
                      {ui(locale, label, fieldName(locale, field))}
                    </label>
                  ))}
                  <Button type="button" size="sm" disabled={saving || !dirtySettings} onClick={() => void saveVisibleFields()}>
                    {saving ? ui(locale, "正在保存…", "Saving…") : ui(locale, "保存显示设置", "Save display settings")}
                  </Button>
                </div>
                {settingsMessage && <p role={settingsError ? "alert" : "status"} className={`mt-2 text-sm ${settingsError ? "text-destructive" : "text-muted-foreground"}`}>{settingsMessage === "saved" ? ui(locale, "全校学生端排行榜字段已更新。", "Student leaderboard fields updated.") : settingsMessage}</p>}
              </fieldset>
            )}
          </div>
          <div className={styles.drawerFooter}>
            <Button type="button" variant="secondary" onClick={() => { setDraftClassId(""); setDraftPeriod("all"); }}>{ui(locale, "重置", "Reset")}</Button>
            <Button type="button" onClick={() => { setFilterOpen(false); setPeriod(draftPeriod); onClassChange(draftClassId); }}>{ui(locale, "应用筛选", "Apply filters")}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className={styles.podiumArea} aria-busy={leaders.loading} hidden={!leaders.loading && !leaders.error && !leaders.data?.items.length}>
        {leaders.loading ? (
          <div className={styles.podiumLoading} role="status"><Trophy size={30} aria-hidden="true" /><span>{ui(locale, "正在加载领先学生…", "Loading leading students…")}</span></div>
        ) : (
          <State data={leaders}>
            <LeaderboardPodium people={leaders.data?.items ?? []} user={user} workspace={workspace} classId={classId} visibleFields={staff ? allFieldsVisible : leaders.data?.visibleFields ?? configuredFields} />
          </State>
        )}
      </div>
      <section className={styles.rankingsPanel} aria-labelledby="leaderboard-list-heading">
        <div className={styles.tableHeading}>
          <h2 id="leaderboard-list-heading">{ui(locale, "全部排名", "All rankings")}</h2>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{ui(locale, `${rankNumber.format(total)} 名学生`, `${rankNumber.format(total)} students`)}</span>
            <Button type="button" size="sm" variant="ghost" disabled={ranking.loading || leaders.loading || refreshingPoints} onClick={refresh}>{ui(locale, "刷新", "Refresh")}</Button>
          </div>
        </div>
        <State data={ranking}>
          {ranking.loading ? (
            <p role="status" className={styles.tableLoading}>{ui(locale, "正在更新排行榜…", "Updating leaderboard…")}</p>
          ) : (
            <>
              <div className={styles.tableScroll}>
                <table className={`${styles.table} ${tableWidth}`}>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.rankCell}>{ui(locale, "排名", "Rank")}</th>
                      <th scope="col" className={styles.studentCell}>{ui(locale, "学生", "Student")}</th>
                      <th scope="col" className={styles.numberCell}>{ui(locale, "积分", "Points")}</th>
                      {visibleFields.solvedProblems && <th scope="col" className={styles.numberCell}><abbr title={ui(locale, "仅统计所选时间范围内计入排行榜的解题记录。", "Counts only solves that earned leaderboard credit in the selected period.")}>{fieldName(locale, "solvedProblems")}<CircleHelp size={12} aria-hidden="true" /></abbr></th>}
                      {visibleFields.attempts && <th scope="col" className={styles.numberCell}>{fieldName(locale, "attempts")}</th>}
                      {visibleFields.acRate && <th scope="col" className={styles.numberCell}>
                        <abbr title={ui(locale, "纳入统计的 AC 数 ÷ 有效判题数。普通练习和作业计至同一版本首次有效 AC，限时训练和 Paper 4 按正式提交统计。", "Accepted results ÷ valid results included in the rate. Practice and assignments count through the first valid AC per version. Timed practice and Paper 4 count formal submissions.")}>{fieldName(locale, "acRate")}<CircleHelp size={12} aria-hidden="true" /></abbr>
                      </th>}
                      {visibleFields.scholarshipBalance && <th scope="col" className={styles.numberCell}><abbr title={ui(locale, "当前可用余额；不受排行榜时间筛选影响", "Current available balance, independent of the selected time period")}>{fieldName(locale, "scholarshipBalance")}<CircleHelp size={12} aria-hidden="true" /></abbr></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.data?.items.map((person) => <LeaderboardRow key={person.id} person={person} current={person.id === user.identityId} visibleFields={visibleFields} workspace={workspace} classId={classId} />)}
                    {showMe && <LeaderboardRow person={me} current pinned visibleFields={visibleFields} workspace={workspace} classId={classId} />}
                  </tbody>
                </table>
                {!ranking.data?.items.length && !showMe && <div className={styles.empty}><UsersRound size={30} aria-hidden="true" /><p>{ui(locale, "当前范围暂无学生。", "No students in this scope.")}</p></div>}
              </div>
              <div className={styles.footer}>
                <span>{total ? ui(locale, `显示 ${start}–${end} / ${rankNumber.format(total)} 名学生`, `Showing ${start}–${end} of ${rankNumber.format(total)} students`) : ui(locale, "暂无学生", "No students")}{showMe ? ui(locale, " · 我的数据单独显示", " · My result shown separately") : ""}</span>
                <nav aria-label={ui(locale, "排行榜分页", "Leaderboard pagination")} className={styles.pagination}>
                  <button type="button" aria-label={ui(locale, "上一页", "Previous page")} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
                  {pageNumbers(page, pages).map((number, index) => number === "…" ? (
                    <span key={`gap-${index}`} aria-hidden="true">…</span>
                  ) : (
                    <button
                      key={number}
                      type="button"
                      aria-label={ui(locale, `第 ${number} 页`, `Page ${number}`)}
                      aria-current={page === number ? "page" : undefined}
                      onClick={() => setPage(number)}
                    >
                      {number}
                    </button>
                  ))}
                  <button type="button" aria-label={ui(locale, "下一页", "Next page")} disabled={page >= pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
                </nav>
              </div>
            </>
          )}
        </State>
      </section>
    </>
  );
}

function Leaderboard({ user, staff, workspace }: { user: CampusUser; staff: boolean; workspace: CampusRole }) {
  const { locale } = useLocale();
  const { version, refresh } = useRefreshOnReturn();
  const me = useData<{ points: number }>(staff ? "" : "points/me", version);
  const personalPoints = me.data;
  const contexts = useData<LeaderboardContextsResponse>("points/leaderboard/contexts");
  const searchParams = useSearchParams();
  const requestedClassId = searchParams.get("classId");
  const [selectedClassId, setSelectedClassId] = useState(requestedClassId ?? "");
  useEffect(() => { setSelectedClassId(requestedClassId ?? ""); }, [requestedClassId]);
  const classes = contexts.data?.items ?? [];
  const selectedClass = classes.find((item) => item.id === selectedClassId);
  const effectiveClassId = selectedClass?.id ?? "";
  const selectClass = (id: string) => {
    setSelectedClassId(id);
    const next = new URLSearchParams(searchParams.toString());
    if (id) next.set("classId", id);
    else next.delete("classId");
    window.history.replaceState(null, "", `${window.location.pathname}${next.size ? `?${next}` : ""}`);
  };

  return (
    <section className={styles.page} aria-label={ui(locale, "积分排行榜", "Leaderboard")}>
      <PageHeader title={ui(locale, "积分排行榜", "Leaderboard")}/>
      {!staff && <div className={styles.summaryBar}>
        <div className={styles.personalSummary}>
          <span>{ui(locale, "积分", "Points")}<strong>{personalPoints ? rankNumber.format(personalPoints.points) : "…"}</strong></span>
        </div>
      </div>}
      <State data={contexts}>
        {contexts.data && (
          <LeaderboardTable user={user} classId={effectiveClassId} classes={classes} onClassChange={selectClass} configuredFields={contexts.data.visibleFields} canManage={workspace === "admin" && contexts.data.canManage} staff={staff} workspace={workspace} onSettingsUpdated={contexts.reload} refreshVersion={version} refresh={refresh} refreshingPoints={me.loading} />
        )}
      </State>
    </section>
  );
}

function assignmentProblemHref(assignmentId: string, problem: Assignment["problems"][number]) {
  const query = new URLSearchParams({
    returnTo: `/teacher/assignments/${assignmentId}/edit?tab=problems`,
  });
  if (problem.versionId) query.set("versionId", problem.versionId);
  return `/teacher/problems/${problem.problemId}/edit?${query.toString()}`;
}

export function PointsPage({ user, student = true, workspace = "student" }: { user: CampusUser; student?: boolean; workspace?: CampusRole }) {
  const { locale } = useLocale();
  const staff = !student && (workspace === "teacher" || workspace === "admin") && user.roles.some((role) => role === "teacher" || role === "admin");
  const admin = workspace === "admin" && user.roles.includes("admin");
  const problems = useData<{ items: ProductionProblem[] }>(admin ? "problems" : "");
  const assignments = useData<{ items: Assignment[] }>(staff ? "assignments" : "");
  const [assignmentId, setAssignmentId] = useState("");
  const [problemId, setProblemId] = useState("");
  const [points, setPoints] = useState(10);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const assignment = assignments.data?.items.find((item) => item.id === assignmentId);
  const assignmentBonus = assignment?.problems.reduce((sum, problem) => sum + (problem.rewardPoints ?? 0), 0) ?? 0;

  return (
    <>
      <Leaderboard user={user} staff={!student} workspace={workspace} />
      {staff && (
        <section className="mt-6 rounded border border-border bg-surface p-5">
          <h2 className="font-semibold">{ui(locale, "作业额外奖励", "Assignment bonuses")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {ui(locale, "作业额外奖励以奖学金发放。每题最多 20、每份作业合计最多 100，每位学生每周最多领取 200。请在作业的题目页设置。", "Assignment bonuses are paid as Scholarship, up to 20 per problem, 100 per assignment, and 200 per student each week. Set bonuses on the assignment's Problems tab.")}
          </p>
          <State data={assignments}>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <select
                aria-label={ui(locale, "查看作业额外奖励", "View assignment bonuses")}
                className="max-w-full rounded border border-border bg-surface p-2"
                value={assignmentId}
                onChange={(event) => setAssignmentId(event.target.value)}
              >
                <option value="">{ui(locale, "选择作业查看奖励", "Select an assignment")}</option>
                {assignments.data?.items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              {assignment && <Link href={`/teacher/assignments/${assignment.id}/edit?tab=problems`} className="font-semibold text-primary hover:underline">{ui(locale, "前往题目页编辑 →", "Edit on Problems tab →")}</Link>}
            </div>
            {assignment && (
              <div className="mt-4 overflow-x-auto rounded border border-border">
                <p className="border-b border-border bg-surface-subtle p-3 text-sm font-semibold">{ui(locale, `当前额外奖励合计 ${assignmentBonus} / 100 奖学金`, `Current bonus total: ${assignmentBonus} / 100 Scholarship`)}</p>
                <table className="w-full text-left text-sm">
                  <thead><tr><th className="p-3">{ui(locale, "题目", "Problem")}</th><th>{ui(locale, "首次 AC 积分", "First-AC points")}</th><th>{ui(locale, "本作业额外奖励", "Assignment bonus")}</th></tr></thead>
                  <tbody>
                    {assignment.problems.map((problem) => (
                      <tr key={problem.problemId} className="border-t border-border">
                        <td className="p-3"><Link href={assignmentProblemHref(assignment.id, problem)} className="font-semibold text-primary hover:underline">{problem.title ?? problem.problemId}</Link></td>
                        <td>+{problem.firstAcPoints ?? 10}</td>
                        <td>+{problem.rewardPoints ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </State>
        </section>
      )}
      {admin && (
        <section className="mt-6 rounded border border-border bg-surface p-5">
          <h2 className="font-semibold">{ui(locale, "题目首次 AC 积分设置", "First-AC point settings")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{ui(locale, "默认每题 10 积分；管理员可按题目调整为 0–30 积分。已入账积分不变。", "Each problem awards 10 points by default. Administrators can set 0–30 points per problem. Points already awarded do not change.")}</p>
          <State data={problems}>
            <form
              className="mt-4 flex flex-wrap items-center gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                void productionApi("points/rewards", {
                  method: "POST",
                  body: { problemId, assignmentId: null, points },
                }).then(() => {
                  setMessage("saved");
                  problems.reload();
                }).catch((error: Error) => setMessage(error.message)).finally(() => setBusy(false));
              }}
            >
              <select
                required
                aria-label={ui(locale, "设置首次 AC 积分的题目", "Problem for first-AC points")}
                className="max-w-full rounded border border-border bg-surface p-2"
                value={problemId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setProblemId(nextId);
                  setPoints(problems.data?.items.find((problem) => problem.id === nextId)?.firstAcPoints ?? 10);
                }}
              >
                <option value="">{ui(locale, "选择题目", "Select a problem")}</option>
                {problems.data?.items.filter((problem) => problem.canEdit).map((problem) => <option key={problem.id} value={problem.id}>{problem.title}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm">
                {ui(locale, "首次 AC 积分", "First-AC points")}
                <input required type="number" min={0} max={30} step={1} value={points} onChange={(event) => setPoints(Number(event.target.value))} className="w-24 rounded border border-border bg-surface p-2" />
              </label>
              <Button disabled={busy || !problemId}>{ui(locale, "保存积分", "Save points")}</Button>
            </form>
            {problemId && <p className="mt-2 text-xs text-muted-foreground">{ui(locale, `当前设置：${problems.data?.items.find((problem) => problem.id === problemId)?.firstAcPoints ?? 10} 积分`, `Current setting: ${problems.data?.items.find((problem) => problem.id === problemId)?.firstAcPoints ?? 10} points`)}</p>}
            <p role="status" className="mt-3 text-sm">{message === "saved" ? ui(locale, "题目首次 AC 积分已保存。", "First-AC points saved.") : message}</p>
          </State>
        </section>
      )}
    </>
  );
}
