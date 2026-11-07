"use client";

import { useRef, useState } from "react";
import { Eye, RefreshCw, Search } from "lucide-react";
import {
  Feedback,
  inputClass,
  Loading,
  useData,
} from "@/components/admin/common";
import { MathContent } from "@/components/math-content";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

type CoursePublication = {
  schoolId: string;
  schoolName: string;
  courseId: string;
  revision: number;
  sourceVersion?: string;
  title: string;
  description: string;
  chapters: { id: string; title: string; body: string }[];
  listingId: string | null;
  published: boolean;
  listingActive?: boolean;
  approvedRevision?: number | null;
  admissionMode?: "application" | "direct" | null;
  chapterCount?: number;
  canPublishDirect?: boolean;
};

export function PublicCourseReview() {
  const text = useSchoolText();
  const data = useData<{ items: CoursePublication[] }>(
    "platform/course-publications",
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<CoursePublication | null>(null);
  const [message, setMessage] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const items = (data.data?.items || []).filter(
    (item) =>
      (filter === "all" ||
        (filter === "published" ? item.published
          : filter === "application" ? item.admissionMode === "application"
          : !item.published && item.canPublishDirect !== false)) &&
      `${item.title} ${item.schoolName}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  function close() {
    setSelected(null);
    requestAnimationFrame(
      () => trigger.current?.isConnected && trigger.current.focus(),
    );
  }
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {text(
          "Review a school's published course before opening it to all registered learners.",
          "核对学校已发布的课程内容后，可向所有注册用户开放。",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-40 flex-1 sm:max-w-sm">
          <span className="sr-only">
            {text("Search courses or schools", "搜索课程或学校")}
          </span>
          <Search
            size={15}
            className="absolute left-3 top-3 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            className={`${inputClass} pl-9`}
            value={search}
            placeholder={text("Search courses or schools", "搜索课程或学校")}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">
            {text("Publication status", "发布状态")}
          </span>
          <select
            className={inputClass}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">{text("All statuses", "全部状态")}</option>
            <option value="pending">{text("Needs review", "待审核")}</option>
            <option value="application">{text("Applications open", "已开放申请")}</option>
            <option value="published">{text("Published", "已公开")}</option>
          </select>
        </label>
        <Button variant="secondary" onClick={data.reload}>
          <RefreshCw size={14} aria-hidden="true" />
          {text("Refresh", "刷新")}
        </Button>
      </div>
      <Feedback action={{ error: "", message }} />
      <Loading resource={data}>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">{text("Course", "课程")}</th>
                <th className="px-4 py-2">{text("School", "学校")}</th>
                <th className="px-4 py-2">{text("Status", "状态")}</th>
                <th className="px-4 py-2">{text("Review", "审核")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={`${item.schoolId}:${item.courseId}`}>
                  <td className="max-w-sm px-4 py-2">
                    <p className="break-words font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {text(
                        `${item.chapterCount ?? item.chapters.length} chapters · Version ${item.revision}`,
                        `${item.chapterCount ?? item.chapters.length} 章 · 版本 ${item.revision}`,
                      )}
                    </p>
                  </td>
                  <td className="max-w-52 break-words px-4 py-2">
                    {item.schoolName}
                  </td>
                  <td className="px-4 py-2">
                    <p
                      className={
                        item.published
                          ? "text-success"
                          : "text-muted-foreground"
                      }
                    >
                      {item.published
                        ? text("Published", "已公开")
                        : item.admissionMode === "application"
                          ? text("Applications open", "已开放申请")
                        : text("Needs review", "待审核")}
                    </p>
                    {!item.listingActive && item.approvedRevision != null && (
                      <p className="text-xs text-muted-foreground">
                        {text(
                          `Version ${item.approvedRevision} was previously listed`,
                          `版本 ${item.approvedRevision} 曾上架`,
                        )}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(event) => {
                        trigger.current = event.currentTarget;
                        setMessage("");
                        setSelected(item);
                      }}
                    >
                      <Eye size={14} aria-hidden="true" />
                      {text("Preview", "预览")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <p className="p-5 text-sm text-muted-foreground">
              {text(
                "No courses match this filter.",
                "没有符合条件的课程。",
              )}
            </p>
          )}
        </div>
      </Loading>
      {selected && (
        <CourseReviewDialog
          key={`${selected.courseId}:${selected.revision}`}
          course={selected}
          onClose={close}
          onSaved={(published) => {
            close();
            data.reload();
            setMessage(
              published
                ? text(
                    "Course approved and added to the public course catalog.",
                    "课程已审核并上架到公开课程目录。",
                  )
                : text(
                    "Course withdrawn from the public catalog. School access and learning records are preserved.",
                    "课程已从公开目录撤回，学校内访问和学习记录保留。",
                  ),
            );
          }}
        />
      )}
    </section>
  );
}

function CourseReviewDialog({
  course,
  onClose,
  onSaved,
}: {
  course: CoursePublication;
  onClose: () => void;
  onSaved: (published: boolean) => void;
}) {
  const text = useSchoolText();
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const pending = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const chapter = course.chapters[index];
  const active = course.listingActive ?? course.published;
  async function publish(approved: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await productionApi(
        approved
          ? "platform/course-publications"
          : `platform/course-publications/${course.listingId}`,
        {
          method: approved ? "POST" : "DELETE",
          ...(approved && {
            body: {
              schoolId: course.schoolId,
              courseId: course.courseId,
              revision: course.revision,
              ...(course.sourceVersion && { sourceVersion: course.sourceVersion }),
            },
          }),
        },
      );
      onSaved(approved);
    } catch (cause) {
      setError(
        cause instanceof ApiError &&
          ["NOT_PUBLISHED", "REVISION_CONFLICT"].includes(cause.code)
          ? text(
              "This course changed after the preview loaded. Close and refresh the list before reviewing again.",
              "课程在预览后已变化，请关闭并刷新列表后重新审核。",
            )
          : text(
              "Could not update publication. Check your access and connection, then try again.",
              "未能更新发布状态，请核对权限和网络后重试。",
            ),
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] max-w-4xl flex-col gap-3"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="pr-8 leading-snug">{course.title}</DialogTitle>
        <DialogDescription>
          {course.schoolName} ·{" "}
          {text(`Version ${course.revision}`, `版本 ${course.revision}`)}
        </DialogDescription>
        {withdrawing ? (
          <p className="text-sm">
            {text(
              "Withdraw this course from the public catalog? Its school access and student records will remain.",
              "从公开课程目录撤回此课程？学校内访问及学生记录会保留。",
            )}
          </p>
        ) : (
          <>
            {course.description && (
              <p className="max-h-20 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                {course.description}
              </p>
            )}
            {course.canPublishDirect === false ? (
              <p className="text-sm text-muted-foreground">
                {text("The school limits this course to selected classes and approved applicants.",
                  "学校仅向指定班级和获批申请者开放这门课程。")}
              </p>
            ) : <>
            <label className="flex items-center gap-2 text-sm">
              <span className="shrink-0 font-medium">
                {text("Chapter", "章节")}
              </span>
              <select
                className={inputClass}
                value={index}
                onChange={(event) => setIndex(Number(event.target.value))}
                disabled={busy}
              >
                {course.chapters.map((item, i) => (
                  <option key={item.id} value={i}>
                    {i + 1}. {item.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="min-h-32 overflow-y-auto rounded-md border border-border p-4">
              {chapter ? (
                <MathContent content={chapter.body} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {text("This course has no chapters.", "此课程暂无章节。")}
                </p>
              )}
            </div>
            </>}
          </>
        )}
        {error && (
          <p
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="text-sm text-destructive outline-none"
          >
            {error}
          </p>
        )}
        <div
          className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border pt-3"
          aria-busy={busy}
        >
          {withdrawing ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setWithdrawing(false)}
              >
                {text("Keep public", "保留公开")}
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void publish(false)}
              >
                {busy
                  ? text("Withdrawing…", "撤回中…")
                  : text("Withdraw from public catalog", "从公开目录撤回")}
              </Button>
            </>
          ) : (
            <>
              {active && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setWithdrawing(true)}
                >
                  {text("Withdraw", "撤回公开")}
                </Button>
              )}
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                {text("Close", "关闭")}
              </Button>
              {!course.published && course.canPublishDirect !== false && (
                <Button
                  disabled={busy || !chapter}
                  onClick={() => void publish(true)}
                >
                  {busy
                    ? text("Publishing…", "发布中…")
                    : text("Approve and publish", "审核通过并公开")}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
