"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, ChevronDown } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { LearningProgressSummary } from "@/components/learning-course";
import { AppLink } from "@/components/navigation";
import { PageHeader } from "@/components/page-chrome";
import { Button, buttonVariants } from "@/components/ui/button";
import { CourseDirectory } from "@/components/course-directory";
import { orderCourseChapters, type CourseSection } from "@/components/course-sections";
import { Empty, Feedback, LessonContent, panel, useMutation } from "./shared";
import { CourseLanguageControl, useCourseLanguage } from "@/components/course-language";
import { localizedCourse, localizedChapter, type CourseLocalizations, type ChapterLocalizations } from "@/components/course-localization";

export interface ReaderPractice {
  id: string;
  title: string;
  href: string;
  completed?: boolean;
  available?: boolean;
}

export interface ReaderChapter {
  id: string;
  title: string;
  content: string;
  completed: boolean;
  sectionKey?: string | null;
  objective?: string;
  checkpoint?: string;
  checkpointAnswer?: string;
  problems: ReaderPractice[];
  localizations?: ChapterLocalizations;
}

/** Shared presentation for school and public learning; callers retain their own access checks and APIs. */
export function LearningCourseReader({
  course: sourceCourse, chapters: sourceChapters, selectedChapterId, chapterHref, onRead, canTrackProgress = true,
  metadata, relatedActivities, extraPractice, chapterResources, scrollKey,
}: {
  course: { title: string; description: string; chapterCount: number; completedChapters: number; taskCount: number; completedTasks: number; localizations?: CourseLocalizations; sections?: CourseSection[] };
  chapters: ReaderChapter[];
  selectedChapterId?: string | null;
  chapterHref: (chapterId: string) => string;
  onRead: (chapterId: string) => Promise<void>;
  canTrackProgress?: boolean;
  metadata?: ReactNode;
  relatedActivities?: ReactNode;
  extraPractice?: (chapterId: string) => ReactNode;
  chapterResources?: (chapterId: string) => ReactNode;
  scrollKey: string;
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const { language, setLanguage } = useCourseLanguage();
  const course = localizedCourse(sourceCourse, language);
  const chapters = orderCourseChapters(sourceCourse.sections, sourceChapters).map(item => localizedChapter(item, language));
  const directoryRef = useRef<HTMLDivElement>(null);
  const chapter = selectedChapterId
    ? chapters.find(item => item.id === selectedChapterId)
    : chapters.find(item => !item.completed) ?? chapters[0];
  const index = chapter ? chapters.findIndex(item => item.id === chapter.id) : -1;
  const nextChapterId = index >= 0 ? chapters[index + 1]?.id : undefined;

  useEffect(() => {
    if (!chapter) return;
    try {
      const key = `learning-scroll:${scrollKey}:${chapter.id}`;
      const value = sessionStorage.getItem(key);
      if (value !== null) {
        sessionStorage.removeItem(key);
        const frame = requestAnimationFrame(() => window.scrollTo(0, Number(value) || 0));
        return () => cancelAnimationFrame(frame);
      }
    } catch {}
  }, [scrollKey, chapter]);

  useEffect(() => {
    const container = directoryRef.current;
    if (!container?.clientHeight) return;
    const active = container.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    const activeRect = active.getBoundingClientRect(), containerRect = container.getBoundingClientRect();
    const top = activeRect.top - containerRect.top;
    if (top < 0 || top + activeRect.height > container.clientHeight)
      container.scrollTop += top - (container.clientHeight - activeRect.height) / 2;
  }, [chapter?.id]);

  const directory = <CourseDirectory sections={course.sections} chapters={chapters} language={language} locale={locale}
    selectedId={chapter?.id} chapterHref={chapterHref}/>;

  return <>
    <PageHeader className="course-detail-header" title={chapter?.title ?? course.title} description={course.description}/>
    <div className="mt-3"><CourseLanguageControl language={language} onChange={setLanguage} missing={Boolean(chapter && !chapter.localizations?.[language])}/></div>
    {metadata && <div className="mt-2">{metadata}</div>}
    <div className="mt-4"><LearningProgressSummary read={course.completedChapters} totalChapters={course.chapterCount} done={course.completedTasks} totalTasks={course.taskCount}/></div>
    {relatedActivities}
    <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]" data-od-id="learning-course-reader">
      <aside className="self-start border border-border bg-surface panel-shadow lg:sticky lg:top-4">
        <details className="lg:hidden"><summary className="cursor-pointer px-4 py-3 font-semibold">{text("章节目录", "Chapter directory")} · {chapter ? `${index + 1}/${course.chapterCount}` : course.chapterCount}<ChevronDown className="float-right" size={16}/></summary><div className="max-h-[60dvh] overflow-y-auto">{directory}</div></details>
        <div ref={directoryRef} className="hidden lg:block lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain">{directory}</div>
      </aside>
      <main className="min-w-0">{chapter ? <ReaderLesson key={chapter.id} chapter={chapter}
        nextHref={nextChapterId ? chapterHref(nextChapterId) : undefined} onRead={onRead} canTrackProgress={canTrackProgress}
        extraPractice={extraPractice?.(chapter.id)} resources={chapterResources?.(chapter.id)} scrollKey={scrollKey}/>
        : <Empty title={selectedChapterId ? text("章节不存在", "Chapter not found") : text("暂无章节", "No chapters available")}
          description={text("从章节目录选择已发布章节；老师发布内容后即可阅读。", "Choose a published chapter from the directory. You can read it after your teacher publishes it.")}/>}</main>
    </div>
  </>;
}

function ReaderLesson({ chapter, nextHref, onRead, canTrackProgress, extraPractice, resources, scrollKey }: {
  chapter: ReaderChapter;
  nextHref?: string;
  onRead: (chapterId: string) => Promise<void>;
  canTrackProgress: boolean;
  extraPractice?: ReactNode;
  resources?: ReactNode;
  scrollKey: string;
}) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const router = useRouter(), action = useMutation(), pending = useRef(false);
  const saveScroll = () => { try { sessionStorage.setItem(`learning-scroll:${scrollKey}:${chapter.id}`, String(window.scrollY)); } catch {} };
  return <article className="space-y-5" data-od-id="learning-chapter-content">
    <LearningChapterContent chapter={chapter}/>
    {(chapter.problems.length > 0 || Boolean(extraPractice)) && <section className={`${panel} p-5 sm:p-7`}>
      <h2 className="text-lg font-bold">{text("配套练习", "Practice problems")}</h2>
      {chapter.problems.map(problem => <div key={problem.id} className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div><h3 className="font-semibold">{problem.available === false ? problem.title : <AppLink href={problem.href} className="text-primary hover:underline focus-visible:underline" onClick={saveScroll}>{problem.title}</AppLink>}</h3>
          {problem.completed ? <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success-soft px-2.5 py-1 text-sm font-semibold text-success"><CheckCircle2 size={15} aria-hidden="true"/>{text("已通过正式判题", "Accepted in formal judging")}</p>
            : <p className="mt-1 text-xs text-muted-foreground">{problem.available === false ? text("该关联版本已不可用，请联系教师更新课程。", "This linked version is unavailable. Ask your teacher to update the course.") : text("题库中的已发布版本", "Published problem version")}</p>}
        </div>
        {problem.available === false ? <Button variant="secondary" disabled>{text("开始练习", "Start practice")}</Button>
          : <AppLink className={buttonVariants({ variant: "secondary" })} href={problem.href} onClick={saveScroll}>{problem.completed ? text("再次练习", "Practice again") : text("开始练习", "Start practice")}</AppLink>}
      </div>)}
      {extraPractice}
    </section>}
    {resources}
    {(canTrackProgress || nextHref) && <section className={`${panel} flex flex-wrap items-center justify-between gap-4 p-5`}>
      <div><p className="font-semibold">{chapter.completed ? text("本章已读", "Chapter read") : text("完成本章学习", "Complete this chapter")}</p>
        {canTrackProgress && <p className="mt-1 text-xs text-muted-foreground">{text("阅读进度独立保存，不代表练习通过或计入成绩。", "Reading progress is saved separately. It does not mean practice was accepted or counted toward a grade.")}</p>}
      </div>
      <Button variant={chapter.completed ? "secondary" : "primary"} disabled={action.busy || (chapter.completed && !nextHref)} onClick={() => {
        if (pending.current) return;
        pending.current = true;
        void action.run(async () => {
          if (canTrackProgress && !chapter.completed) await onRead(chapter.id);
          if (nextHref) router.push(nextHref);
          else action.success(text("本章已标记已读。", "Chapter marked as read."));
        }).finally(() => { pending.current = false; });
      }}>{nextHref ? <>{text("下一章", "Next chapter")}<ArrowRight size={15}/></> : chapter.completed ? <><CheckCircle2 size={15}/>{text("本章已读", "Chapter read")}</> : text("完成本章", "Finish chapter")}</Button>
      <Feedback action={action}/>
    </section>}
  </article>;
}

/** Shared lesson and checkpoint presentation for the reader and teacher previews. */
export function LearningChapterContent({ chapter }: { chapter: Pick<ReaderChapter, "title" | "content" | "objective" | "checkpoint" | "checkpointAnswer"> }) {
  const { locale } = useLocale(), text = (zh: string, en: string) => locale === "en" ? en : zh;
  return <div className="relative isolate space-y-5" data-od-id="learning-lesson-presentation">
    <section className={`${panel} p-5 sm:p-7`}><h1 className="text-2xl font-bold">{chapter.title}</h1>
      {chapter.objective && <div className="mt-4 border-b border-border pb-5"><h2 className="text-sm font-semibold">{text("学习目标", "Learning objective")}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{chapter.objective}</p></div>}
      <div className="mt-6"><LessonContent content={chapter.content}/></div>
    </section>
    {chapter.checkpoint?.trim() && <section className={`${panel} p-5 sm:p-7`} data-od-id="learning-checkpoint">
      <h2 className="text-lg font-bold">{text("检查点", "Checkpoint")}</h2><div className="mt-3"><LessonContent content={chapter.checkpoint}/></div>
      {chapter.checkpointAnswer?.trim() && <details className="mt-4 border-t border-border pt-4 text-sm"><summary className="cursor-pointer font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{text("查看参考答案", "View reference answer")}</summary><div className="mt-3"><LessonContent content={chapter.checkpointAnswer}/></div></details>}
    </section>}
  </div>;
}
