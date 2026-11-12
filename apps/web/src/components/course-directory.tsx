"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { chapterDirectoryTitle } from "@/lib/learning-chapter-title";
import { courseDirectorySections, type CourseSection } from "./course-sections";

type DirectoryChapter = { id: string; title: string; sectionKey?: string | null; completed?: boolean };
export function CourseDirectory({ sections, chapters, language, locale, selectedId, chapterHref, onSelect, showProgress = true }: {
  sections?: CourseSection[]; chapters: DirectoryChapter[]; language: "en" | "zh"; locale: "en" | "zh";
  selectedId?: string; chapterHref?: (id: string) => string; onSelect?: (id: string) => void; showProgress?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const text = (zh: string, en: string) => locale === "en" ? en : zh;
  const topics = courseDirectorySections(sections, chapters, language);
  const selectedTopic = chapters.find(chapter => chapter.id === selectedId)?.sectionKey;
  useEffect(() => {
    for (const details of root.current?.querySelectorAll<HTMLDetailsElement>('details[data-course-section]') ?? [])
      if (details.dataset.courseSection === selectedTopic) details.open = true;
  }, [selectedId, selectedTopic]);
  const lesson = (chapter: DirectoryChapter, index: number) => {
    const className = `flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${chapter.id === selectedId ? "bg-accent font-semibold text-primary" : "text-muted-foreground hover:bg-surface-subtle"}`;
    const content: ReactNode = <><span className="min-w-0 flex-1 break-words">{chapterDirectoryTitle(chapter.title, index)}</span>{showProgress && chapter.completed && <CheckCircle2 size={15} className="shrink-0 text-success" aria-label={text("本课已读", "Lesson read")}/>}</>;
    return chapterHref ? <AppLink key={chapter.id} href={chapterHref(chapter.id)} aria-current={chapter.id === selectedId ? "page" : undefined} className={className}>{content}</AppLink>
      : <button type="button" key={chapter.id} onClick={() => onSelect?.(chapter.id)} aria-current={chapter.id === selectedId ? "page" : undefined} className={className}>{content}</button>;
  };
  const known = new Set(topics.map(topic => topic.key));
  const ungrouped = chapters.filter(chapter => !known.has(chapter.sectionKey ?? ""));
  return <nav ref={root} className="p-2" aria-label={text("课程目录", "Course directory")} data-od-id="course-topic-directory">
    {topics.map((topic, index) => <div key={topic.key}>
      {topic.groupTitle && (index === 0 || topics[index - 1].groupKey !== topic.groupKey) && <p className="px-3 pb-1 pt-4 text-xs font-semibold text-muted-foreground" data-od-id="course-group-title">{topic.groupTitle}</p>}
      <details data-course-section={topic.key} open={topic.key === selectedTopic} className="group border-b border-border last:border-b-0">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown size={15} aria-hidden="true" className="shrink-0 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none"/>
          <span className="min-w-0 flex-1 break-words">{topic.title}</span>
          <span className="shrink-0 whitespace-nowrap text-xs font-normal tabular-nums text-muted-foreground" aria-label={showProgress ? text(`${topic.chapters.filter(c => c.completed).length}/${topic.chapters.length} 课已读`, `${topic.chapters.filter(c => c.completed).length} of ${topic.chapters.length} lessons read`) : undefined}>{showProgress ? `${topic.chapters.filter(c => c.completed).length}/${topic.chapters.length}` : `${topic.chapters.length} ${text("课", "lessons")}`}</span>
        </summary>
        <div className="pb-2 pl-3">{topic.chapters.map(lesson)}</div>
      </details>
    </div>)}
    {ungrouped.length > 0 && <>{topics.length > 0 && <p className="px-3 pb-1 pt-4 text-xs font-semibold text-muted-foreground">{text("其他课时", "Other lessons")}</p>}{ungrouped.map(lesson)}</>}
  </nav>;
}
