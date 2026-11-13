"use client";

import { useCourseLanguage } from "@/components/course-language";
import { courseLanguageHref, localizedCourse } from "@/components/course-localization";
import { courseSourceName, type CourseAccessMetadata } from "@/components/course-access";
import { LearningCourseList, LearningCourseRow, learningCourseTitleClass } from "./learning-course-list";
import { CourseCatalogSearch, useCourseCatalogQuery } from "./learning-course-search";
import { filterCourseCatalog } from "./learning-course-search-model";
import { AppLink } from "@/components/navigation";
import { courseAdmissionLabel, useCourseAdmissionDialog, type PublicCourseEntry } from "@/components/schools/course-admission";
import { PageHeader } from "@/components/page-chrome";
import { State } from "./data-state";
import { useWorkspaceData } from "@/components/workspace-data";
import { useLocale, type AppLocale } from "@/components/locale-context";
import type { LearningPath } from "./learning";

function ui(locale: AppLocale, zh: string, en: string) { return locale === "en" ? en : zh; }

type LockedLearningPath = CourseAccessMetadata & Pick<LearningPath, "id" | "title" | "description" | "category" | "difficulty" | "coverKey" | "chapterCount" | "localizations"> & {
  admission: PublicCourseEntry["admission"];
};
export function StudentLearningList(){
 const {locale}=useLocale();
 const {language}=useCourseLanguage();
 const paths=useWorkspaceData<{items:(LearningPath | LockedLearningPath)[]}>("learning-paths?view=student-summary&includeAdmission=true");
 const [query, setQuery] = useCourseCatalogQuery();
 const visible = filterCourseCatalog((paths.data?.items ?? []).map(path => localizedCourse(path, language)), query);
 const detailHref = (id: string) => courseLanguageHref(`/student/learning-paths/${id}`, language);
 const { busy, openCourse, feedback, dialog } = useCourseAdmissionDialog(detailHref, paths.reload);
 return <>
  <PageHeader title={ui(locale,"课程","Courses")} description={ui(locale,"按章节阅读、练习与复盘；已读和判题通过分别记录。","Read, practice, and review each chapter. Reading and accepted submissions are tracked separately.")}/>
  <CourseCatalogSearch query={query} onSearch={setQuery}/>
  {feedback}
  <State data={paths}>
   <div className="mt-3"><LearningCourseList empty={!visible.length ? (query
     ? ui(locale,"没有符合搜索条件的课程。","No courses match this search.")
     : ui(locale,"暂无已发布课程","No published courses yet")) : undefined}>
    {visible.map(path => {
      const course = {...path, difficulty:path.difficulty??"beginner"} as const;
      const source = courseSourceName(path);
      if ("admission" in path) return <LearningCourseRow key={path.id} course={course} source={source}
        title={<button type="button" className={learningCourseTitleClass} disabled={busy} onClick={event => void openCourse(event,path.id)}>{path.title}</button>}
        status={courseAdmissionLabel(path.admission, (en, zh) => ui(locale, zh, en), path.chapterCount)}/>;
      return <LearningCourseRow key={path.id} course={course} source={source}
        title={<AppLink href={detailHref(path.id)} className={learningCourseTitleClass}>{path.title}</AppLink>}
        reading={{value:path.completedChapters,total:path.chapterCount}}
        practice={{value:path.completedTasks??0,total:path.taskCount??0}}/>;
    })}
   </LearningCourseList></div>
  </State>
  {dialog}
 </>;
}
