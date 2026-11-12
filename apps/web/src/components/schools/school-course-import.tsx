"use client";
import { useState } from "react";
import { parseLearningMarkdown } from "@/components/teacher/learning-document";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSchoolText } from "./school-ui";
import type { CourseInput } from "./school-courses-model";

export function SchoolCourseImport({
  onClose,
  onPrepared,
}: {
  onClose: () => void;
  onPrepared: (draft: CourseInput) => void;
}) {
  const text = useSchoolText();
  const [draft, setDraft] = useState<CourseInput | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogTitle>
          {text("Import course Markdown", "导入课程 Markdown")}
        </DialogTitle>
        <DialogDescription>
          {text(
            "Review the imported chapters, then save an editable draft. Nothing is published automatically.",
            "预览导入章节后保存为可编辑草稿，不会自动发布。",
          )}
        </DialogDescription>
        <a
          href="/learning-path-format.md"
          download
          className="text-sm font-medium text-primary hover:underline"
        >
          {text("Download format guide", "下载格式说明")}
        </a>
        <label className="text-sm font-medium">
          {text("Course Markdown file", "课程 Markdown 文件")}
          <input
            type="file"
            accept=".md,.markdown,text/markdown"
            disabled={busy}
            className="mt-2 block w-full text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setDraft(null);
              setError("");
              if (!file) return;
              setBusy(true);
              try {
                if (file.size > 1572864)
                  throw Error(
                    text("The file exceeds 1.5 MiB.", "文件超过 1.5 MiB。"),
                  );
                const doc = parseLearningMarkdown(await file.text());
                if (
                  doc.chapters.some(
                    (c) =>
                      c.problemIds.length ||
                      c.paper4Links?.length ||
                      c.checkpointAnswer.trim(),
                  )
                )
                  throw Error(
                    text(
                      "This file includes legacy problem links, Paper 4 links or private checkpoint answers. Remove those fields before import; link this school's published practice in the editor.",
                      "文件包含旧题目引用、Paper 4 引用或检查点私有答案。请移除这些字段后导入，再在编辑器中关联本校已发布练习。",
                    ),
                  );
                setDraft({
                  title: doc.title,
                  description: doc.description,
                  localizations: doc.localizations,
                  category: doc.category,
                  requiredLanguage: doc.requiredLanguage,
                  difficulty: doc.difficulty ?? "beginner",
                  coverKey: doc.coverKey ?? "general",
                  coverImage: doc.coverImage ?? null,
                  estimatedMinutes: doc.estimatedMinutes,
                  authorName: doc.authorName ?? "",
                  authoredAt: doc.authoredAt ?? null,
                  accessScope: "school",
                  classIds: [],
                  chapters: doc.chapters.map((c) => ({
                    id: crypto.randomUUID(),
                    title: c.title,
                    localizations: c.localizations,
                    acslLinks: c.acslLinks,
                    body: [
                      c.objective &&
                        `## ${text("Learning objective", "学习目标")}\n\n${c.objective}`,
                      c.content,
                      c.checkpoint &&
                        `## ${text("Checkpoint", "检查点")}\n\n${c.checkpoint}`,
                    ]
                      .filter(Boolean)
                      .join("\n\n"),
                    problems: [],
                  })),
                });
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : text("Unable to read this document.", "无法读取此文档。"),
                );
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {draft && (
          <section className="max-h-56 overflow-auto rounded-md border border-border p-3">
            <h3 className="font-semibold">{draft.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {draft.description}
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm">
              {draft.chapters.map((c) => (
                <li key={c.id}>{c.title}</li>
              ))}
            </ol>
          </section>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {text("Cancel", "取消")}
          </Button>
          <Button
            disabled={!draft || busy}
            onClick={() => {
              if (draft) onPrepared(draft);
            }}
          >
            {text("Review draft", "核对草稿")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
