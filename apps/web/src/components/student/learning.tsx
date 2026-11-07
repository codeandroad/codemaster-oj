"use client";

import { CoursePaper4Practice } from "./course-paper4-practice";
import { useCourseProgressRefresh } from "./course-progress-refresh";
import type { CoursePaper4Link } from "@/components/course-paper4";
import { coursePaper4Progress } from "@/components/paper4/paper4-learning-navigation";
import { CourseAccessSummary, type CourseAccessMetadata } from "@/components/course-access";
import {courseDifficulties} from "@/components/learning-course";
import {LearningCourseList,LearningCourseRow,learningCourseTitleClass} from "./learning-course-list";
import { CourseCatalogSearch, useCourseCatalogQuery } from "./learning-course-search";
import { filterCourseCatalog } from "./learning-course-search-model";
import { AppLink } from "@/components/navigation";
import { LearningCourseReader } from "./learning-course-reader";

import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-chrome";
import { productionApi } from "@/lib/production-api";
import { State, useData } from "./shared";
import {useLocale,type AppLocale} from "@/components/locale-context";

function ui(locale:AppLocale,zh:string,en:string){return locale==="en"?en:zh;}


export interface LearningChapter {
  id: string; title: string; content: string; position: number; completed: boolean;
  objective?: string; checkpoint?: string; checkpointAnswer?: string; estimatedMinutes?: number;taskCount?:number;completedTasks?:number;
  paper4Links?: CoursePaper4Link[];
  problems: { problemId: string; title: string; versionId: string;completed?:boolean }[];
}
export interface LearningPath extends CourseAccessMetadata { id: string; title: string; description: string; category: string; published: boolean; chapterCount: number; completedChapters: number; canEdit: boolean;difficulty?:keyof typeof courseDifficulties;coverKey?:string;taskCount?:number;completedTasks?:number; chapters?: LearningChapter[]; assignments?: { id: string; title: string; dueAt: string }[]; }
export function StudentLearningList(){
 const {locale}=useLocale();
 const paths=useData<{items:LearningPath[]}>("learning-paths");
 const [query, setQuery] = useCourseCatalogQuery();
 const visible = filterCourseCatalog(paths.data?.items ?? [], query);
 useCourseProgressRefresh(paths);
 return <>
  <PageHeader title={ui(locale,"课程","Courses")} description={ui(locale,"按章节阅读、练习与复盘；已读和判题通过分别记录。","Read, practice, and review each chapter. Reading and accepted submissions are tracked separately.")}/>
  <CourseCatalogSearch query={query} onSearch={setQuery}/>
  <State data={paths}>
   <div className="mt-3"><LearningCourseList empty={!visible.length ? (query
     ? ui(locale,"没有符合搜索条件的课程。","No courses match this search.")
     : ui(locale,"暂无已发布课程","No published courses yet")) : undefined}>
    {visible.map(path=><LearningCourseRow key={path.id} course={{...path,difficulty:path.difficulty??"beginner"}}
      title={<AppLink href={`/student/learning-paths/${path.id}`} className={learningCourseTitleClass}>{path.title}</AppLink>}
      reading={{value:path.completedChapters,total:path.chapterCount}}
      practice={{value:path.completedTasks??0,total:path.taskCount??0}} />)}
   </LearningCourseList></div>
  </State>
 </>;
}
export function StudentLearningDetail({ id, chapterId }: { id: string; chapterId?: string }) {
  const { locale } = useLocale();
  const path = useData<LearningPath>(`learning-paths/${id}`), search = useSearchParams();
  const selected = chapterId ?? search.get("chapter");
  const pending = path.data?.chapters?.some(item => item.paper4Links?.some(link => coursePaper4Progress(link).pending > 0)) ?? false;
  useCourseProgressRefresh({ ...path, pending });
  const chapterHref = (chapter: string) => `/student/learning-paths/${id}/chapters/${chapter}`;
  return <State data={path}>{path.data && <LearningCourseReader
    course={{ ...path.data, taskCount: path.data.taskCount ?? 0, completedTasks: path.data.completedTasks ?? 0 }}
    chapters={(path.data.chapters ?? []).map(chapter => ({ ...chapter, problems: chapter.problems.map(problem => ({
      id: problem.problemId, title: problem.title, completed: problem.completed,
      href: `/student/problems/${problem.problemId}?${new URLSearchParams({ versionId: problem.versionId, learningPathId: id, chapterId: chapter.id, returnTo: chapterHref(chapter.id), sourceLabel: chapter.title })}`,
    })) }))}
    selectedChapterId={selected} chapterHref={chapterHref} scrollKey={id}
    metadata={<CourseAccessSummary course={path.data} showAuthor/>}
    relatedActivities={<CourseAssignmentLinks items={path.data.assignments ?? []} locale={locale}/>}
    extraPractice={chapterId => {
      const chapter = path.data?.chapters?.find(item => item.id === chapterId);
      return chapter?.paper4Links?.length ? <CoursePaper4Practice links={chapter.paper4Links} pathId={id} chapterId={chapterId}/> : null;
    }}
    onRead={async chapterId => {
      await productionApi(`chapters/${chapterId}/progress`, { method: "POST", body: { completed: true } });
      path.reload();
    }}
  />}</State>;
}
function CourseAssignmentLinks({ items, locale }: { items: NonNullable<LearningPath["assignments"]>; locale: AppLocale }) {
 if (!items.length) return null;
 return <section className="mt-5 border border-border bg-surface panel-shadow" aria-label={ui(locale,"相关作业","Related assignments")}>
  <h2 className="border-b border-border px-4 py-3 font-semibold">{ui(locale,"相关作业","Related assignments")}</h2>
  <div className="divide-y divide-border">{items.map(item => <AppLink key={item.id} href={`/student/assignments/${item.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-surface-subtle focus-visible:bg-surface-subtle"><span className="font-semibold text-primary">{item.title}</span><span className="text-muted-foreground">{ui(locale,"截止","Due")} {new Intl.DateTimeFormat(locale==="en"?"en-US":"zh-CN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Shanghai"}).format(new Date(item.dueAt))}</span></AppLink>)}</div>
 </section>;
}
