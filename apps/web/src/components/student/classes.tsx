"use client";

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ChevronRight, ClipboardList, FileText, Users } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { PageHeader } from "@/components/page-chrome";
import { useLocale } from "@/components/locale-context";
import { buttonVariants } from "@/components/ui/button";
import { Back, Empty, LessonContent, State, useData } from "./shared";

interface StudentClassSummary {
  id: string;
  name: string;
  description?: string;
  memberCount?: number;
  studentIds?: string[];
}
interface ClassCourse { id: string; title: string; description?: string; }
interface LinkedCourse { coursePathId?: string | null; courseTitle?: string | null; }
interface ClassResource {
  id: string;
  title: string;
  type: string;
  content: string;
  pathId?: string | null;
  chapterId?: string | null;
  updatedAt?: string | null;
}
interface StudentClassDetail extends StudentClassSummary {
  teachers: { name: string }[];
  assignments: (LinkedCourse & { id: string; title: string; dueAt: string })[];
  timedPractices: (LinkedCourse & { id: string; title: string; startsAt: string; endsAt: string; durationMinutes: number })[];
  paper4Activities: { id: string; title: string; activityKind: "practice" | "exam"; startsAt: string | null; endsAt: string | null }[];
  courses: ClassCourse[];
  resources: ClassResource[];
}
const surface = "overflow-hidden rounded-lg border border-border bg-surface panel-shadow";
const date = (value: string | null | undefined, locale: "zh" | "en") => value ? new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";

export function StudentClasses() {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const classes = useData<{ items: StudentClassSummary[] }>("classes");
  return <>
    <PageHeader title={tx("我的班级", "My classes")}/>
    <State data={classes}>{classes.data?.items.length ? <div className={`${surface} mt-5`}>
      {classes.data.items.map(item => <AppLink key={item.id} href={`/student/classes/${item.id}`} className="flex min-h-20 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-info-soft text-primary"><Users size={18} aria-hidden="true"/></span>
        <span className="min-w-0 flex-1"><strong className="block text-base text-primary">{item.name}</strong>{item.description && <span className="mt-1 block line-clamp-1 text-sm text-muted-foreground">{item.description}</span>}<span className="mt-1 block text-xs text-muted-foreground">{tx(`${item.memberCount ?? item.studentIds?.length ?? 0} 名学生`, `${item.memberCount ?? item.studentIds?.length ?? 0} students`)}</span></span>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted-foreground"/>
      </AppLink>)}
    </div> : <section className="mt-5 rounded-lg border border-border bg-surface p-6 text-center"><Users size={28} aria-hidden="true" className="mx-auto text-muted-foreground"/><h2 className="mt-3 font-semibold">{tx("你尚未加入班级", "You have not joined a class yet")}</h2><p className="mt-2 text-sm text-muted-foreground">{tx("仍可自由练习，也可完成老师单独布置给你的任务。", "You can still practise and complete work assigned directly to you.")}</p><div className="mt-4 flex flex-wrap justify-center gap-2"><AppLink href="/student/problems" className={buttonVariants({ variant: "secondary" })}>{tx("题库练习", "Problem practice")}</AppLink><AppLink href="/student/paper4" className={buttonVariants({ variant: "secondary" })}>{tx("Paper 4 自由练习", "Paper 4 free practice")}</AppLink><AppLink href="/student/assignments" className={buttonVariants()}>{tx("我的作业", "My assignments")}</AppLink></div></section>}</State>
  </>;
}

export function StudentClass({ id }: { id: string }) {
  const { locale } = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const resource = useData<StudentClassDetail>(`classes/${encodeURIComponent(id)}`);
  const tab = search.get("tab") === "courses" ? "courses" : search.get("tab") === "resources" ? "resources" : "tasks";
  const data = resource.data;
  const taskCount = (data?.assignments.length ?? 0) + (data?.timedPractices.length ?? 0) + (data?.paper4Activities.length ?? 0);
  return <>
    <Back href="/student/classes">{tx("我的班级", "My classes")}</Back>
    <State data={resource}>{data && <>
      <PageHeader title={data.name} description={data.description}/>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground"><span>{tx(`${data.memberCount ?? 0} 名学生`, `${data.memberCount ?? 0} students`)}</span>{data.teachers.length > 0 && <span>{tx("教师：", "Teachers: ")}{data.teachers.map(teacher => teacher.name).join(" / ")}</span>}</div>
      <nav aria-label={tx("班级内容", "Class content")} className="mt-4 flex border-b border-border">
        {([{ key: "tasks", label: tx("任务", "Tasks"), count: taskCount }, { key: "courses", label: tx("课程", "Courses"), count: data.courses.length }, { key: "resources", label: tx("资料", "Resources"), count: data.resources.length }] as const).map(item => <button key={item.key} type="button" aria-pressed={tab === item.key} onClick={() => router.replace(`/student/classes/${encodeURIComponent(id)}${item.key === "tasks" ? "" : `?tab=${item.key}`}`)} className={`min-h-11 border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${tab === item.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{item.label}<span className="ml-1.5 text-xs tabular-nums">{item.count}</span></button>)}
      </nav>
      {tab === "tasks" && (taskCount ? <div className={`${surface} mt-4`}>
        {data.assignments.map(task => <ClassTaskRow key={`assignment:${task.id}`} href={`/student/assignments/${task.id}`} title={task.title} kind={tx("作业", "Assignment")} timing={`${tx("截止 ", "Due ")}${date(task.dueAt, locale)}`} course={task}/>)}
        {data.timedPractices.map(task => <ClassTaskRow key={`timed:${task.id}`} href={`/student/timed-practice/${task.id}`} title={task.title} kind={tx("限时训练", "Timed practice")} timing={`${date(task.startsAt, locale)} – ${date(task.endsAt, locale)} · ${task.durationMinutes} ${tx("分钟", "min")}`} course={task}/>)}
        {data.paper4Activities.map(task => <ClassTaskRow key={`paper4:${task.id}`} href={`/student/paper4/${task.id}`} title={task.title} kind={task.activityKind === "exam" ? tx("Paper 4 模拟考试", "Paper 4 mock exam") : tx("Paper 4 班级练习", "Paper 4 class practice")} timing={task.startsAt || task.endsAt ? `${task.startsAt ? date(task.startsAt, locale) : tx("即日起", "Available now")} – ${task.endsAt ? date(task.endsAt, locale) : tx("无截止时间", "No deadline")}` : tx("不限时间", "No time limit")}/>)}
      </div> : <Empty title={tx("暂无布置给你的班级任务", "No class tasks assigned to you")}/>)}
      {tab === "courses" && (data.courses.length ? <div className={`${surface} mt-4`}>{data.courses.map(course => <AppLink key={course.id} href={`/student/learning-paths/${course.id}`} className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary"><BookOpen size={18} aria-hidden="true" className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><strong className="block text-sm text-primary">{course.title}</strong>{course.description && <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{course.description}</span>}</span><ChevronRight size={17} aria-hidden="true" className="shrink-0 text-muted-foreground"/></AppLink>)}</div> : <Empty title={tx("暂无关联课程", "No linked courses")}/>)}
      {tab === "resources" && (data.resources.length ? <div className={`${surface} mt-4`}>{data.resources.map(item => <ClassResourceRow key={item.id} resource={item} linkedCourse={data.courses.some(course => course.id === item.pathId)}/>)}</div> : <Empty title={tx("暂无班级资料", "No class resources")}/>)}
    </>}</State>
  </>;
}

function ClassTaskRow({ href, title, kind, timing, course }: { href: string; title: string; kind: string; timing: string; course?: LinkedCourse }) {
  const { locale } = useLocale();
  return <div className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:px-5"><ClipboardList size={18} aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground"/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><AppLink href={href} className="text-sm font-semibold text-primary hover:underline focus-visible:underline">{title}</AppLink><span className="rounded bg-surface-subtle px-2 py-0.5 text-xs text-muted-foreground">{kind}</span></div><p className="mt-1 text-xs text-muted-foreground">{timing}</p>{course?.coursePathId && course.courseTitle && <AppLink href={`/student/learning-paths/${course.coursePathId}`} className="mt-1 inline-block text-xs text-primary hover:underline focus-visible:underline">{locale === "en" ? "Course: " : "课程："}{course.courseTitle}</AppLink>}</div><AppLink href={href} aria-label={locale === "en" ? `Open ${title}` : `打开${title}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-subtle hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"><ChevronRight size={17} aria-hidden="true"/></AppLink></div>;
}

function ClassResourceRow({ resource, linkedCourse }: { resource: ClassResource; linkedCourse: boolean }) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const resourceUrl = resource.type === "link" && /^https?:\/\/\S+$/i.test(resource.content.trim()) ? resource.content.trim() : null;
  let content: ReactNode = <LessonContent content={resource.content}/>;
  if (resourceUrl) content = <a href={resourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">{resourceUrl}</a>;
  return <section className="border-b border-border last:border-b-0"><button type="button" aria-expanded={open} aria-controls={`class-resource-${resource.id}`} onClick={() => setOpen(value => !value)} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary"><FileText size={18} aria-hidden="true" className="shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><strong className="block text-sm text-primary">{resource.title}</strong>{resource.updatedAt && <span className="mt-1 block text-xs text-muted-foreground">{tx("更新于 ", "Updated ")}{date(resource.updatedAt, locale)}</span>}</span><ChevronRight size={17} aria-hidden="true" className={`shrink-0 text-muted-foreground ${open ? "rotate-90" : ""}`}/></button>{open && <div id={`class-resource-${resource.id}`} className="border-t border-border px-5 py-4 text-sm">{content}{linkedCourse && resource.pathId && <AppLink href={`/student/learning-paths/${resource.pathId}${resource.chapterId ? `/chapters/${resource.chapterId}` : ""}`} className="mt-3 inline-block text-sm font-semibold text-primary hover:underline focus-visible:underline">{tx("打开关联课程", "Open linked course")} →</AppLink>}</div>}</section>;
}
