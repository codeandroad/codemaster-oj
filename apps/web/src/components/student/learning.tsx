"use client";

import { preserveAcslLearningContext } from "@/components/course-acsl-navigation";
import { useCourseLanguage } from "@/components/course-language";
import { courseLanguageHref, localizedCourse, type CourseLocalizations, type ChapterLocalizations } from "@/components/course-localization";
import type { CourseAcslLink } from "@/components/course-acsl";
import { CourseAcslPractice } from "./course-acsl-practice";
import { CoursePracticeReturn } from "./course-practice-return";
import { CoursePaper4Practice } from "./course-paper4-practice";
import { useCourseProgressRefresh } from "./course-progress-refresh";
import type { CoursePaper4Link } from "@/components/course-paper4";
import { coursePaper4Progress } from "@/components/paper4/paper4-learning-navigation";
import { CourseAccessSummary, courseSourceName, type CourseAccessMetadata } from "@/components/course-access";
import {courseDifficulties} from "@/components/learning-course";
import {LearningCourseList,LearningCourseRow,learningCourseTitleClass} from "./learning-course-list";
import { CourseCatalogSearch, useCourseCatalogQuery } from "./learning-course-search";
import { filterCourseCatalog } from "./learning-course-search-model";
import { AppLink } from "@/components/navigation";
import { LearningCourseReader } from "./learning-course-reader";

import { Check, ChevronDown, ClipboardList } from "lucide-react";
import { useEffect } from "react";
import { canonicalCourseHref, type CourseSection } from "@/components/course-sections";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { productionApi } from "@/lib/production-api";
import { State, useData } from "./shared";
import {useLocale,type AppLocale} from "@/components/locale-context";

function ui(locale:AppLocale,zh:string,en:string){return locale==="en"?en:zh;}


export interface LearningChapter {
  sectionKey?: string | null;
  id: string; title: string; content: string; position: number; completed: boolean;
  objective?: string; checkpoint?: string; checkpointAnswer?: string; estimatedMinutes?: number;taskCount?:number;completedTasks?:number;
  paper4Links?: CoursePaper4Link[];
  localizations?: ChapterLocalizations;
  acslLinks?: CourseAcslLink[];
  problems: { problemId: string; title: string; versionId: string;completed?:boolean }[];
}
type CourseAssignment = {
  id: string;
  title: string;
  dueAt: string;
  completed?: boolean;
  completedProblems?: number;
  totalProblems?: number;
};

export interface LearningPath extends CourseAccessMetadata { sections?: CourseSection[]; redirectedFromCourseId?: string; redirectedChapterId?: string; localizations?: CourseLocalizations; id: string; title: string; description: string; category: string; published: boolean; chapterCount: number; completedChapters: number; canEdit: boolean;difficulty?:keyof typeof courseDifficulties;coverKey?:string;taskCount?:number;completedTasks?:number; chapters?: LearningChapter[]; assignments?: CourseAssignment[]; }
export function StudentLearningList(){
 const {locale}=useLocale();
 const {language}=useCourseLanguage();
 const paths=useData<{items:LearningPath[]}>("learning-paths");
 const [query, setQuery] = useCourseCatalogQuery();
 const visible = filterCourseCatalog((paths.data?.items ?? []).map(path => localizedCourse(path, language)), query);
 useCourseProgressRefresh(paths);
 return <>
  <PageHeader title={ui(locale,"课程","Courses")} description={ui(locale,"按章节阅读、练习与复盘；已读和判题通过分别记录。","Read, practice, and review each chapter. Reading and accepted submissions are tracked separately.")}/>
  <CourseCatalogSearch query={query} onSearch={setQuery}/>
  <State data={paths}>
   <div className="mt-3"><LearningCourseList empty={!visible.length ? (query
     ? ui(locale,"没有符合搜索条件的课程。","No courses match this search.")
     : ui(locale,"暂无已发布课程","No published courses yet")) : undefined}>
    {visible.map(path=><LearningCourseRow key={path.id} course={{...path,difficulty:path.difficulty??"beginner"}}
      source={courseSourceName(path)}
      title={<AppLink href={courseLanguageHref(`/student/learning-paths/${path.id}`, language)} className={learningCourseTitleClass}>{path.title}</AppLink>}
      reading={{value:path.completedChapters,total:path.chapterCount}}
      practice={{value:path.completedTasks??0,total:path.taskCount??0}} />)}
   </LearningCourseList></div>
  </State>
 </>;
}
export function StudentLearningDetail({ id, chapterId }: { id: string; chapterId?: string }) {
  const { locale } = useLocale();
  const { language } = useCourseLanguage();
  const path = useData<LearningPath>(`learning-paths/${id}`), search = useSearchParams();
  const router = useRouter(), canonicalId = path.data?.id ?? id;
  const selected = chapterId ?? search.get("chapter") ?? path.data?.redirectedChapterId;
  useEffect(() => {
    if (!path.data?.redirectedFromCourseId) return;
    const href = canonicalCourseHref(`${window.location.pathname}${window.location.search}${window.location.hash}`, id, path.data.id);
    if (!href) return;
    const target = new URL(href, window.location.origin);
    if (!chapterId && !target.searchParams.has("chapter") && path.data.redirectedChapterId) target.pathname = `/student/learning-paths/${path.data.id}/chapters/${path.data.redirectedChapterId}`;
    router.replace(`${target.pathname}${target.search}${target.hash}`);
  }, [id, chapterId, path.data, router]);
  const pending = path.data?.chapters?.some(item => item.paper4Links?.some(link => coursePaper4Progress(link).pending > 0)) ?? false;
  useCourseProgressRefresh({ ...path, pending });
  const chapterHref = (chapter: string) => preserveAcslLearningContext(courseLanguageHref(`/student/learning-paths/${canonicalId}/chapters/${chapter}`, language), search, "00000000-0000-4000-8000-000000000052") ?? courseLanguageHref(`/student/learning-paths/${canonicalId}/chapters/${chapter}`, language);
  return <State data={path}>{path.data && <LearningCourseReader
    course={{ ...path.data, taskCount: path.data.taskCount ?? 0, completedTasks: path.data.completedTasks ?? 0 }}
    chapters={(path.data.chapters ?? []).map(chapter => ({ ...chapter, problems: chapter.problems.map(problem => ({
      id: problem.problemId, title: problem.title, completed: problem.completed,
      href: `/student/problems/${problem.problemId}?${new URLSearchParams({ versionId: problem.versionId, learningPathId: canonicalId, chapterId: chapter.id, returnTo: chapterHref(chapter.id), sourceLabel: chapter.title })}`,
    })) }))}
    selectedChapterId={selected} chapterHref={chapterHref} scrollKey={canonicalId}
    metadata={<CourseAccessSummary course={path.data} showAuthor/>}
    relatedActivities={<><CoursePracticeReturn schoolId="00000000-0000-4000-8000-000000000052"/><CourseAssignmentLinks key={canonicalId} items={path.data.assignments ?? []} locale={locale}/></>}
    extraPractice={chapterId => {
      const chapter = path.data?.chapters?.find(item => item.id === chapterId);
      return chapter && (chapter.paper4Links?.length || chapter.acslLinks?.length) ? <>{Boolean(chapter.paper4Links?.length) && <CoursePaper4Practice links={chapter.paper4Links ?? []} pathId={canonicalId} chapterId={chapterId}/>}<CourseAcslPractice links={chapter.acslLinks ?? []} schoolId="00000000-0000-4000-8000-000000000052" legacy courseHref={chapterHref(chapterId)}/></> : null;
    }}
    onRead={async chapterId => {
      await productionApi(`chapters/${chapterId}/progress`, { method: "POST", body: { completed: true } });
      path.reload();
    }}
  />}</State>;
}
function CourseAssignmentLinks({ items, locale }: { items: CourseAssignment[]; locale: AppLocale }) {
  if (!items.length) return null;

  const title = ui(locale, "相关作业", "Related assignments");
  const completed = items.filter(item => item.completed).length;
  const hasCompletion = items.every(item => item.completed !== undefined);
  const summary = hasCompletion
    ? ui(locale, `已完成 ${completed}/${items.length}`, `${completed}/${items.length} completed`)
    : ui(locale, `共 ${items.length} 项`, `${items.length} total`);
  const dueDate = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai",
  });

  return <details className="group mt-5 border border-border bg-surface panel-shadow" data-od-id="course-related-assignments">
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm hover:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:gap-3 sm:px-4 [&::-webkit-details-marker]:hidden">
      <ClipboardList size={17} aria-hidden="true" className="shrink-0 text-primary"/>
      <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
      <span className={`shrink-0 whitespace-nowrap text-xs font-medium tabular-nums ${completed === items.length ? "text-success" : "text-muted-foreground"}`}>{summary}</span>
      <ChevronDown size={17} aria-hidden="true" className="shrink-0 text-muted-foreground group-open:rotate-180"/>
    </summary>
    <ul className="max-h-[min(14rem,40dvh)] divide-y divide-border overflow-y-auto border-t border-border" data-od-id="course-assignment-links">
      {items.map(item => <li key={item.id}>
        <AppLink href={`/student/assignments/${item.id}`} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_auto_12rem] sm:px-4">
          <span className="min-w-0 font-semibold text-primary [overflow-wrap:anywhere]">{item.title}</span>
          <span className="flex flex-wrap items-center justify-end gap-2">
            {item.completed === true && <StatusPill status="Completed" icon={<Check size={13}/>}/>}
            {item.completed === false && <span className="whitespace-nowrap text-xs text-muted-foreground">{ui(locale, "未完成", "Incomplete")}</span>}
            {!item.completed && item.completedProblems !== undefined && (item.totalProblems ?? 0) > 0 &&
              <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:inline">
                {ui(locale, `${item.completedProblems}/${item.totalProblems} 题已通过`, `${item.completedProblems}/${item.totalProblems} passed`)}
              </span>}
          </span>
          <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:text-right">
            {ui(locale, "截止", "Due")} <time dateTime={item.dueAt}>{dueDate.format(new Date(item.dueAt))}</time>
          </span>
        </AppLink>
      </li>)}
    </ul>
  </details>;
}
