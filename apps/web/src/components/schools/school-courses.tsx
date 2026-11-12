"use client";

import { useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { practiceLocation } from "./school-practice-navigation";
import {
  ArrowLeft,
  Plus,
} from "lucide-react";
import {
  Feedback,
  Loading,
  useData,
  useMutation,
} from "@/components/admin/common";
import { useCourseLanguage } from "@/components/course-language";
import { courseLanguageHref, localizedCourse } from "@/components/course-localization";
import { CourseAcslPractice } from "@/components/student/course-acsl-practice";
import { CoursePracticeReturn } from "@/components/student/course-practice-return";
import { CourseAccessSummary } from "@/components/course-access";
import { LearningCourseReader } from "@/components/student/learning-course-reader";
import { useCourseProgressRefresh } from "@/components/student/course-progress-refresh";
import { LearningCourseList, LearningCourseRow, learningCourseTitleClass } from "@/components/student/learning-course-list";
import { CourseCatalogSearch } from "@/components/student/learning-course-search";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { Tabs, panel } from "@/components/teacher/shared";
import { CourseCatalogRow, CourseCatalogTable } from "@/components/teacher/course-catalog-table";
import { CourseAdmissionsDialog } from "./course-admissions-dialog";
import { SchoolCourseImport } from "./school-course-import";
import { SchoolLearningResources } from "./school-learning-resources";
import { PracticeProblem } from "./school-practice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import { useSchoolText, type School } from "./school-ui";
import { SchoolCourseEditor } from "./school-courses-editor";
import {
  useCourseError,
  type CourseInput,
  type CourseDetail,
  type CoursePage,
  type SchoolCourse,
} from "./school-courses-model";

export function SchoolCourses({
  school,
  refreshRevision = 0,
  onRefresh,
  initialCourseId,
}: {
  school: School;
  refreshRevision?: number;
  onRefresh?: () => void;
  initialCourseId?: string | null;
}) {
  const text = useSchoolText();
  const location = useSearchParams();
  const selectedId = location.get("courseId") ?? initialCourseId;
  const selected = selectedId
    ? { id: selectedId, preview: location.get("coursePreview") === "1" }
    : null;
  function selectCourse(id: string | null, preview = false) {
    window.history.pushState(
      null,
      "",
      practiceLocation(
        window.location.pathname,
        window.location.search,
        {
          courseId: id,
          coursePreview: preview ? "1" : null,
          chapterId: null,
          problemId: null,
        },
        window.location.hash,
      ),
    );
  }
  const canAuthor = school.roles.some(
    (r) => r === "school_admin" || r === "teacher",
  );
  const canReviewAdmissions = school.roles.includes("school_admin");
  const [tab, setTab] = useState("courses"),
    [archived, setArchived] = useState(false),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState<string | null>(null),
    [draft, setDraft] = useState<CourseInput | undefined>(),
    [importing, setImporting] = useState(false),
    [creatingResource, setCreatingResource] = useState(false);
  const [publication, setPublication] = useState<{
      course: SchoolCourse;
      publish: boolean;
    } | null>(null),
    [archiveTarget, setArchiveTarget] = useState<SchoolCourse | null>(null),
    [admissionsTarget, setAdmissionsTarget] = useState<SchoolCourse | null>(null),
    [message, setMessage] = useState("");
  const mutation = useMutation(),
    pending = useRef(false);
  const listHeading = useRef<HTMLDivElement>(null);
  const base = `schools/${school.id}/courses`;
  function saved(notice: string) {
    setEdit(null);
    setDraft(undefined);
    setPublication(null);
    setArchiveTarget(null);
    setMessage(notice);
    setRevision((v) => v + 1);
    requestAnimationFrame(() => listHeading.current?.focus());
  }
  if (selected)
    return (
      <div className="mt-3 space-y-3">
        <CourseReader
          key={`${selected.id}:${selected.preview}:${refreshRevision}`}
          school={school}
          base={base}
          id={selected.id}
          preview={selected.preview}
          onBack={() => {
            selectCourse(null);
            setRevision((v) => v + 1);
          }}
        />
      </div>
    );
  return (
    <div ref={listHeading} tabIndex={-1} className="space-y-3 outline-none">
      <PageHeader
        eyebrow={text("Courses", "课程")}
        title={text("Courses", "课程")}
        action={
          canAuthor ? (
            <div className="flex flex-wrap gap-2">
              {tab === "courses" && (
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  {text("Import course Markdown", "导入课程 Markdown")}
                </Button>
              )}
              <Button
                onClick={() =>
                  tab === "courses" ? setEdit("new") : setCreatingResource(true)
                }
              >
                <Plus size={15} />
                {tab === "courses"
                  ? text("New course", "新建课程")
                  : text("Add resource", "添加资料")}
              </Button>
            </div>
          ) : undefined
        }
      />
      <Tabs
        items={[
          text("Courses", "课程"),
          text("Learning resources", "学习资料"),
        ]}
        value={
          tab === "courses"
            ? text("Courses", "课程")
            : text("Learning resources", "学习资料")
        }
        onChange={(value) =>
          setTab(value === text("Courses", "课程") ? "courses" : "resources")
        }
      />
      <Feedback action={{ error: "", message }} />
      {tab === "courses" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canAuthor && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={archived ? "secondary" : "primary"}
                  aria-pressed={!archived}
                  onClick={() => {
                    setArchived(false);
                    setPage(1);
                  }}
                >
                  {text("Active", "使用中")}
                </Button>
                <Button
                  size="sm"
                  variant={archived ? "primary" : "secondary"}
                  aria-pressed={archived}
                  onClick={() => {
                    setArchived(true);
                    setPage(1);
                  }}
                >
                  {text("Archived", "已归档")}
                </Button>
              </div>
            )}
            <CourseCatalogSearch query={query} onSearch={value => {
              setQuery(value);
              setPage(1);
            }} onRefresh={onRefresh}/>
          </div>
          {canAuthor && <section className="rounded-lg border border-border bg-surface px-5 py-4">
            <h2 className="font-semibold">{text("Organize courses by chapter", "按章节编排课程")}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{text("Add lessons and linked practice, then choose the eligible classes in course properties. Publishing opens the course to those students; it does not create classes or activities.", "新建课程后添加讲解与配套练习，在课程属性中设置准入班级，发布后向符合条件的学生开放。课程不会自动创建班级、作业或训练。")}</p>
          </section>}
          <CourseList
            key={`${school.id}:${query}:${page}:${archived}:${revision}:${refreshRevision}`}
            path={`${base}?page=${page}&q=${encodeURIComponent(query)}&archived=${archived}`}
            page={page}
            onPage={setPage}
            canAuthor={canAuthor}
            query={query}
            onOpen={selectCourse}
            onEdit={setEdit}
            onPublication={setPublication}
            onArchive={setArchiveTarget}
            onAdmissions={canReviewAdmissions ? setAdmissionsTarget : undefined}
          />
        </>
      ) : (
        <SchoolLearningResources
          key={`${school.id}:${refreshRevision}`}
          schoolId={school.id}
          canAuthor={canAuthor}
          creating={creatingResource}
          onCreated={() => setCreatingResource(false)}
        />
      )}
      {importing && (
        <SchoolCourseImport
          onClose={() => setImporting(false)}
          onPrepared={(value) => {
            setImporting(false);
            setDraft(value);
            setEdit("new");
          }}
        />
      )}
      {edit &&
        (edit === "new" ? (
          <SchoolCourseEditor
            base={base}
            school={school}
            initialDraft={draft}
            onClose={() => {
              setEdit(null);
              setDraft(undefined);
            }}
            onSaved={() =>
              saved(text("Course draft saved.", "课程草稿已保存。"))
            }
          />
        ) : (
          <CourseEditorLoader
            base={base}
            id={edit}
            school={school}
            onClose={() => setEdit(null)}
            onSaved={() =>
              saved(text("Course draft saved.", "课程草稿已保存。"))
            }
          />
        ))}
      {publication && (
        <PublicationDialog
          base={base}
          {...publication}
          onClose={() => setPublication(null)}
          onSaved={() =>
            saved(
              publication.publish
                ? text("Course published.", "课程已发布。")
                : text(
                    "Course unpublished. Reading progress is preserved.",
                    "课程已下架，阅读进度保留。",
                  ),
            )
          }
        />
      )}
      {admissionsTarget && (
        <CourseAdmissionsDialog
          schoolId={school.id}
          course={admissionsTarget}
          onClose={() => setAdmissionsTarget(null)}
        />
      )}
      {archiveTarget && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending.current) setArchiveTarget(null);
          }}
        >
          <DialogContent>
            <DialogTitle>
              {archiveTarget.archived
                ? text("Restore course", "恢复课程")
                : text("Archive course", "归档课程")}
            </DialogTitle>
            <DialogDescription>
              {archiveTarget.archived
                ? text(
                    "The course returns to Active as unpublished. Review and publish it when ready.",
                    "课程将恢复至使用中列表并保持下架，核对后可重新发布。",
                  )
                : text(
                    "Students will no longer see this course. Chapters, linked practice and progress are preserved.",
                    "学生将无法查看此课程，章节、配套练习关联与学习进度保留。",
                  )}
            </DialogDescription>
            <p className="font-medium">{archiveTarget.title}</p>
            <Feedback action={mutation} />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={mutation.busy}
                onClick={() => setArchiveTarget(null)}
              >
                {text("Cancel", "取消")}
              </Button>
              <Button
                disabled={mutation.busy}
                onClick={async () => {
                  if (pending.current) return;
                  pending.current = true;
                  try {
                    await mutation.run(async () => {
                      await productionApi(
                        `${base}/${archiveTarget.id}/${archiveTarget.archived ? "restore" : "archive"}`,
                        {
                          method: "POST",
                          body: { expectedRevision: archiveTarget.revision },
                        },
                      );
                      saved(
                        archiveTarget.archived
                          ? text(
                              "Course restored as unpublished.",
                              "课程已恢复并保持下架。",
                            )
                          : text("Course archived.", "课程已归档。"),
                      );
                    });
                  } finally {
                    pending.current = false;
                  }
                }}
              >
                {archiveTarget.archived
                  ? text("Restore", "恢复")
                  : text("Archive", "归档")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
function CourseList({
  path,
  page,
  onPage,
  canAuthor,
  query,
  onOpen,
  onEdit,
  onPublication,
  onArchive,
  onAdmissions,
}: {
  path: string;
  page: number;
  onPage: (page: number) => void;
  canAuthor: boolean;
  query: string;
  onOpen: (id: string, preview?: boolean) => void;
  onEdit: (id: string) => void;
  onPublication: (action: { course: SchoolCourse; publish: boolean }) => void;
  onArchive: (course: SchoolCourse) => void;
  onAdmissions?: (course: SchoolCourse) => void;
}) {
  const text = useSchoolText();
  const { language } = useCourseLanguage();
  const resource = useData<CoursePage<SchoolCourse>>(path);
  if (canAuthor) return (
    <Loading resource={resource}>
      <section className={panel}>
        <CourseCatalogTable empty={!resource.data?.items.length ? (query ? text("No courses match this search.", "没有符合搜索条件的课程。") : text("No courses in this view.", "当前列表暂无课程。")) : undefined}>
          {resource.data?.items.map(course => <CourseCatalogRow key={course.id} course={course}
            title={<button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => course.canManage && !course.archived ? onEdit(course.id) : onOpen(course.id)}>{course.title}</button>}
            access={<span className="text-xs text-muted-foreground">{course.accessScope === "school" ? text("School-wide", "全校可学") : text("Selected classes", "指定班级")}</span>}
            status={<>
              <CourseStatus course={course}/>
              {course.hasUnpublishedChanges && <p className="mt-1 text-xs text-muted-foreground">{text("Unpublished edits", "有未发布修改")}</p>}
            </>}
            actions={<div className="flex flex-wrap items-center gap-1">
              <Button size="sm" variant="ghost" className="text-primary" onClick={() => course.canManage && !course.archived ? onEdit(course.id) : onOpen(course.id)}>{course.canManage && !course.archived ? text("Edit", "编辑") : text("View", "查看")}</Button>
              {course.canManage && <>
                {!course.archived && <Button size="sm" variant="ghost" className="text-primary" onClick={() => onOpen(course.id, true)}>{text("Student preview", "学生预览")}</Button>}
                <Button size="sm" variant="ghost" onClick={() => onArchive(course)}>{course.archived ? text("Restore", "恢复") : text("Archive", "归档")}</Button>
                {!course.archived && (course.status !== "published" || course.hasUnpublishedChanges) && <Button size="sm" variant="secondary" onClick={() => onPublication({ course, publish: true })}>{text("Publish", "发布")}</Button>}
                {!course.archived && course.status === "published" && <Button size="sm" variant="ghost" onClick={() => onPublication({ course, publish: false })}>{text("Unpublish", "下架")}</Button>}
                {onAdmissions && course.status === "published" && !course.archived && (
                  <Button size="sm" variant="ghost" onClick={() => onAdmissions(course)}>
                    {text("Admissions", "准入与申请")}
                  </Button>
                )}
              </>}
            </div>}
          />)}
        </CourseCatalogTable>
      </section>
      <CoursePagination page={page} hasMore={resource.data?.hasMore ?? false} onPage={onPage}/>
    </Loading>
  );
  return (
    <Loading resource={resource}>
      <LearningCourseList empty={!resource.data?.items.length ? (query
        ? text("No courses match this search.", "没有符合搜索条件的课程。")
        : text("No courses in this view.", "当前列表暂无课程。")) : undefined}>
        {resource.data?.items.map(item => localizedCourse(item, language)).map(course => <LearningCourseRow key={course.id} course={course}
          title={<button type="button" className={learningCourseTitleClass} onClick={() => onOpen(course.id)}>{course.title}</button>}
          status={course.accessScope === "school" ? text("School-wide", "本校学生") : text("Selected classes", "指定班级")}
          reading={{ value: course.completedChapters, total: course.chapterCount }}
          practice={{ value: course.completedExercises, total: course.totalExercises }} />)}
      </LearningCourseList>
      <CoursePagination
        page={page}
        hasMore={resource.data?.hasMore ?? false}
        onPage={onPage}
      />
    </Loading>
  );
}

export function CoursePagination({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}) {
  const text = useSchoolText();
  return (
    <nav
      aria-label={text("Course pages", "课程分页")}
      className="mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground"
    >
      <Button
        size="sm"
        variant="ghost"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {text("Previous", "上一页")}
      </Button>
      <span>{text(`Page ${page}`, `第 ${page} 页`)}</span>
      <Button
        size="sm"
        variant="ghost"
        disabled={!hasMore}
        onClick={() => onPage(page + 1)}
      >
        {text("Next", "下一页")}
      </Button>
    </nav>
  );
}

function CourseStatus({ course }: { course: SchoolCourse }) {
  const text = useSchoolText();
  return (
    <StatusPill
      status={
        course.archived
          ? text("Archived", "已归档")
          : course.status === "published"
            ? text("Published", "已发布")
            : course.status === "unpublished"
              ? text("Unpublished", "已下架")
              : text("Draft", "草稿")
      }
    />
  );
}

function CourseEditorLoader({
  base,
  id,
  school,
  onClose,
  onSaved,
}: {
  base: string;
  id: string;
  school: School;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (id === "new")
    return (
      <SchoolCourseEditor
        base={base}
        school={school}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  return (
    <ExistingCourseEditor
      base={base}
      id={id}
      school={school}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function ExistingCourseEditor({
  base,
  id,
  school,
  onClose,
  onSaved,
}: {
  base: string;
  id: string;
  school: School;
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = useSchoolText();
  const resource = useData<CourseDetail>(`${base}/${id}`);
  if (
    resource.data &&
    !resource.error &&
    !resource.loading &&
    resource.data.canManage
  )
    return (
      <SchoolCourseEditor
        base={base}
        school={school}
        initial={resource.data}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{text("Edit course", "编辑课程")}</DialogTitle>
        <DialogDescription>
          {text("Load the current course draft.", "读取当前课程草稿。")}
        </DialogDescription>
        <Loading resource={resource}>
          <p role="alert" className="text-sm">
            {text("You cannot edit this course.", "你无法编辑此课程。")}
          </p>
        </Loading>
      </DialogContent>
    </Dialog>
  );
}

function PublicationDialog({
  base,
  course,
  publish,
  onClose,
  onSaved,
}: {
  base: string;
  course: SchoolCourse;
  publish: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = useSchoolText();
  const errorMessage = useCourseError();
  const mutation = useMutation();
  const pending = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending.current) event.preventDefault();
        }}
      >
        <DialogTitle>
          {publish
            ? text("Publish course", "发布课程")
            : text("Unpublish course", "下架课程")}
        </DialogTitle>
        <DialogDescription>
          {publish
            ? text(
                `Publish the saved chapters of “${course.title}” to its selected audience?`,
                `将「${course.title}」已保存的章节发布给所设定的学习对象？`,
              )
            : text(
                `Remove student access to “${course.title}”? Saved reading progress will be kept.`,
                `停止学生访问「${course.title}」？已有阅读进度将保留。`,
              )}
        </DialogDescription>
        <Feedback action={mutation} />
        <div className="flex justify-end gap-2">
          <Button
            ref={cancel}
            variant="secondary"
            disabled={mutation.busy}
            onClick={onClose}
          >
            {text("Cancel", "取消")}
          </Button>
          <Button
            variant={publish ? "primary" : "danger"}
            disabled={mutation.busy}
            onClick={async () => {
              if (pending.current) return;
              pending.current = true;
              try {
                await mutation.run(async () => {
                  try {
                    await productionApi(
                      `${base}/${course.id}/${publish ? "publish" : "unpublish"}`,
                      {
                        method: "POST",
                        body: { expectedRevision: course.revision },
                      },
                    );
                    onSaved();
                  } catch (error) {
                    throw errorMessage(error);
                  }
                });
              } finally {
                pending.current = false;
              }
            }}
          >
            {publish ? text("Publish", "发布") : text("Unpublish", "下架")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CourseReader({ school, base, id, preview = false, onBack }: {
  school: School; base: string; id: string; preview?: boolean; onBack: () => void;
}) {
  const text = useSchoolText();
  const { language } = useCourseLanguage();
  const resource = useData<CourseDetail>(`${base}/${id}${preview ? "/preview" : ""}`);
  useCourseProgressRefresh(resource);
  const location = useSearchParams(), pathname = usePathname();
  const errorMessage = useCourseError();
  const course = resource.data;
  const selectedChapter = location.get("chapterId");
  const chapter = selectedChapter ? course?.chapters.find(item => item.id === selectedChapter)
    : course?.chapters.find(item => !item.read) ?? course?.chapters[0];
  const readerHref = (chapterId: string, problemId: string | null = null) => practiceLocation(pathname, location.toString(), {
    courseId: id, chapterId, problemId, contentLanguage: language,
  });
  const practiceId = location.get("problemId");
  const practiceItems = (chapter?.problems ?? []).filter(item => item.available).map(item => ({ id: item.problemId, title: item.title ?? item.problemId }));
  const practice = chapter?.problems?.find(item => item.available && item.problemId === practiceId);
  if (course && chapter && practice && !resource.error) return <PracticeProblem
    key={`${id}:${chapter.id}:${practice.problemId}:${practice.versionId}`} path={`schools/${school.id}/problems/${practice.problemId}`} jobPath={jobId => `schools/${school.id}/judge-jobs/${jobId}`}
    expectedVersionId={practice.versionId} course={{ courseId: id, chapterId: chapter.id, requiredLanguage: course.requiredLanguage, solved: Boolean(practice.solved), preview, reload: resource.reload }}
    backLabel={text("Back to chapter", "返回章节")}
    navigation={{ items: practiceItems, currentId: practice.problemId, onSelect: problemId => window.history.pushState(null, "", readerHref(chapter.id, problemId)) }}
    onBack={() => { window.history.pushState(null, "", readerHref(chapter.id)); resource.reload(); }}/>
  return <Loading resource={resource}>{course && <>
    {preview && <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground"><Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft size={14}/>{text("Courses", "课程")}</Button>{text("Student preview", "学生预览")}</div>}
    <LearningCourseReader
      course={{ ...course, taskCount: course.totalExercises, completedTasks: course.completedExercises }}
      chapters={course.chapters.map(item => ({ id: item.id, title: item.title, sectionKey: item.sectionKey, content: item.body, localizations: item.localizations, completed: Boolean(item.read),
        problems: (item.problems ?? []).map(problem => ({ id: problem.problemId, title: problem.title ?? problem.problemId,
          completed: problem.solved, available: Boolean(problem.available), href: readerHref(item.id, problem.problemId) })),
      }))}
      selectedChapterId={selectedChapter} chapterHref={chapterId => readerHref(chapterId)} scrollKey={`school:${school.id}:${id}`}
      metadata={<CourseAccessSummary course={course} showAuthor/>}
      relatedActivities={<CoursePracticeReturn schoolId={school.id}/>}
      extraPractice={chapterId => { const links = course.chapters.find(item => item.id === chapterId)?.acslLinks ?? []; return links.length ? <CourseAcslPractice links={links} schoolId={school.id} courseHref={courseLanguageHref(readerHref(chapterId), language)}/> : null; }}
      canTrackProgress={!preview && course.canTrackProgress}
      chapterResources={chapterId => !preview ? <SchoolLearningResources schoolId={school.id} canAuthor={false} courseId={id} chapterId={chapterId} hideEmpty/> : null}
      onRead={async chapterId => {
        try {
          await productionApi(`${base}/${id}/chapters/${chapterId}/read`, { method: "POST", body: { read: true, expectedRevision: course.revision } });
          resource.reload();
        } catch (error) { throw errorMessage(error); }
      }}
    />
  </>}</Loading>;
}
