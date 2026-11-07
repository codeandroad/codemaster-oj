"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Feedback,
  inputClass,
  Loading,
  useData,
  useMutation,
} from "@/components/admin/common";
import {
  LearningCover,
  courseCovers,
  courseDifficulties,
} from "@/components/learning-course";
import { SchoolCourseProblemPicker } from "./school-course-problem-picker";
import { MathContent } from "@/components/math-content";
import { useNavigationBlocker } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRangeSelection } from "@/components/ui/use-range-selection";
import { productionApi } from "@/lib/production-api";
import { useSchoolText, type School } from "./school-ui";
import {
  useCourseError,
  type CourseChapter,
  type CourseDetail,
  type CourseInput,
  type CoursePage,
} from "./school-courses-model";

function inputFor(course?: CourseDetail): CourseInput {
  return course
    ? {
        category: course.category,
        difficulty: course.difficulty,
        coverKey: course.coverKey,
        coverImage: course.coverImage,
        estimatedMinutes: course.estimatedMinutes,
        authorName: course.authorName,
        authoredAt: course.authoredAt,
        title: course.title,
        description: course.description,
        accessScope: course.accessScope,
        classIds: [...course.classIds],
        chapters: course.chapters.map(({ id, title, body, problems }) => ({
          id,
          title,
          body,
          problems: (problems ?? []).map(({ problemId, versionId }) => ({
            problemId,
            versionId,
          })),
        })),
      }
    : {
        category: "Programming",
        difficulty: "beginner",
        coverKey: "general",
        coverImage: null,
        estimatedMinutes: 60,
        authorName: "",
        authoredAt: null,
        title: "",
        description: "",
        accessScope: "school",
        classIds: [],
        chapters: [],
      };
}

export function SchoolCourseEditor({
  base,
  school,
  initial,
  initialDraft,
  onClose,
  onSaved,
}: {
  base: string;
  school: School;
  initial?: CourseDetail;
  initialDraft?: CourseInput;
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = useSchoolText();
  const errorMessage = useCourseError(true);
  const mutation = useMutation();
  const pending = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<CourseInput>(
    () => initialDraft ?? inputFor(initial),
  );
  const [baseline] = useState(() =>
    JSON.stringify(initialDraft ?? inputFor(initial)),
  );
  const [chapterId, setChapterId] = useState(
    (initialDraft ?? initial)?.chapters[0]?.id ?? "",
  );
  const [preview, setPreview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [removeChapter, setRemoveChapter] = useState<CourseChapter | null>(
    null,
  );
  const [validation, setValidation] = useState("");
  const [invalidField, setInvalidField] = useState<
    "title" | "chapter" | "classes" | ""
  >("");
  const titleInput = useRef<HTMLInputElement>(null);
  const chapterTitle = useRef<HTMLInputElement>(null);
  const classSection = useRef<HTMLDivElement>(null);
  const cancelDiscard = useRef<HTMLButtonElement>(null);
  const cancelRemove = useRef<HTMLButtonElement>(null);
  const dirty = JSON.stringify(form) !== baseline;
  useNavigationBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const chapterIndex = form.chapters.findIndex(
    (chapter) => chapter.id === chapterId,
  );
  const chapter = form.chapters[chapterIndex];

  function requestClose() {
    if (pending.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  function editChapter(patch: Partial<CourseChapter>) {
    setForm((previous) => ({
      ...previous,
      chapters: previous.chapters.map((item) =>
        item.id === chapterId ? { ...item, ...patch } : item,
      ),
    }));
  }
  function moveChapter(direction: -1 | 1) {
    const target = chapterIndex + direction;
    if (target < 0 || target >= form.chapters.length) return;
    setForm((previous) => {
      const chapters = [...previous.chapters];
      [chapters[chapterIndex], chapters[target]] = [
        chapters[target],
        chapters[chapterIndex],
      ];
      return { ...previous, chapters };
    });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    setValidation("");
    setInvalidField("");
    if (!form.title.trim()) {
      setValidation(text("Enter a course title.", "请输入课程名称。"));
      setInvalidField("title");
      titleInput.current?.focus();
      return;
    }
    const unnamed = form.chapters.find((item) => !item.title.trim());
    if (unnamed) {
      setChapterId(unnamed.id);
      setPreview(false);
      setValidation(
        text("Give each chapter a title.", "请为每个章节填写标题。"),
      );
      setInvalidField("chapter");
      requestAnimationFrame(() => chapterTitle.current?.focus());
      return;
    }
    if (form.accessScope === "classes" && form.classIds.length === 0) {
      setValidation(text("Select at least one class.", "请至少选择一个班级。"));
      setInvalidField("classes");
      classSection.current?.focus();
      return;
    }
    const payload = {
      ...form,
      title: form.title.trim(),
      chapters: form.chapters.map((item) => ({
        ...item,
        title: item.title.trim(),
      })),
      classIds: form.accessScope === "school" ? [] : form.classIds,
    };
    pending.current = true;
    try {
      await mutation.run(async () => {
        try {
          await productionApi(initial ? `${base}/${initial.id}` : base, {
            method: initial ? "PATCH" : "POST",
            body: {
              ...payload,
              ...(initial
                ? { expectedRevision: initial.revision }
                : { requestId }),
            },
          });
          onSaved();
        } catch (error) {
          throw errorMessage(error);
        }
      });
    } finally {
      pending.current = false;
    }
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <DialogContent
          className="max-h-[92dvh] max-w-5xl gap-3 overflow-y-auto p-4 sm:p-5"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleInput.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (pending.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          <div className="pr-7">
            <DialogTitle>
              {initial
                ? text("Edit course", "编辑课程")
                : text("Create course", "创建课程")}
            </DialogTitle>
            <DialogDescription className="mt-1">
              {text(
                `Save a draft for ${school.name}. Students see it only after you publish.`,
                `为「${school.name}」保存课程草稿，发布后学生才可阅读。`,
              )}
            </DialogDescription>
          </div>
          <form
            noValidate
            onSubmit={save}
            className="space-y-3"
            aria-busy={mutation.busy}
          >
            <fieldset disabled={mutation.busy} className="min-w-0 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="min-w-0 text-sm font-medium">
                  {text("Course title", "课程名称")}
                  <input
                    ref={titleInput}
                    className={`${inputClass} mt-1 h-9`}
                    value={form.title}
                    maxLength={200}
                    aria-invalid={invalidField === "title"}
                    aria-describedby={
                      invalidField === "title" ? "course-validation" : undefined
                    }
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        title: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="min-w-0 text-sm font-medium">
                  {text("Audience", "学习对象")}
                  <select
                    className={`${inputClass} mt-1 h-9`}
                    value={form.accessScope}
                    onChange={(event) =>
                      setForm((previous) => ({
                        ...previous,
                        accessScope: event.target
                          .value as CourseInput["accessScope"],
                      }))
                    }
                  >
                    <option value="school">
                      {text("All students in this school", "本校所有学生")}
                    </option>
                    <option value="classes">
                      {text("Selected classes", "指定班级")}
                    </option>
                  </select>
                </label>
              </div>
              <label className="block text-sm font-medium">
                {text("Description", "课程简介")}
                <textarea
                  className={`${inputClass} mt-1 min-h-16 resize-none py-2`}
                  rows={2}
                  maxLength={4000}
                  value={form.description}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-medium">
                  {text("Category", "分类")}
                  <input
                    className={`${inputClass} mt-1 h-9`}
                    value={form.category}
                    maxLength={100}
                    required
                    onChange={(e) =>
                      setForm((p) => ({ ...p, category: e.target.value }))
                    }
                  />
                </label>
                <label className="text-sm font-medium">
                  {text("Difficulty", "难度")}
                  <select
                    className={`${inputClass} mt-1 h-9`}
                    value={form.difficulty}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        difficulty: e.target.value as CourseInput["difficulty"],
                      }))
                    }
                  >
                    {Object.entries(courseDifficulties).map(
                      ([value, label]) => (
                        <option value={value} key={value}>
                          {text(
                            {
                              beginner: "Beginner",
                              intermediate: "Intermediate",
                              advanced: "Advanced",
                            }[value as keyof typeof courseDifficulties],
                            label,
                          )}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  {text("Estimated minutes", "预计分钟")}
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    required
                    className={`${inputClass} mt-1 h-9`}
                    value={form.estimatedMinutes}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        estimatedMinutes: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label className="text-sm font-medium">
                  {text("Cover", "封面")}
                  <select
                    className={`${inputClass} mt-1 h-9`}
                    value={form.coverKey}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        coverKey: e.target.value as CourseInput["coverKey"],
                      }))
                    }
                  >
                    {Object.entries(courseCovers).map(([value, label]) => (
                      <option key={value} value={value}>
                        {text(
                          {
                            python: "Python",
                            algorithms: "Algorithms",
                            general: "General learning",
                          }[value as keyof typeof courseCovers],
                          label,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  {text("Author", "作者")}
                  <input
                    className={`${inputClass} mt-1 h-9`}
                    maxLength={200}
                    value={form.authorName}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, authorName: e.target.value }))
                    }
                  />
                </label>
                <label className="text-sm font-medium">
                  {text("Authored date", "编写日期")}
                  <input
                    type="date"
                    className={`${inputClass} mt-1 h-9`}
                    value={form.authoredAt?.slice(0, 10) ?? ""}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        authoredAt: e.target.value
                          ? `${e.target.value}T00:00:00.000Z`
                          : null,
                      }))
                    }
                  />
                </label>
                <label className="text-sm font-medium sm:col-span-2">
                  {text(
                    "Cover image · PNG, JPEG or WebP, up to 512 KiB",
                    "预览图 · PNG、JPEG 或 WebP，最多 512 KiB",
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="mt-1 block w-full text-sm"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 524288) {
                        setValidation(
                          text(
                            "The image must be no larger than 512 KiB.",
                            "图片不能超过 512 KiB。",
                          ),
                        );
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        setForm((p) => ({
                          ...p,
                          coverImage: String(reader.result),
                        }));
                        setValidation("");
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-32 overflow-hidden rounded-md">
                  <LearningCover
                    coverKey={form.coverKey}
                    coverImage={form.coverImage}
                  />
                </div>
                {form.coverImage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm((p) => ({ ...p, coverImage: null }))}
                  >
                    {text("Use preset cover", "使用预设封面")}
                  </Button>
                )}
              </div>
              {form.accessScope === "classes" && (
                <div
                  ref={classSection}
                  tabIndex={-1}
                  className="rounded-md border border-border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-describedby={
                    invalidField === "classes" ? "course-validation" : undefined
                  }
                >
                  <ClassPicker
                    schoolId={school.id}
                    selected={form.classIds}
                    onChange={(classIds) =>
                      setForm((previous) => ({ ...previous, classIds }))
                    }
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <h3 className="text-sm font-semibold">
                  {text(
                    `Chapters (${form.chapters.length})`,
                    `章节（${form.chapters.length}）`,
                  )}
                </h3>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={form.chapters.length >= 100}
                  onClick={() => {
                    const next = {
                      id: crypto.randomUUID(),
                      title: text("New chapter", "新章节"),
                      body: "",
                    };
                    setForm((previous) => ({
                      ...previous,
                      chapters: [...previous.chapters, next],
                    }));
                    setChapterId(next.id);
                    setPreview(false);
                    requestAnimationFrame(() => chapterTitle.current?.focus());
                  }}
                >
                  <Plus size={14} />
                  {text("Add chapter", "添加章节")}
                </Button>
              </div>
              {chapter ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">
                        {text("Choose a chapter", "选择章节")}
                      </span>
                      <select
                        value={chapter.id}
                        className={`${inputClass} h-9`}
                        onChange={(event) => {
                          setChapterId(event.target.value);
                          setPreview(false);
                        }}
                      >
                        {form.chapters.map((item, index) => (
                          <option key={item.id} value={item.id}>
                            {index + 1}.{" "}
                            {item.title || text("Untitled", "未命名")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={chapterIndex <= 0}
                      title={text("Move chapter up", "章节上移")}
                      aria-label={text("Move chapter up", "章节上移")}
                      onClick={() => moveChapter(-1)}
                    >
                      <ArrowUp size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={chapterIndex >= form.chapters.length - 1}
                      title={text("Move chapter down", "章节下移")}
                      aria-label={text("Move chapter down", "章节下移")}
                      onClick={() => moveChapter(1)}
                    >
                      <ArrowDown size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={text("Remove chapter", "移除章节")}
                      aria-label={text("Remove chapter", "移除章节")}
                      onClick={() => setRemoveChapter(chapter)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                  <label className="block text-sm font-medium">
                    {text("Chapter title", "章节标题")}
                    <input
                      ref={chapterTitle}
                      className={`${inputClass} mt-1 h-9`}
                      maxLength={200}
                      value={chapter.title}
                      aria-invalid={invalidField === "chapter"}
                      aria-describedby={
                        invalidField === "chapter"
                          ? "course-validation"
                          : undefined
                      }
                      onChange={(event) =>
                        editChapter({ title: event.target.value })
                      }
                    />
                  </label>
                  <SchoolCourseProblemPicker
                    schoolId={school.id}
                    selected={chapter.problems ?? []}
                    onChange={(problems) => editChapter({ problems })}
                  />
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span
                        id="school-course-body-label"
                        className="text-sm font-medium"
                      >
                        {text(
                          "Chapter content · Markdown",
                          "章节正文 · Markdown",
                        )}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-pressed={preview}
                        onClick={() => setPreview((value) => !value)}
                      >
                        {preview ? <Pencil size={14} /> : <Eye size={14} />}
                        {preview
                          ? text("Write", "编辑")
                          : text("Preview", "预览")}
                      </Button>
                    </div>
                    {preview ? (
                      <div
                        aria-labelledby="school-course-body-label"
                        className="min-h-64 max-h-[45vh] overflow-auto rounded-md border border-border p-4"
                      >
                        {chapter.body ? (
                          <MathContent
                            content={chapter.body}
                            preserveHeadingLevels
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {text("This chapter is empty.", "本章正文为空。")}
                          </p>
                        )}
                      </div>
                    ) : (
                      <textarea
                        id="school-course-body"
                        aria-labelledby="school-course-body-label"
                        className={`${inputClass} min-h-64 resize-none py-3 font-mono leading-6`}
                        rows={12}
                        maxLength={100000}
                        value={chapter.body}
                        onChange={(event) =>
                          editChapter({ body: event.target.value })
                        }
                      />
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  {text(
                    "Add chapters to prepare this course for publication.",
                    "添加章节后即可准备发布课程。",
                  )}
                </p>
              )}
            </fieldset>
            {validation && (
              <p
                id="course-validation"
                role="alert"
                className="text-sm text-destructive"
              >
                {validation}
              </p>
            )}
            <Feedback action={mutation} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">
                {dirty
                  ? text("Unsaved changes", "有未保存修改")
                  : text("Draft", "草稿")}
                {initial?.status === "published" &&
                  text(
                    " · Changes appear after republishing",
                    " · 重新发布后修改才对学生生效",
                  )}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={mutation.busy}
                  onClick={requestClose}
                >
                  {text("Cancel", "取消")}
                </Button>
                <Button type="submit" disabled={mutation.busy}>
                  {text("Save draft", "保存草稿")}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {discard && (
        <Dialog open onOpenChange={setDiscard}>
          <DialogContent
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelDiscard.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              titleInput.current?.focus();
            }}
          >
            <DialogTitle>
              {text("Discard unsaved changes?", "放弃未保存的修改？")}
            </DialogTitle>
            <DialogDescription>
              {text(
                "Your course edits have not been saved. Keep editing or discard them to close.",
                "课程修改尚未保存。你可以继续编辑，或放弃修改并关闭。",
              )}
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <Button
                ref={cancelDiscard}
                variant="secondary"
                onClick={() => setDiscard(false)}
              >
                {text("Keep editing", "继续编辑")}
              </Button>
              <Button variant="danger" onClick={onClose}>
                {text("Discard changes", "放弃修改")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {removeChapter && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoveChapter(null);
          }}
        >
          <DialogContent
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelRemove.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              chapterTitle.current?.focus();
            }}
          >
            <DialogTitle>{text("Remove chapter", "移除章节")}</DialogTitle>
            <DialogDescription>
              {text(
                `Remove “${removeChapter.title}” from this draft? The published course remains unchanged until you publish again.`,
                `从草稿中移除「${removeChapter.title}」？重新发布前，已发布课程不受影响。`,
              )}
            </DialogDescription>
            <div className="flex justify-end gap-2">
              <Button
                ref={cancelRemove}
                variant="secondary"
                onClick={() => setRemoveChapter(null)}
              >
                {text("Cancel", "取消")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const chapters = form.chapters.filter(
                    (item) => item.id !== removeChapter.id,
                  );
                  setForm((previous) => ({ ...previous, chapters }));
                  setChapterId(chapters[0]?.id ?? "");
                  setRemoveChapter(null);
                }}
              >
                {text("Remove chapter", "移除章节")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function ClassPicker({
  schoolId,
  selected,
  onChange,
}: {
  schoolId: string;
  selected: string[];
  onChange: (classIds: string[]) => void;
}) {
  const text = useSchoolText();
  const [page, setPage] = useState(1);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          {text(
            `Selected classes: ${selected.length}/50`,
            `已选班级：${selected.length}/50`,
          )}
        </span>
        {selected.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange([])}
          >
            {text("Clear selection", "清空选择")}
          </Button>
        )}
      </div>
      <ClassPickerPage
        key={`${schoolId}:${page}`}
        schoolId={schoolId}
        page={page}
        selected={selected}
        onChange={onChange}
        onPage={setPage}
      />
    </div>
  );
}

function ClassPickerPage({
  schoolId,
  page,
  selected,
  onChange,
  onPage,
}: {
  schoolId: string;
  page: number;
  selected: string[];
  onChange: (classIds: string[]) => void;
  onPage: (page: number) => void;
}) {
  const text = useSchoolText();
  const resource = useData<CoursePage<{ id: string; name: string }>>(
    `schools/${schoolId}/classes?page=${page}`,
  );
  const range = useRangeSelection(
    resource.data?.items ?? [],
    `${schoolId}:${page}`,
  );
  const [limitReached, setLimitReached] = useState(false);
  return (
    <Loading resource={resource}>
      <div className="max-h-40 overflow-y-auto rounded-md border border-border">
        {(resource.data?.items ?? []).map((item) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-muted"
          >
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(event) => {
                const ids = range.getRange(item.id, event) ?? [item.id];
                const next = event.currentTarget.checked
                  ? [...new Set([...selected, ...ids])]
                  : selected.filter((id) => !ids.includes(id));
                if (next.length > 50) {
                  setLimitReached(true);
                  return;
                }
                setLimitReached(false);
                onChange(next);
              }}
            />
            <span className="min-w-0 break-words">{item.name}</span>
          </label>
        ))}
        {!resource.data?.items.length && (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {text(
              "No classes are available on this page.",
              "本页没有可选班级。",
            )}
          </p>
        )}
      </div>
      {limitReached && (
        <p role="alert" className="text-xs text-destructive">
          {text("Select up to 50 classes.", "最多选择 50 个班级。")}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {text("Previous", "上一页")}
        </Button>
        <span>{text(`Page ${page}`, `第 ${page} 页`)}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!resource.data?.hasMore}
          onClick={() => onPage(page + 1)}
        >
          {text("Next", "下一页")}
        </Button>
      </div>
    </Loading>
  );
}
