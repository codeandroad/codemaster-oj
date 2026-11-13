"use client";
import { RowActionButton } from "@/components/ui/row-action";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  Feedback,
  inputClass,
  Loading,
  useData,
  useMutation,
} from "@/components/admin/common";
import { useData as useOptionalData } from "@/components/student/shared";
import { MathContent } from "@/components/math-content";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";
import type {
  CourseDetail,
  CoursePage,
  SchoolCourse,
} from "./school-courses-model";

type Resource = {
  id: string;
  title: string;
  type: "note" | "article" | "reference";
  scope: "school" | "private";
  courseId: string | null;
  chapterId: string | null;
  courseTitle: string | null;
  chapterTitle: string | null;
  revision: number;
  canManage: boolean;
  content?: string;
};
export function SchoolLearningResources({
  schoolId,
  canAuthor,
  creating = false,
  onCreated,
  courseId,
  chapterId,
  hideEmpty = false,
}: {
  schoolId: string;
  canAuthor: boolean;
  creating?: boolean;
  onCreated?: () => void;
  courseId?: string;
  chapterId?: string;
  hideEmpty?: boolean;
}) {
  const text = useSchoolText();
  const base = `schools/${schoolId}/learning-resources`;
  const list = useData<{ items: Resource[] }>(
    `${base}${courseId ? `?courseId=${courseId}` : ""}`,
  );
  const [selected, setSelected] = useState<Resource | null>(null);
  const [removing, setRemoving] = useState<Resource | null>(null);
  const mutation = useMutation();
  const pending = useRef(false);
  const types = {
    note: text("Note", "说明"),
    article: text("Code snippet", "代码片段"),
    reference: text("Reference", "参考资料"),
  };
  const items = (list.data?.items ?? []).filter(
    (r) => !chapterId || !r.chapterId || r.chapterId === chapterId,
  );
  if (hideEmpty && !list.loading && !list.error && !items.length) return null;
  return (
    <>
      <Feedback action={mutation} />
      <Loading resource={list}>
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-border bg-surface-subtle text-xs text-muted-foreground">
              <tr>
                {[
                  text("Type", "类型"),
                  text("Title", "标题"),
                  text("Course / chapter", "关联课程 / 章节"),
                  text("Visibility", "可见范围"),
                  text("Actions", "操作"),
                ].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">{types[r.type]}</td>
                  <td className="px-4 py-3">
                    <button
                      className="text-left font-semibold text-primary hover:underline"
                      onClick={() => setSelected(r)}
                    >
                      {r.title}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.courseTitle ?? text("Standalone resource", "独立资料")}
                    {r.chapterTitle && (
                      <span className="block text-muted-foreground">
                        {r.chapterTitle}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.scope === "school"
                      ? text("School students", "本校学生")
                      : text("Maintainer only", "维护教师")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <RowActionButton
                        onClick={() => setSelected(r)}
                      >
                        {r.canManage
                          ? text("View / edit", "查看 / 编辑")
                          : text("Read", "阅读")}
                      </RowActionButton>
                      {r.canManage && (
                        <RowActionButton
                          onClick={() => setRemoving(r)}
                        >
                          {text("Delete", "删除")}
                        </RowActionButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    {text("No learning resources yet.", "暂无学习资料。")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Loading>
      {(selected || creating) && (
        <ResourceLoader
          key={selected?.id ?? "new"}
          base={base}
          schoolId={schoolId}
          id={selected?.id}
          canAuthor={canAuthor}
          onClose={() => {
            setSelected(null);
            onCreated?.();
          }}
          onSaved={() => {
            setSelected(null);
            onCreated?.();
            list.reload();
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending.current) setRemoving(null);
          }}
        >
          <DialogContent>
            <DialogTitle>
              {text("Delete learning resource", "删除学习资料")}
            </DialogTitle>
            <DialogDescription>
              {text(
                "The resource will no longer be visible. Courses, practice and learning records are preserved.",
                "资料将不再显示，课程、练习及学习记录保留。",
              )}
            </DialogDescription>
            <p className="font-medium">{removing.title}</p>
            <Feedback action={mutation} />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={mutation.busy}
                onClick={() => setRemoving(null)}
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
                      await productionApi(`${base}/${removing.id}`, {
                        method: "DELETE",
                        body: { expectedRevision: removing.revision },
                      });
                      setRemoving(null);
                      list.reload();
                    });
                  } finally {
                    pending.current = false;
                  }
                }}
              >
                {text("Delete", "删除")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
function ResourceLoader({
  base,
  schoolId,
  id,
  canAuthor,
  onClose,
  onSaved,
}: {
  base: string;
  schoolId: string;
  id?: string;
  canAuthor: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = useSchoolText();
  const resource = useOptionalData<Resource>(id ? `${base}/${id}` : "");
  const closeGuardRef = useRef<() => boolean>(() => true);
  function requestClose() {
    if (closeGuardRef.current()) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogTitle>
          {id
            ? text("Learning resource", "学习资料")
            : text("Add learning resource", "添加学习资料")}
        </DialogTitle>
        <DialogDescription>
          {text(
            "Markdown notes, code snippets and reference materials.",
            "Markdown 说明、代码片段与参考资料。",
          )}
        </DialogDescription>
        {id ? (
          <Loading resource={resource}>
            {resource.data && (
              <ResourceForm
                base={base}
                schoolId={schoolId}
                initial={resource.data}
                onClose={requestClose}
                onSaved={onSaved}
                closeGuardRef={closeGuardRef}
              />
            )}
          </Loading>
        ) : (
          canAuthor && (
            <ResourceForm
              base={base}
              schoolId={schoolId}
              onClose={requestClose}
              onSaved={onSaved}
              closeGuardRef={closeGuardRef}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
function ResourceForm({
  base,
  schoolId,
  initial,
  onClose,
  onSaved,
  closeGuardRef,
}: {
  base: string;
  schoolId: string;
  initial?: Resource;
  onClose: () => void;
  onSaved: () => void;
  closeGuardRef: MutableRefObject<() => boolean>;
}) {
  const text = useSchoolText(),
    mutation = useMutation(),
    pending = useRef(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    type: initial?.type ?? "note",
    scope: initial?.scope ?? "private",
    content: initial?.content ?? "",
    courseId: initial?.courseId ?? "",
    chapterId: initial?.chapterId ?? "",
  });
  const [baseline] = useState(() => JSON.stringify(form));
  const dirty = JSON.stringify(form) !== baseline;
  const discardPrompt = text(
    "Discard unsaved resource changes?",
    "放弃尚未保存的学习资料修改？",
  );
  useEffect(() => {
    closeGuardRef.current = () =>
      !pending.current && (!dirty || window.confirm(discardPrompt));
    return () => {
      closeGuardRef.current = () => true;
    };
  }, [closeGuardRef, dirty, discardPrompt]);
  const [courses, setCourses] = useState<SchoolCourse[]>([]);
  const [courseError, setCourseError] = useState("");
  const [preview, setPreview] = useState(false);
  const editable = !initial || initial.canManage;
  const detail = useOptionalData<CourseDetail>(
    form.courseId ? `schools/${schoolId}/courses/${form.courseId}` : "",
  );
  const courseLoadError = text(
    "Unable to load course choices. Reopen this dialog to retry.",
    "无法加载课程选项，请重新打开此对话框重试。",
  );
  useEffect(() => {
    if (!editable) return;
    let active = true;
    (async () => {
      try {
        let page = 1,
          more = true;
        const all: SchoolCourse[] = [];
        while (more) {
          const data = await productionApi<CoursePage<SchoolCourse>>(
            `schools/${schoolId}/courses?page=${page++}`,
          );
          all.push(...data.items.filter((c) => c.canManage && !c.archived));
          more = data.hasMore;
        }
        if (active) setCourses(all);
      } catch {
        if (active) setCourseError(courseLoadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [schoolId, editable, courseLoadError]);
  if (!editable)
    return (
      <>
        <MathContent content={initial?.content ?? ""} preserveHeadingLevels />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {text("Close", "关闭")}
          </Button>
        </div>
      </>
    );
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending.current) return;
        pending.current = true;
        try {
          await mutation.run(async () => {
            await productionApi(initial ? `${base}/${initial.id}` : base, {
              method: initial ? "PATCH" : "POST",
              body: {
                ...form,
                courseId: form.courseId || null,
                chapterId: form.chapterId || null,
                ...(initial
                  ? { expectedRevision: initial.revision }
                  : { requestId }),
              },
            });
            onSaved();
          });
        } finally {
          pending.current = false;
        }
      }}
    >
      <fieldset disabled={mutation.busy} className="space-y-3">
        <label className="block text-sm font-medium">
          {text("Title", "标题")}
          <input
            autoFocus
            required
            maxLength={200}
            className={`${inputClass} mt-1`}
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {text("Type", "类型")}
            <select
              className={`${inputClass} mt-1`}
              value={form.type}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  type: e.target.value as Resource["type"],
                }))
              }
            >
              <option value="note">{text("Note", "说明")}</option>
              <option value="article">
                {text("Code snippet", "代码片段")}
              </option>
              <option value="reference">{text("Reference", "参考资料")}</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            {text("Visibility", "可见范围")}
            <select
              className={`${inputClass} mt-1`}
              value={form.scope}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  scope: e.target.value as Resource["scope"],
                }))
              }
            >
              <option value="private">
                {text("Maintainer only", "维护教师")}
              </option>
              <option value="school">
                {text("School students", "本校学生")}
              </option>
            </select>
          </label>
          <label className="text-sm font-medium">
            {text("Course", "课程")}
            <select
              className={`${inputClass} mt-1`}
              value={form.courseId}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  courseId: e.target.value,
                  chapterId: "",
                }))
              }
            >
              <option value="">
                {text("Standalone resource", "独立资料")}
              </option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            {text("Chapter", "章节")}
            <select
              className={`${inputClass} mt-1`}
              disabled={!form.courseId || detail.loading}
              value={form.chapterId}
              onChange={(e) =>
                setForm((p) => ({ ...p, chapterId: e.target.value }))
              }
            >
              <option value="">{text("All chapters", "全部章节")}</option>
              {detail.data?.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        {courseError && (
          <p role="alert" className="text-sm text-destructive">
            {courseError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {text(
            "Linked resources follow the course and chapter audience. Private materials stay with the maintainer.",
            "关联资料遵循课程与章节的可见范围，私有资料仅供维护人员使用。",
          )}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {text("Content · Markdown", "正文 · Markdown")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPreview((v) => !v)}
          >
            {preview ? text("Write", "编辑") : text("Preview", "预览")}
          </Button>
        </div>
        {preview ? (
          <div className="min-h-40 rounded-md border border-border p-4">
            <MathContent content={form.content} preserveHeadingLevels />
          </div>
        ) : (
          <textarea
            aria-label={text("Resource content", "资料正文")}
            rows={9}
            maxLength={100000}
            className={`${inputClass} font-mono`}
            value={form.content}
            onChange={(e) =>
              setForm((p) => ({ ...p, content: e.target.value }))
            }
          />
        )}
      </fieldset>
      <Feedback action={mutation} />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={mutation.busy}
          onClick={onClose}
        >
          {text("Cancel", "取消")}
        </Button>
        <Button disabled={mutation.busy}>
          {text("Save resource", "保存资料")}
        </Button>
      </div>
    </form>
  );
}
