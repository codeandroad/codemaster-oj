"use client";

import { StudentProblemFilter } from "./problem-filter";
import { LearnerProblemTable } from "./learner-problem-table";
import { ProblemCatalogSearch } from "./problem-catalog-search";
import { ProblemCatalogCourseFilter, problemCourseFilterKey, type ProblemCatalogResult } from "./problem-catalog-course-filter";
import { problemHref } from "./problem-href";
import { Feedback, State, useData, useMutation } from "./data-state";
import { CatalogPagination, useCatalogPagination } from "@/components/catalog-pagination";
import { useWorkspaceData } from "@/components/workspace-data";
import { useCatalogFilterPreferences, useCatalogFilterUrl } from "@/components/use-catalog-filter-preferences";
import { PageHeader } from "@/components/page-chrome";
import { productionApi, type ProductionProblem } from "@/lib/production-api";
import { useLocale, type AppLocale } from "@/components/locale-context";
import problemStyles from "./problems-page.module.css";

function ui(locale: AppLocale, chinese: string, english: string) { return locale === "en" ? english : chinese; }

interface ProgressProblem extends ProductionProblem { ownProgress?: { status: string; bestScore: number | null; formalCount: number; lastSubmissionId: string | null; lastSubmittedAt: string | null }; }
const studentCourseKeys = [problemCourseFilterKey];
const studentFilterDefaults = { query: "", topic: "", status: "", mode: "", savedOnly: false };
function readStudentFilters(saved: Partial<typeof studentFilterDefaults>) {
  return {
    query: typeof saved.query === "string" ? saved.query : "",
    topic: typeof saved.topic === "string" ? saved.topic : "",
    status: typeof saved.status === "string" ? saved.status : "",
    mode: saved.mode === "function" || saved.mode === "stdio" ? saved.mode : "",
    savedOnly: saved.savedOnly === true,
  };
}
export function StudentProblems({ accountId }: { accountId: string }) {
  const { locale } = useLocale();
  const preferenceKey = `campus-judge:student-problems:v1:${accountId}`;
  const { search, changeUrlFilters, ready: courseReady } = useCatalogFilterUrl(`${preferenceKey}:course`, studentCourseKeys);
  const { filters, changeFilters, ready: filtersReady } = useCatalogFilterPreferences(preferenceKey, studentFilterDefaults, readStudentFilters);
  const { query, topic, status, mode, savedOnly } = filters;
  const courseId = search.get(problemCourseFilterKey)?.toLowerCase() ?? "";
  const catalogQuery = new URLSearchParams({ view: "student-summary", includeCourseFilters: "1", ...(courseId && { courseId }) });
  const problems = useWorkspaceData<ProblemCatalogResult<ProgressProblem>>(courseReady ? `problems?${catalogQuery}` : "");
  const favorites = useData<{ items: string[] }>("problem-favorites");
  const catalogMatches = (problems.data?.courseId ?? "") === courseId;
  const rows = catalogMatches ? problems.data?.items ?? [] : [];
  const action = useMutation();
  const topics = [...new Set(rows.flatMap(p => p.tags ?? []))];
  const problemStatus = (p: ProgressProblem) => p.ownProgress ? p.ownProgress.status === "NotStarted" ? "Not started" : p.ownProgress.status : "Unavailable";
  const visible = rows.filter(p => `${p.id} ${p.title} ${p.bankName ?? ""} ${p.tags?.join(" ") ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (!topic || p.tags?.includes(topic)) && (!status || problemStatus(p) === status) && (!mode || p.mode === mode) && (!savedOnly || favorites.data?.items.includes(p.id)));
  const pagination = useCatalogPagination(visible, JSON.stringify([accountId, courseId, query, topic, status, mode, savedOnly]));
  return <div className={problemStyles.page}>
    <PageHeader title={ui(locale, "题目", "Problems")}/>
    <div className={`${problemStyles.toolbar} flex-wrap`}>
      <ProblemCatalogSearch value={query} onChange={query => changeFilters({ query })} label={ui(locale, "搜索编号、标题、题库或主题", "Search ID, title, bank, or topic")}/>
      <ProblemCatalogCourseFilter courses={problems.data?.courses} value={courseId} onChange={value => changeUrlFilters({ [problemCourseFilterKey]: value })}/>
      <StudentProblemFilter topics={topics} topic={topic} status={status} mode={mode} savedOnly={savedOnly} onTopic={topic => changeFilters({ topic })} onStatus={status => changeFilters({ status })} onMode={mode => changeFilters({ mode })} onSaved={savedOnly => changeFilters({ savedOnly })}/>
    </div>
    <Feedback action={action}/>
    <State data={{ ...problems, loading: !problems.error && (!courseReady || !filtersReady || problems.loading || !catalogMatches), data: catalogMatches ? problems.data : null }}>
      <LearnerProblemTable rows={pagination.rows.map(p => {
        const returnParams = new URLSearchParams({ scope: "school", ...(courseId && { [problemCourseFilterKey]: courseId }) });
        return { id: p.id, title: p.title, bankName: p.bankName, tags: p.tags, difficulty: p.difficulty, status: problemStatus(p),
          href: problemHref({ problemId: p.id, versionId: p.versionId }, { returnTo: `/student/problems?${returnParams}` }) };
      })} bookmark={{ savedIds: favorites.data?.items ?? [], disabled: action.busy || favorites.loading || Boolean(favorites.error),
        onToggle: id => action.run(async () => {
          await productionApi(`problem-favorites/${id}`, { method: "PUT", body: { favorite: !favorites.data?.items.includes(id) } });
          favorites.reload();
        }),
      }} empty={rows.length || courseId || query || topic || status || mode || savedOnly
        ? ui(locale, "没有匹配的题目，请调整搜索或筛选条件。", "No matching problems. Try another search or filter.")
        : ui(locale, "学校尚未发布可练习题目。", "Your school has not published any problems yet.")}/>
      <CatalogPagination {...pagination}/>
    </State>
    {favorites.error && <p role="alert" className="text-sm text-destructive">{ui(locale, "收藏加载失败：", "Could not load bookmarks: ")}{favorites.error}</p>}
    <p className={problemStyles.count}>{ui(locale, `显示 ${visible.length} / ${rows.length} 道题`, `Showing ${visible.length} of ${rows.length} problems`)}</p>
  </div>;
}
