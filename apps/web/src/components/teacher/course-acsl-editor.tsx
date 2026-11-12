"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { useCourseLanguage } from "@/components/course-language";
import {
  courseAcslKey,
  courseAcslLabel,
  type CourseAcslCandidate,
  type CourseAcslLink,
} from "@/components/course-acsl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loading, useData } from "@/components/admin/common";
import { input } from "./shared";

export function CourseAcslEditor({
  schoolId,
  links,
  onChange,
  disabled = false,
}: {
  schoolId: string;
  links: CourseAcslLink[];
  onChange: (links: CourseAcslLink[]) => void;
  disabled?: boolean;
}) {
  const { locale } = useLocale(),
    { language } = useCourseLanguage(),
    [open, setOpen] = useState(false);
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  return (
    <section
      className="rounded-md border border-border"
      data-od-id="course-acsl-editor"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-subtle p-3">
        <h3 className="text-sm font-semibold">
          {tx("ACSL practice links", "ACSL 真题关联")}
        </h3>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Plus size={14} />
          {tx("Link practice", "关联真题")}
        </Button>
      </div>
      <p className="px-3 py-2 text-xs leading-6 text-muted-foreground">
        {tx(
          "Link a written question, the written section, or programming. Students submit and review in ACSL; course progress uses their existing results.",
          "可关联笔试单题、整卷笔试或编程题。学生在 ACSL 中交卷和复盘，课程进度使用已有答题结果。",
        )}
      </p>
      {links.map((link) => (
        <div
          key={courseAcslKey(link)}
          className="flex items-start justify-between gap-3 border-t border-border p-3 text-sm"
        >
          <div className="min-w-0">
            <p className="break-words">{courseAcslLabel(link, language)}</p>
            {link.available === false && (
              <p className="mt-1 text-xs text-warning">
                {tx(
                  "This linked edition is unavailable; remove it or choose another edition.",
                  "关联版本暂不可用，请移除或重新选择版本。",
                )}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={tx("Remove practice link", "移除真题关联")}
            onClick={() =>
              onChange(
                links.filter(
                  (item) => courseAcslKey(item) !== courseAcslKey(link),
                ),
              )
            }
          >
            <Trash2 size={15} />
          </Button>
        </div>
      ))}
      {open && (
        <CourseAcslPicker
          schoolId={schoolId}
          existing={links}
          onClose={() => setOpen(false)}
          onAdd={(link) => {
            onChange([...links, link]);
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}

function CourseAcslPicker({
  schoolId,
  existing,
  onClose,
  onAdd,
}: {
  schoolId: string;
  existing: CourseAcslLink[];
  onClose: () => void;
  onAdd: (link: CourseAcslLink) => void;
}) {
  const resource = useData<{ items: CourseAcslCandidate[] }>(
    `schools/${schoolId}/acsl/links`,
  );
  const { locale } = useLocale(),
    { language } = useCourseLanguage(),
    tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const [division, setDivision] = useState(""),
    [season, setSeason] = useState(""),
    [paperId, setPaperId] = useState(""),
    [target, setTarget] = useState("written");
  const candidates = (resource.data?.items ?? []).filter(
    (item) =>
      (!division || item.division === division) &&
      (!season || item.season === season),
  );
  const paper =
    candidates.find((item) => item.paperId === paperId) ?? candidates[0];
  const validTarget =
    (target === "programming" && !paper?.hasProgramming) ||
    (target.startsWith("q:") &&
      !paper?.questions.some((q) => target === `q:${q.id}`))
      ? "written"
      : target;
  const kind = validTarget.startsWith("q:")
    ? "question"
    : (validTarget as "written" | "programming");
  const question = paper?.questions.find((q) => validTarget === `q:${q.id}`);
  const link: CourseAcslLink | null = paper
    ? {
        paperSlug: paper.paperSlug,
        paperId: paper.paperId,
        versionId: paper.versionId,
        title: paper.title,
        kind,
        ...(question
          ? { questionId: question.id, questionNumber: question.number }
          : {}),
        available: true,
      }
    : null;
  const duplicate =
    link &&
    existing.some((item) => courseAcslKey(item) === courseAcslKey(link));
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogTitle>{tx("Link ACSL practice", "关联 ACSL 真题")}</DialogTitle>
        <DialogDescription>
          {tx(
            "Choose a paper and practice target. The linked edition is saved with this chapter.",
            "选择试卷及练习范围，关联版本随章节保存。",
          )}
        </DialogDescription>
        <Loading resource={resource}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                {tx("Division", "组别")}
                <select
                  className={input}
                  value={division}
                  onChange={(e) => setDivision(e.target.value)}
                >
                  <option value="">{tx("All divisions", "全部组别")}</option>
                  {["Elementary", "Junior", "Intermediate", "Senior"].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                {tx("Season", "学年")}
                <select
                  className={input}
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                >
                  <option value="">{tx("All seasons", "全部学年")}</option>
                  {[...new Set(resource.data?.items.map((item) => item.season))]
                    .sort()
                    .reverse()
                    .map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              {tx("Paper", "试卷")}
              <select
                data-od-id="course-acsl-paper"
                className={input}
                value={paper?.paperId ?? ""}
                onChange={(e) => setPaperId(e.target.value)}
              >
                {candidates.map((item) => (
                  <option key={item.paperId} value={item.paperId}>
                    {item.title[language]}
                  </option>
                ))}
              </select>
            </label>
            {paper ? (
              <label className="grid gap-1 text-sm">
                {tx("Practice target", "练习范围")}
                <select
                  data-od-id="course-acsl-target"
                  className={input}
                  value={validTarget}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="written">
                    {tx("Whole written section", "整卷笔试")}
                  </option>
                  {paper.questions.map((q) => (
                    <option key={q.id} value={`q:${q.id}`}>
                      {tx(`Question ${q.number}`, `第 ${q.number} 题`)} ·{" "}
                      {q.topic[language]}
                    </option>
                  ))}
                  {paper.hasProgramming && (
                    <option value="programming">
                      {tx("Programming", "编程题")}
                    </option>
                  )}
                </select>
              </label>
            ) : (
              <p className="text-sm text-muted-foreground">
                {tx(
                  "No available papers match these filters.",
                  "没有符合筛选条件的可用试卷。",
                )}
              </p>
            )}
            {duplicate && (
              <p role="status" className="text-sm text-muted-foreground">
                {tx("This practice is already linked.", "本章已关联此练习。")}
              </p>
            )}
          </div>
        </Loading>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tx("Cancel", "取消")}
          </Button>
          <Button
            type="button"
            data-od-id="course-acsl-add"
            disabled={
              !link ||
              Boolean(duplicate) ||
              resource.loading ||
              Boolean(resource.error)
            }
            onClick={() => {
              if (link) onAdd(link);
            }}
          >
            {tx("Add link", "添加关联")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
