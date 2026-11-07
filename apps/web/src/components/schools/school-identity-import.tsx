"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import {
  Feedback,
  inputClass,
  Loading,
  useData,
} from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, productionApi } from "@/lib/production-api";
import { useSchoolError, useSchoolText, type School } from "./school-ui";
import {
  IdentityImportParseError,
  parseIdentityFile,
  schoolIdentityCsvTemplate,
  type IdentityImportParseCode,
  type IdentityImportRow,
} from "./school-identity-import-parser";

type IdentityKind = "student" | "teacher";
type ClassChoice = { id: string; name: string; type?: string };
type ImportStatus =
  | "create"
  | "existing"
  | "duplicate"
  | "conflict"
  | "invalid";
type ImportSummary = {
  total: number;
  created: number;
  existing: number;
  duplicates: number;
  rosterAdded: number;
};
type ImportBody = {
  kind: IdentityKind;
  rows: IdentityImportRow[];
  classId: string | null;
};
type ImportPreview = {
  items: (IdentityImportRow & {
    line: number;
    status: ImportStatus;
    message?: string;
  })[];
  summary: ImportSummary & { errors: number };
  canCommit: boolean;
  previewToken: string | null;
  expiresAt: string | null;
};
type PreviewState = { data: ImportPreview; body: ImportBody };
type ImportResult = { batchId: string; summary: ImportSummary };
const PREVIEW_PAGE_SIZE = 20;

export function SchoolIdentityImport({
  school,
  initialClass = null,
  studentClassOnly = false,
  onClose,
  onSaved,
}: {
  school: School;
  initialClass?: ClassChoice | null;
  studentClassOnly?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const text = useSchoolText();
  const schoolError = useSchoolError();
  const [kind, setKind] = useState<IdentityKind>("student");
  const [selectedClass, setSelectedClass] = useState<ClassChoice | null>(
    initialClass,
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState("");
  const [fileInvalid, setFileInvalid] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const commitLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const base = `schools/${school.id}`;

  useEffect(
    () => () => {
      generation.current += 1;
      request.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (preview) cancel.current?.focus();
  }, [preview]);

  function resetPreview() {
    generation.current += 1;
    request.current?.abort();
    setPending(null);
    setPreview(null);
    setPage(1);
    setError("");
    setFileInvalid(false);
    setUncertain(false);
  }

  function parseError(code: IdentityImportParseCode) {
    const messages: Record<IdentityImportParseCode, string> = {
      FILE_TYPE: text(
        "Choose a CSV or XLSX file.",
        "请选择 CSV 或 XLSX 文件。",
      ),
      FILE_SIZE: text(
        "The file exceeds 2 MB. Split it into smaller files.",
        "文件超过 2 MB，请拆分后导入。",
      ),
      EMPTY_FILE: text(
        "Add at least one data row below the header.",
        "请在表头下添加至少一行身份资料。",
      ),
      CSV_FORMAT: text(
        "The CSV contains unmatched or misplaced quotes. Save a valid CSV and try again.",
        "CSV 中的引号格式不正确，请重新保存为有效的 CSV 后重试。",
      ),
      HEADER: text(
        "Use exactly two columns named number and name. Download the template for an example.",
        "请仅使用 number 和 name 两列表头，可下载模板查看格式。",
      ),
      ROW_LIMIT: text(
        "Import at most 500 data rows at a time. Split this file.",
        "每次最多导入 500 行数据，请拆分文件。",
      ),
      COLUMNS: text(
        "Keep only the number and name columns; choose the role and class here.",
        "请仅保留 number 和 name 两列，并在此选择角色及班级。",
      ),
      WORKBOOK: text(
        "The workbook could not be read. Save an XLSX with data on its first worksheet, or use CSV.",
        "无法读取工作簿，请将数据放在 XLSX 的第一个工作表中，或改用 CSV。",
      ),
      FORMULA: text(
        "Replace spreadsheet formulas with text values before importing.",
        "请先将表格中的公式转换为文本值再导入。",
      ),
    };
    return messages[code];
  }

  async function loadPreview() {
    if (commitLock.current || pending || uncertain) return;
    if (!file) {
      setFileInvalid(true);
      setError(text("Choose a file to preview.", "请先选择需要预览的文件。"));
      fileInput.current?.focus();
      return;
    }
    const current = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setPending("preview");
    setError("");
    setFileInvalid(false);
    setPreview(null);
    try {
      const rows = await parseIdentityFile(file);
      if (generation.current !== current) return;
      const body: ImportBody = {
        kind,
        rows,
        classId: selectedClass?.id ?? null,
      };
      const data = await productionApi<ImportPreview>(
        `${base}/identity-imports/preview`,
        {
          method: "POST",
          body,
          signal: controller.signal,
        },
      );
      if (generation.current !== current) return;
      setPreview({ data, body });
      setPage(1);
    } catch (cause) {
      if (generation.current !== current) return;
      if (cause instanceof IdentityImportParseError) {
        setFileInvalid(true);
        setError(parseError(cause.code));
        fileInput.current?.focus();
      } else if (
        cause instanceof ApiError &&
        cause.code === "IMPORT_INVALID_ROWS"
      ) {
        setError(
          text(
            "The import data is invalid. Use a student or teacher role and 1–500 rows with number and name, then preview again.",
            "导入资料无效。请选择学生或教师角色，并提供 1–500 行包含 number 和 name 的数据后重新预览。",
          ),
        );
      } else setError(schoolError(cause).message);
    } finally {
      if (generation.current === current) setPending(null);
    }
  }

  async function commit() {
    if (
      commitLock.current ||
      pending ||
      !preview?.data.canCommit ||
      !preview.data.previewToken
    )
      return;
    commitLock.current = true;
    const current = ++generation.current;
    setPending("commit");
    setError("");
    try {
      const result = await productionApi<ImportResult>(
        `${base}/identity-imports/commit`,
        {
          method: "POST",
          body: { ...preview.body, previewToken: preview.data.previewToken },
        },
      );
      if (generation.current !== current) return;
      const summary = result.summary;
      onSaved(
        text(
          `Import complete: ${summary.created} identities created, ${summary.existing} existing, ${summary.duplicates} duplicates skipped, ${summary.rosterAdded} added to the roster.`,
          `导入完成：新建 ${summary.created} 个身份，已有 ${summary.existing} 个，跳过 ${summary.duplicates} 行重复资料，新增 ${summary.rosterAdded} 个班级名单成员。`,
        ),
      );
    } catch (cause) {
      if (generation.current !== current) return;
      if (!(cause instanceof ApiError) || cause.status >= 500) {
        setUncertain(true);
        setError(
          text(
            "The result could not be confirmed. Keep this dialog open and retry the same import; the same confirmation token prevents a duplicate batch.",
            "暂时无法确认导入结果。请保留此窗口并重试本次导入；系统会使用相同的确认凭据，避免重复执行。",
          ),
        );
      } else {
        setUncertain(false);
        setPreview(null);
        const stale = [
          "IMPORT_PREVIEW_EXPIRED",
          "IMPORT_PREVIEW_STALE",
          "IMPORT_PREVIEW_INVALID",
          "PREVIEW_EXPIRED",
          "PREVIEW_STALE",
          "CONFLICT",
        ].includes(cause.code);
        setError(
          cause.code === "IMPORT_INVALID_ROWS"
            ? text(
                "The import data is invalid. Use a student or teacher role and 1–500 rows with number and name, then preview again.",
                "导入资料无效。请选择学生或教师角色，并提供 1–500 行包含 number 和 name 的数据后重新预览。",
              )
            : stale
              ? text(
                  "The preview expired or the school records changed. Preview the same file again before importing. Nothing from this attempt was imported.",
                  "预览已过期或校内资料已变化。请重新预览同一文件后导入，本次尝试未导入任何数据。",
                )
              : schoolError(cause).message,
        );
      }
    } finally {
      commitLock.current = false;
      if (generation.current === current) setPending(null);
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([schoolIdentityCsvTemplate(kind)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `school-${kind}-identities.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const locked = pending === "commit" || uncertain;
  const summary = preview?.data.summary;
  const title = initialClass
    ? text("Import roster", "导入名单")
    : text("Import identities", "导入身份");
  const statuses: Record<ImportStatus, string> = {
    create: text("New", "新建"),
    existing: text("Existing", "已有"),
    duplicate: text("Duplicate", "重复"),
    conflict: text("Conflict", "冲突"),
    invalid: text("Invalid", "无效"),
  };
  const statusHelp: Record<ImportStatus, string> = {
    create: text("Create an identity record.", "新建身份档案。"),
    existing: text(
      "Keep the matching identity and its account link.",
      "保留匹配的身份及其账号关联。",
    ),
    duplicate: text(
      "Repeated row; import this identity once.",
      "文件内重复资料，仅导入此身份一次。",
    ),
    conflict: text(
      "This number has different details. Correct the file or review the identity.",
      "此编号对应的资料不同，请修正文件或核对已有身份。",
    ),
    invalid: text(
      "Use a 1–64 character ID and a 1–100 character name, both valid text.",
      "编号须为 1–64 个字符，姓名须为 1–100 个字符，且均须为有效文本。",
    ),
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !commitLock.current) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] max-w-2xl overflow-y-auto bg-surface p-5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (commitLock.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (commitLock.current) event.preventDefault();
        }}
      >
        <div className="pr-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-2">
            {studentClassOnly
              ? text(
                  `Import students into ${initialClass?.name ?? school.name}. Existing identities and account links are kept.`,
                  `将学生导入 ${initialClass?.name ?? school.name}，保留已有身份和账号关联。`,
                )
              : text(
                  `Import student or teacher identity records into ${school.name}. Accounts are linked separately; this import creates no login accounts, passwords, or activation codes.`,
                  `将学生或教师身份档案导入 ${school.name}。账号须另行关联；本次导入不创建登录账号、密码或激活码。`,
                )}
          </DialogDescription>
        </div>
        <div className="space-y-3">
          {studentClassOnly ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              {text("Students", "学生")} · {initialClass?.name}
            </p>
          ) : (
            <>
              <label className="block space-y-1 text-sm font-semibold">
                <span>{text("Identity role", "身份角色")}</span>
                <select
                  className={inputClass}
                  value={kind}
                  disabled={locked}
                  onChange={(event) => {
                    resetPreview();
                    setKind(event.target.value as IdentityKind);
                  }}
                >
                  <option value="student">{text("Students", "学生")}</option>
                  <option value="teacher">{text("Teachers", "教师")}</option>
                </select>
              </label>
              <ImportClassPicker
                base={base}
                selected={selectedClass}
                disabled={locked}
                onSelect={(value) => {
                  resetPreview();
                  setSelectedClass(value);
                }}
              />
            </>
          )}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="school-identity-import-file"
                className="text-sm font-semibold"
              >
                {text("Source file", "来源文件")}
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={downloadTemplate}
                disabled={locked}
              >
                <Download size={14} />
                {text("Download CSV template", "下载 CSV 模板")}
              </Button>
            </div>
            <input
              ref={fileInput}
              id="school-identity-import-file"
              type="file"
              accept=".csv,.xlsx"
              disabled={locked}
              aria-invalid={fileInvalid}
              aria-describedby={`school-import-file-help${fileInvalid ? " school-import-error" : ""}`}
              className="block w-full min-w-0 rounded-md border border-input bg-background p-2 text-sm file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-3 file:py-1 file:text-foreground hover:file:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
              onChange={(event) => {
                resetPreview();
                setFile(event.target.files?.[0] ?? null);
              }}
            />
            <p
              id="school-import-file-help"
              className="text-xs leading-relaxed text-muted-foreground"
            >
              {text(
                "CSV / XLSX · up to 2 MB and 500 data rows. Columns: number, name. Only the first worksheet is read. Keep ID numbers as text to preserve leading zeros. Template rows are fictional; replace them before importing.",
                "CSV / XLSX · 最大 2 MB、500 行数据。表头：number、name。仅读取第一个工作表。请将编号设为文本以保留前导零。模板为虚构示例，请替换后再导入。",
              )}
            </p>
          </div>
        </div>
        {pending === "preview" && (
          <p role="status" className="text-sm text-muted-foreground">
            {text(
              "Reading file and checking school records…",
              "正在读取文件并核对校内资料…",
            )}
          </p>
        )}
        {preview && summary && (
          <section
            className="min-w-0 space-y-3"
            aria-label={text("Import preview", "导入预览")}
          >
            <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <p className="break-words font-semibold">
                {text(
                  `Confirm import into ${school.name}`,
                  `确认导入 ${school.name}`,
                )}
              </p>
              <p>
                {kind === "student"
                  ? text("Student identities", "学生身份")
                  : text("Teacher identities", "教师身份")}{" "}
                ·{" "}
                {selectedClass
                  ? text(
                      `Class: ${selectedClass.name}`,
                      `班级：${selectedClass.name}`,
                    )
                  : text("No class selected", "未选择班级")}
              </p>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                {[
                  [text("Total", "总行数"), summary.total],
                  [text("New", "新建"), summary.created],
                  [text("Existing", "已有"), summary.existing],
                  [text("Duplicates", "重复"), summary.duplicates],
                  [
                    text("Conflicts", "冲突"),
                    preview.data.items.filter(
                      (item) => item.status === "conflict",
                    ).length,
                  ],
                  [
                    text("Invalid", "无效"),
                    preview.data.items.filter(
                      (item) => item.status === "invalid",
                    ).length,
                  ],
                  [text("Roster additions", "名单新增"), summary.rosterAdded],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-1">
                    <dt>{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-muted-foreground">
                {selectedClass
                  ? text(
                      `Create ${summary.created} identity records and add ${summary.rosterAdded} identities to ${selectedClass.name}. Existing identities and account links are kept.`,
                      `将新建 ${summary.created} 个身份档案，并向 ${selectedClass.name} 添加 ${summary.rosterAdded} 个名单成员。已有身份和账号关联保持不变。`,
                    )
                  : text(
                      `Create ${summary.created} identity records without adding anyone to a class. Existing identities and account links are kept.`,
                      `将新建 ${summary.created} 个身份档案，不添加到任何班级。已有身份和账号关联保持不变。`,
                    )}
              </p>
              {kind === "teacher" && selectedClass && (
                <p className="text-muted-foreground">
                  {text(
                    "A teacher with a linked school account gains access to this class roster. Unlinked teachers need an account link separately.",
                    "已关联本校账号的教师将获得此班级名单的访问权限；未关联的教师须另行关联账号。",
                  )}
                </p>
              )}
            </div>
            <div className="max-h-64 overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">
                  {text("Server validation results", "服务器校验结果")}
                </caption>
                <thead className="border-b border-border bg-muted text-muted-foreground">
                  <tr>
                    {[
                      text("Row", "行"),
                      text("ID number", "身份编号"),
                      text("Name", "姓名"),
                      text("Status", "状态"),
                    ].map((label) => (
                      <th key={label} scope="col" className="px-3 py-2">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.data.items
                    .slice(
                      (page - 1) * PREVIEW_PAGE_SIZE,
                      page * PREVIEW_PAGE_SIZE,
                    )
                    .map((item) => (
                      <tr
                        key={item.line}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-3 py-2 tabular-nums">{item.line}</td>
                        <td className="max-w-40 break-all px-3 py-2 font-mono text-xs">
                          {item.number || "—"}
                        </td>
                        <td className="max-w-40 break-words px-3 py-2">
                          {item.name || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              item.status === "invalid" ||
                              item.status === "conflict"
                                ? "font-semibold text-destructive"
                                : "font-semibold"
                            }
                          >
                            {statuses[item.status]}
                          </span>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {statusHelp[item.status]}
                          </p>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div
              role="group"
              aria-label={text("Preview pagination", "预览分页")}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span className="text-muted-foreground">
                {text(
                  `Rows ${(page - 1) * PREVIEW_PAGE_SIZE + 1}–${Math.min(page * PREVIEW_PAGE_SIZE, preview.data.items.length)} of ${preview.data.items.length}`,
                  `第 ${(page - 1) * PREVIEW_PAGE_SIZE + 1}–${Math.min(page * PREVIEW_PAGE_SIZE, preview.data.items.length)} 行，共 ${preview.data.items.length} 行`,
                )}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  {text("Previous", "上一页")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={
                    page * PREVIEW_PAGE_SIZE >= preview.data.items.length
                  }
                  onClick={() => setPage(page + 1)}
                >
                  {text("Next", "下一页")}
                </Button>
              </div>
            </div>
            {!preview.data.canCommit && (
              <p role="alert" className="text-sm text-destructive">
                {text(
                  "The entire import is blocked. Correct every conflicting or invalid row, then choose the corrected file and preview again. No identities or rosters have changed.",
                  "整批导入已被阻止。请修正所有冲突或无效行，重新选择文件并预览。目前未改动任何身份或班级名单。",
                )}
              </p>
            )}
          </section>
        )}
        <div id="school-import-error">
          <Feedback action={{ error, message: "" }} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            ref={cancel}
            type="button"
            variant="secondary"
            disabled={pending === "commit"}
            onClick={onClose}
          >
            {text("Cancel", "取消")}
          </Button>
          {preview?.data.canCommit ? (
            <Button
              type="button"
              className="min-w-36"
              disabled={Boolean(pending)}
              aria-busy={pending === "commit"}
              onClick={() => void commit()}
            >
              {pending === "commit"
                ? text("Importing…", "正在导入…")
                : uncertain
                  ? text("Retry same import", "重试本次导入")
                  : text("Confirm import", "确认导入")}
            </Button>
          ) : (
            <Button
              type="button"
              className="min-w-36"
              disabled={Boolean(pending)}
              aria-busy={pending === "preview"}
              onClick={() => void loadPreview()}
            >
              {text("Preview import", "预览导入")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ImportClassPicker({
  base,
  selected,
  disabled,
  required = false,
  onSelect,
}: {
  base: string;
  selected: ClassChoice | null;
  disabled: boolean;
  required?: boolean;
  onSelect: (value: ClassChoice | null) => void;
}) {
  const [page, setPage] = useState(1);
  return (
    <ImportClassPage
      key={page}
      base={base}
      selected={selected}
      disabled={disabled}
      required={required}
      onSelect={onSelect}
      page={page}
      onPage={setPage}
    />
  );
}

function ImportClassPage({
  base,
  selected,
  disabled,
  required,
  onSelect,
  page,
  onPage,
}: {
  base: string;
  selected: ClassChoice | null;
  disabled: boolean;
  required: boolean;
  onSelect: (value: ClassChoice | null) => void;
  page: number;
  onPage: (value: number) => void;
}) {
  const text = useSchoolText();
  const resource = useData<{ items: ClassChoice[]; hasMore: boolean }>(
    `${base}/classes?page=${page}&limit=50`,
  );
  const items = resource.data?.items ?? [];
  const choices =
    selected && !items.some((item) => item.id === selected.id)
      ? [selected, ...items]
      : items;
  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-sm font-semibold">
        <span>{required ? text("Target class", "目标班级") : text("Add to class (optional)", "添加到班级（可选）")}</span>
        <select
          className={inputClass}
          value={selected?.id ?? ""}
          disabled={disabled || resource.loading || Boolean(resource.error)}
          onChange={(event) =>
            onSelect(
              choices.find((item) => item.id === event.target.value) ?? null,
            )
          }
        >
          <option value="">
            {required ? text("Select a class", "请选择班级") : text("No class — identities only", "不选班级，仅建立身份")}
          </option>
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ·{" "}
              {item.type === "training"
                ? text("Training", "训练班")
                : text("Administrative", "行政班")}
            </option>
          ))}
        </select>
      </label>
      <Loading
        resource={{
          ...resource,
          error: resource.error
            ? required ? text("Classes could not be loaded. Retry.", "班级加载失败，请重试。") : text(
                "Classes could not be loaded. Retry, or continue with the current class choice.",
                "班级加载失败，请重试，或按当前班级选择继续。",
              )
            : "",
        }}
      >
        <div
          role="group"
          aria-label={text("Class pages", "班级分页")}
          className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
        >
          <span>
            {items.length
              ? text(`Class page ${page}`, `班级第 ${page} 页`)
              : required ? text("No classes on this page.", "本页暂无班级。") : text(
                  "No classes on this page. A class is not required.",
                  "本页暂无班级，可不选班级继续导入。",
                )}
          </span>
          {(page > 1 || resource.data?.hasMore) && (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || page === 1}
                onClick={() => onPage(page - 1)}
              >
                {text("Previous classes", "上一页班级")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled || !resource.data?.hasMore}
                onClick={() => onPage(page + 1)}
              >
                {text("Next classes", "下一页班级")}
              </Button>
            </div>
          )}
        </div>
      </Loading>
    </div>
  );
}
