"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Feedback,
  State,
  input,
  useData,
  useMutation,
} from "@/components/student/shared";
import { productionApi } from "@/lib/production-api";
import { StudentAudienceSelector } from "@/components/teacher/student-audience-selector";
import type { AudienceDirectory } from "@/components/teacher/student-audience";
import {
  Paper4RewardFields,
  defaultPaper4RewardRule,
} from "./school-paper4-reward-rule";
import type { SchoolPaper4Paper } from "./school-paper4-model";

type PackageFile = { filename: string; contentBase64: string };
function readPackage(file: File): Promise<PackageFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read package."));
    reader.onload = () =>
      resolve({
        filename: file.name,
        contentBase64: String(reader.result).split(",")[1] ?? "",
      });
    reader.readAsDataURL(file);
  });
}
export function SchoolPaper4Import({
  base,
  onClose,
  onDone,
}: {
  base: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "zh" ? zh : en),
    action = useMutation();
  const [files, setFiles] = useState<PackageFile[]>([]),
    [preview, setPreview] = useState<
      {
        title?: string;
        questionCount?: number;
        totalMarks?: number;
        preview?: { title: string; questionCount: number; totalMarks: number };
        sourceFilename?: string;
      }[]
    >([]),
    request = useRef(crypto.randomUUID());
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
        <DialogTitle>
          {tx("批量导入 Paper 4", "Import Paper 4 papers")}
        </DialogTitle>
        <DialogDescription>
          {tx(
            "导入结构化 JSON 或 ZIP 题包，预览后创建本校草稿。",
            "Import structured JSON or ZIP packages. Preview before creating school drafts.",
          )}
        </DialogDescription>
        <label className="block text-sm font-medium">
          {tx("选择题包", "Choose packages")}
          <input
            type="file"
            accept=".json,.zip"
            multiple
            disabled={action.busy}
            className="mt-2 block w-full text-sm"
            onChange={(event) => {
              const chosen = [...(event.currentTarget.files ?? [])];
              setFiles([]);
              setPreview([]);
              request.current = crypto.randomUUID();
              void action.run(async () => {
                if (
                  chosen.length > 100 ||
                  chosen.reduce((sum, file) => sum + file.size, 0) >
                    8 * 1024 * 1024
                )
                  throw new Error(
                    tx(
                      "最多100个文件，合计不超过8 MiB。",
                      "Choose up to 100 files, totaling no more than 8 MiB.",
                    ),
                  );
                const prepared = await Promise.all(chosen.map(readPackage));
                const result = await productionApi<{ items: typeof preview }>(
                  `${base}/papers/import-preview`,
                  { method: "POST", body: { files: prepared } },
                );
                setFiles(prepared);
                setPreview(result.items);
              });
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {tx(
            "与原 Paper 4 导出格式兼容；原始 PDF 或普通 problems.json 应先转换为 Paper 4 题包。",
            "Compatible with existing Paper 4 exports. Raw PDFs and ordinary problems.json files must be converted to a Paper 4 package first.",
          )}
        </p>
        <Feedback action={action} />
        {preview.length > 0 && (
          <div className="max-h-64 overflow-auto rounded border border-border">
            <table className="w-full text-left text-sm">
              <tbody>
                {preview.map((item, index) => (
                  <tr
                    key={`${item.sourceFilename}:${index}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="p-2">
                      {item.preview?.title ?? item.title ?? item.sourceFilename}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {item.preview?.questionCount ?? item.questionCount ?? ""}{" "}
                      {tx("题", "questions")} ·{" "}
                      {item.preview?.totalMarks ?? item.totalMarks ?? 75}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={action.busy} onClick={onClose}>
            {tx("取消", "Cancel")}
          </Button>
          <Button
            disabled={action.busy || !preview.length}
            onClick={() =>
              void action.run(async () => {
                await productionApi(`${base}/papers/import`, {
                  method: "POST",
                  body: { requestId: request.current, files },
                });
                onDone();
              })
            }
          >
            {action.busy
              ? tx("处理中…", "Working…")
              : tx(
                  `创建 ${preview.length} 套草稿`,
                  `Create ${preview.length} drafts`,
                )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function SchoolPaper4Assign({
  base,
  papers,
  onClose,
  onDone,
}: {
  base: string;
  papers: SchoolPaper4Paper[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "zh" ? zh : en),
    action = useMutation(),
    audience = useData<{
      students: AudienceDirectory["items"];
      classes: AudienceDirectory["classes"];
    }>(`${base}/audience`);
  const [students, setStudents] = useState<string[]>([]),
    [kind, setKind] = useState<"practice" | "exam">("practice"),
    [startsAt, setStartsAt] = useState(""),
    [endsAt, setEndsAt] = useState("");
  const request = useRef(crypto.randomUUID()),
    signature = useRef("");
  const config = useData<{ activityRewardCap: number }>(
      `${base.replace(/\/paper4$/, "/scholarship")}/settings`,
    ),
    [reward, setReward] = useState(defaultPaper4RewardRule);
  function submit() {
    void action.run(async () => {
      const body = {
        paperIds: papers.map((p) => p.id),
        studentIdentityIds: students,
        kind,
        scholarshipRule: reward,
        startsAt: startsAt
          ? new Date(`${startsAt}:00+08:00`).toISOString()
          : null,
        endsAt: endsAt ? new Date(`${endsAt}:00+08:00`).toISOString() : null,
      };
      if (signature.current !== JSON.stringify(body)) {
        request.current = crypto.randomUUID();
        signature.current = JSON.stringify(body);
      }
      await productionApi(`${base}/activities`, {
        method: "POST",
        body: { ...body, requestId: request.current },
      });
      onDone();
    });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
        <DialogTitle>
          {tx(`布置 ${papers.length} 套试卷`, `Assign ${papers.length} papers`)}
        </DialogTitle>
        <DialogDescription>
          {tx(
            "统一选择学生、活动类型和时间。每套试卷生成独立活动，使用当前已发布版本。",
            "Choose recipients, activity type and schedule once. Each paper becomes a separate activity pinned to its published version.",
          )}
        </DialogDescription>
        <details className="rounded border border-border p-2 text-sm">
          <summary className="cursor-pointer">
            {tx("所选试卷", "Selected papers")} ({papers.length})
          </summary>
          <ul className="mt-1 max-h-32 overflow-auto">
            {papers.map((p) => (
              <li key={p.id} className="py-1">
                {p.title}
              </li>
            ))}
          </ul>
        </details>
        <State data={audience}>
          <StudentAudienceSelector
            students={audience.data?.students ?? []}
            classes={audience.data?.classes ?? []}
            selectedIds={students}
            onChange={setStudents}
            disabled={action.busy}
          />
        </State>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">
            {tx("活动类型", "Activity type")}
            <select
              className={`${input} mt-1`}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="practice">{tx("练习", "Practice")}</option>
              <option value="exam">{tx("模拟考试", "Mock exam")}</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            {tx("开始时间", "Starts at")}
            <input
              className={`${input} mt-1`}
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required={kind === "exam"}
            />
          </label>
          <label className="text-sm font-medium">
            {tx("结束时间", "Ends at")}
            <input
              className={`${input} mt-1`}
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required={kind === "exam"}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {tx(
            "时间采用 Asia/Shanghai (UTC+8)。模拟考试必须设置时间，成绩公布前限制答案开放。",
            "Times use Asia/Shanghai (UTC+8). Mock exams require a schedule; answers stay restricted until results are released.",
          )}
        </p>
        <State data={config}>
          {config.data && (
            <Paper4RewardFields
              value={reward}
              onChange={setReward}
              cap={config.data.activityRewardCap}
              maximumQuestions={Math.min(...papers.map((p) => p.questionCount))}
              disabled={action.busy}
            />
          )}
        </State>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={action.busy} onClick={onClose}>
            {tx("取消", "Cancel")}
          </Button>
          <Button
            disabled={
              action.busy ||
              !config.data ||
              !students.length ||
              (kind === "exam" && (!startsAt || !endsAt))
            }
            onClick={submit}
          >
            {action.busy
              ? tx("布置中…", "Assigning…")
              : tx(
                  `布置 ${papers.length} 套试卷`,
                  `Assign ${papers.length} papers`,
                )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
