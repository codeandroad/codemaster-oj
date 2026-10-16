"use client";

import {LearningCover,LearningProgressSummary,courseDifficulties} from "@/components/learning-course";
import { AppLink } from "@/components/navigation";
import { chapterDirectoryTitle } from "@/lib/learning-chapter-title";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, ChevronDown } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-chrome";
import { productionApi } from "@/lib/production-api";
import { Back, Empty, Feedback, LessonContent, State, panel, useData, useMutation } from "./shared";
import {useLocale,type AppLocale} from "@/components/locale-context";

function ui(locale:AppLocale,zh:string,en:string){return locale==="en"?en:zh;}
function difficulty(locale:AppLocale,value:keyof typeof courseDifficulties){return locale==="en"?({beginner:"Beginner",intermediate:"Intermediate",advanced:"Advanced"})[value]:courseDifficulties[value];}

export interface LearningChapter {
  id: string; title: string; content: string; position: number; completed: boolean;
  objective?: string; checkpoint?: string; checkpointAnswer?: string; estimatedMinutes?: number;taskCount?:number;completedTasks?:number;
  problems: { problemId: string; title: string; versionId: string;completed?:boolean }[];
}
export interface LearningPath { id: string; title: string; description: string; category: string; published: boolean; chapterCount: number; completedChapters: number; canEdit: boolean;difficulty?:keyof typeof courseDifficulties;coverKey?:string;taskCount?:number;completedTasks?:number; chapters?: LearningChapter[]; assignments?: { id: string; title: string; dueAt: string }[]; }
export function StudentLearningList(){
 const {locale}=useLocale();
 const paths=useData<{items:LearningPath[]}>("learning-paths");
 return <>
  <PageHeader title={ui(locale,"课程","Courses")} description={ui(locale,"按章节阅读、练习与复盘；已读和判题通过分别记录。","Read, practice, and review each chapter. Reading and accepted submissions are tracked separately.")}/>
  <State data={paths} empty={paths.data&&!paths.data.items.length?ui(locale,"暂无已发布课程","No published courses yet"):undefined}>
   <ul className="mt-5 divide-y divide-border border border-border bg-surface panel-shadow">
    {paths.data?.items.map(path=>{
     const progress=[
      {label:ui(locale,"章节阅读","Chapters read"),value:path.completedChapters,total:path.chapterCount,empty:ui(locale,"暂无章节","No chapters")},
      {label:ui(locale,"练习完成","Practice completed"),value:path.completedTasks??0,total:path.taskCount??0,empty:ui(locale,"暂无练习","No practice")},
     ];
     return <li key={path.id} className="grid min-w-0 gap-x-4 gap-y-3 px-4 py-4 transition-colors hover:bg-surface-subtle sm:grid-cols-[88px_minmax(0,1fr)] lg:grid-cols-[88px_minmax(0,1fr)_240px_auto] lg:items-center">
      <div aria-hidden="true" className="hidden h-[50px] w-[88px] overflow-hidden rounded border border-border bg-surface-subtle sm:block"><LearningCover coverKey={path.coverKey}/></div>
      <div className="min-w-0">
       <p className="text-xs text-muted-foreground">{path.category} · {difficulty(locale,path.difficulty??"beginner")}</p>
       <h2 className="mt-1 truncate text-base font-semibold"><AppLink href={`/student/learning-paths/${path.id}`} className="text-primary hover:underline focus-visible:underline">{path.title}</AppLink></h2>
       {path.description&&<p className="mt-1 line-clamp-2 text-sm text-muted-foreground lg:line-clamp-1">{path.description}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:col-start-2 lg:col-auto" role="group" aria-label={ui(locale,"课程进度","Course progress")}>
       {progress.map(item=><div key={item.label} className="min-w-0 text-xs"><div className="flex items-center justify-between gap-2"><span className="truncate text-muted-foreground">{item.label}</span><span className="shrink-0 font-medium">{item.total?`${item.value}/${item.total}`:item.empty}</span></div><progress aria-label={item.label} max={Math.max(1,item.total)} value={Math.min(item.value,item.total)} className="mt-2 h-1.5 w-full" style={{accentColor:"var(--primary)"}}/></div>)}
      </div>
      <AppLink href={`/student/learning-paths/${path.id}`} className={`${buttonVariants({variant:"secondary",size:"sm"})} w-fit sm:col-start-2 lg:col-auto`}>{ui(locale,"进入课程","Open course")}<ArrowRight size={15}/></AppLink>
     </li>;
    })}
   </ul>
  </State>
 </>;
}
export function StudentLearningDetail({ id, chapterId }: { id: string; chapterId?: string }) {
  const {locale}=useLocale();
  const desktopDirectoryRef = useRef<HTMLDivElement>(null);
  const path = useData<LearningPath>(`learning-paths/${id}`), search = useSearchParams(), selected = chapterId ?? search.get("chapter");
  const chapter = path.data?.chapters?.find(c => c.id === selected) ?? (!selected ? path.data?.chapters?.find(c => !c.completed) ?? path.data?.chapters?.[0] : undefined);
  const chapterIndex = chapter ? path.data?.chapters?.findIndex(c => c.id === chapter.id) ?? -1 : -1;
  const nextChapterId = chapterIndex >= 0 ? path.data?.chapters?.[chapterIndex + 1]?.id : undefined;
  useEffect(()=>{if(!chapter)return;try{const value=sessionStorage.getItem(`learning-scroll:${id}:${chapter.id}`);if(value!==null){sessionStorage.removeItem(`learning-scroll:${id}:${chapter.id}`);const frame=requestAnimationFrame(()=>window.scrollTo(0,Number(value)||0));return ()=>cancelAnimationFrame(frame);}}catch{}},[id,chapter]);
  useEffect(()=>{
    const container=desktopDirectoryRef.current;
    if(!container?.clientHeight)return;
    const active=container.querySelector<HTMLElement>('[aria-current="page"]');
    if(!active)return;
    const activeRect=active.getBoundingClientRect(),containerRect=container.getBoundingClientRect();
    const top=activeRect.top-containerRect.top;
    if(top<0||top+activeRect.height>container.clientHeight)
      container.scrollTop+=top-(container.clientHeight-activeRect.height)/2;
  },[chapter?.id]);
  const directory = <nav className="p-2" aria-label={ui(locale,"章节目录","Chapter directory")}>{path.data?.chapters?.map((c, index) => <AppLink key={c.id} href={`/student/learning-paths/${id}/chapters/${c.id}`} aria-current={c.id === chapter?.id ? "page" : undefined} className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${c.id === chapter?.id ? "bg-accent font-semibold text-primary" : "text-muted-foreground hover:bg-surface-subtle"}`}><span>{chapterDirectoryTitle(c.title,index)}</span><span className="shrink-0">{c.completed ? "✓" : c.id === chapter?.id ? ui(locale,"当前","Current") : ""}</span></AppLink>)}</nav>;
  return <><Back href="/student/learning-paths">{ui(locale,"课程","Courses")}</Back><State data={path}>{path.data && <><PageHeader className="course-detail-header" title={path.data.title} description={path.data.description}/><div className="mt-4"><LearningProgressSummary read={path.data.completedChapters} totalChapters={path.data.chapterCount} done={path.data.completedTasks??0} totalTasks={path.data.taskCount??0}/></div><CourseAssignmentLinks items={path.data.assignments??[]} locale={locale}/><div className="mt-5 grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]"><aside className="self-start border border-border bg-surface panel-shadow md:sticky md:top-4"><details className="md:hidden"><summary className="cursor-pointer px-4 py-3 font-semibold">{ui(locale,"章节目录","Chapter directory")} · {chapter ? `${chapter.position+1}/${path.data.chapterCount}` : path.data.chapterCount}<ChevronDown className="float-right" size={16}/></summary><div className="max-h-[60dvh] overflow-y-auto">{directory}</div></details><div ref={desktopDirectoryRef} className="hidden md:block md:max-h-[calc(100dvh-2rem)] md:overflow-y-auto md:overscroll-contain">{directory}</div></aside><main className="min-w-0">{chapter ? <ChapterLesson key={chapter.id} chapter={chapter} nextChapterId={nextChapterId} pathId={id} onSaved={path.reload}/> : <Empty title={selected ? ui(locale,"章节不存在","Chapter not found") : ui(locale,"暂无章节","No chapters available")} description={ui(locale,"从章节目录选择已发布章节；老师发布内容后即可阅读。","Choose a published chapter from the directory. You can read it after your teacher publishes it.")}/>}</main></div></>}</State></>;
}
function CourseAssignmentLinks({ items, locale }: { items: NonNullable<LearningPath["assignments"]>; locale: AppLocale }) {
 if (!items.length) return null;
 return <section className="mt-5 border border-border bg-surface panel-shadow" aria-label={ui(locale,"相关作业","Related assignments")}>
  <h2 className="border-b border-border px-4 py-3 font-semibold">{ui(locale,"相关作业","Related assignments")}</h2>
  <div className="divide-y divide-border">{items.map(item => <AppLink key={item.id} href={`/student/assignments/${item.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-surface-subtle focus-visible:bg-surface-subtle"><span className="font-semibold text-primary">{item.title}</span><span className="text-muted-foreground">{ui(locale,"截止","Due")} {new Intl.DateTimeFormat(locale==="en"?"en-US":"zh-CN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Shanghai"}).format(new Date(item.dueAt))}</span></AppLink>)}</div>
 </section>;
}
function ChapterLesson({chapter,nextChapterId,pathId,onSaved}:{chapter:LearningChapter;nextChapterId?:string;pathId:string;onSaved:()=>void}) {
 const {locale}=useLocale();
 const router=useRouter();
 const action=useMutation();
 return <article className="space-y-5" data-od-id="learning-chapter-content">
 <section className={`${panel} p-5 sm:p-7`}><h1 className="text-2xl font-bold">{chapter.title}</h1>{chapter.objective&&<div className="mt-4 border-b border-border pb-5"><h2 className="text-sm font-semibold">{ui(locale,"学习目标","Learning objective")}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{chapter.objective}</p></div>}<div className="mt-6"><LessonContent content={chapter.content}/></div></section>
 {chapter.problems.length>0&&<section className={`${panel} p-5 sm:p-7`}><h2 className="text-lg font-bold">{ui(locale,"配套练习","Practice problems")}</h2>{chapter.problems.map(p=>{
  const href=`/student/problems/${p.problemId}?${new URLSearchParams({versionId:p.versionId,learningPathId:pathId,chapterId:chapter.id,returnTo:`/student/learning-paths/${pathId}/chapters/${chapter.id}`,sourceLabel:chapter.title})}`;
  const saveScroll=()=>{try{sessionStorage.setItem(`learning-scroll:${pathId}:${chapter.id}`,String(window.scrollY));}catch{}};
  return <div key={p.problemId} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><div><h3 className="font-semibold"><AppLink href={href} className="text-primary hover:underline focus-visible:underline" onClick={saveScroll}>{p.title}</AppLink></h3>{p.completed?<p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-sm font-semibold text-success"><CheckCircle2 size={15} aria-hidden="true"/>{ui(locale,"已通过正式判题","Accepted in formal judging")}</p>:<p className="mt-1 text-xs text-muted-foreground">{ui(locale,"题库中的已发布版本","Published problem version")}</p>}</div><AppLink className={buttonVariants({variant:"secondary"})} href={href} onClick={saveScroll}>{p.completed?ui(locale,"再次练习","Practice again"):ui(locale,"开始练习","Start practice")}</AppLink></div>;
 })}</section>}
 <section className={`${panel} flex flex-wrap items-center justify-between gap-4 p-5`}><div><p className="font-semibold">{chapter.completed?ui(locale,"本章已读","Chapter read"):ui(locale,"完成本章学习","Complete this chapter")}</p><p className="mt-1 text-xs text-muted-foreground">{ui(locale,"阅读进度独立保存，不代表练习通过或计入成绩。","Reading progress is saved separately. It does not mean practice was accepted or counted toward a grade.")}</p></div><Button variant={chapter.completed?"secondary":"primary"} disabled={action.busy||(chapter.completed&&!nextChapterId)} onClick={()=>action.run(async()=>{
  if(!chapter.completed){
   await productionApi(`chapters/${chapter.id}/progress`,{method:"POST",body:{completed:true}});
   onSaved();
  }
  if(nextChapterId) router.push(`/student/learning-paths/${pathId}/chapters/${nextChapterId}`);
  else action.success(ui(locale,"本章已标记已读。","Chapter marked as read."));
 })}>{nextChapterId?<>{ui(locale,"下一章","Next chapter")}<ArrowRight size={15}/></>:chapter.completed?<><CheckCircle2 size={15}/>{ui(locale,"本章已读","Chapter read")}</>:ui(locale,"完成本章","Finish chapter")}</Button><Feedback action={action}/></section>
 </article>;
}
