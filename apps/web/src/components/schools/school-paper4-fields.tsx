"use client";

// Shared presentation patterns from the production Paper 4 editor. These
// fields only edit an authorized draft; transport stays school-scoped.
import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Paper4Stage, Paper4RunnerCase } from "@/components/paper4/model";
import { Paper4Content } from "@/components/paper4/paper4-content";
import layoutStyles from "@/components/paper4/teacher-paper4.module.css";
import contentStyles from "@/components/paper4/paper4-content.module.css";
import { input, textarea as area } from "@/components/student/shared";

export function Paper4Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mt-3 block text-sm font-semibold">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

export function Paper4FileMapEditor({
  label,
  value,
  disabled,
  onChange,
  tx,
}: {
  label: string;
  value: Record<string, string>;
  disabled: boolean;
  onChange: (value: Record<string, string>) => void;
  tx: (zh: string, en: string) => string;
}) {
  const entries = Object.entries(value);
  const [newName, setNewName] = useState("");
  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold">{label}</h4>
      <div className="mt-2 space-y-2">
        {entries.map(([name, content]) => (
          <div key={name} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <code className="text-xs font-semibold">{name}</code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`${tx("移除", "Remove")} ${name}`}
                onClick={() => {
                  const next = { ...value };
                  delete next[name];
                  onChange(next);
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <textarea
              aria-label={`${name} ${tx("内容", "content")}`}
              rows={3}
              className={`${area} mt-2 font-mono`}
              spellCheck={false}
              value={content}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, [name]: event.target.value })
              }
            />
          </div>
        ))}
      </div>
      {!disabled && (
        <div className="mt-2 flex gap-2">
          <input
            aria-label={tx("新增文件名", "New filename")}
            placeholder="TheData.txt"
            className={input}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={
              newName.length > 76 ||
              !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(?:txt|csv|dat)$/i.test(newName) ||
              newName in value
            }
            onClick={() => {
              onChange({ ...value, [newName]: "" });
              setNewName("");
            }}
          >
            <Plus size={14} />
            {tx("文件", "File")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function Paper4StageEditor({
  stage,
  disabled,
  onChange,
  onRemove,
  canRemove,
  index,
  tx,
  validation,
}: {
  stage: Paper4Stage;
  disabled: boolean;
  onChange: (patch: Partial<Paper4Stage>) => void;
  onRemove: () => void;
  canRemove: boolean;
  index: number;
  tx: (zh: string, en: string) => string;
  validation?: string;
}) {
  return (
    <div
      className={`${layoutStyles.stageEditor} rounded-md border border-border bg-surface-subtle p-3`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-muted-foreground">
          {tx("阶段", "Stage")} {index + 1}
          {stage.judgeMode === "auto" && validation && (
            <span
              className={`ml-2 ${validation === "AC" ? "text-success" : validation === "WA" || validation === "error" ? "text-destructive" : ""}`}
            >
              · {tx("参考验证", "Reference validation")}: {validation}
            </span>
          )}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || !canRemove}
          aria-label={tx("移除阶段", "Remove stage")}
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <div className={layoutStyles.stageFields}>
        <Paper4Field label={tx("阶段标题", "Stage title")}>
          <input
            className={input}
            maxLength={140}
            value={stage.title}
            disabled={disabled}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </Paper4Field>
        <Paper4Field label={tx("判题方式", "Judging mode")}>
          <select
            className={input}
            disabled={disabled}
            value={stage.judgeMode ?? "manual"}
            onChange={(event) =>
              onChange({
                judgeMode: event.target.value as Paper4Stage["judgeMode"],
              })
            }
          >
            <option value="auto">{tx("自动判题", "Auto")}</option>
            <option value="manual">
              {tx("人工复核代码", "Manual code review")}
            </option>
            <option value="evidence">{tx("证据/过程分", "Evidence")}</option>
          </select>
        </Paper4Field>
        <Paper4Field label={tx("满分", "Maximum marks")}>
          <input
            type="number"
            min={1}
            max={75}
            className={input}
            value={stage.maxMarks}
            disabled={disabled}
            onChange={(event) =>
              onChange({ maxMarks: Number(event.target.value) })
            }
          />
        </Paper4Field>
      </div>
      <Paper4Field label={tx("阶段要求", "Stage instructions")}>
        <textarea
          rows={2}
          className={area}
          value={stage.description}
          disabled={disabled}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </Paper4Field>
      {stage.description.trim() && (
        <details className={contentStyles.stagePreview}>
          <summary>{tx("预览阶段要求", "Preview stage instructions")}</summary>
          <Paper4Content content={stage.description} />
        </details>
      )}
    </div>
  );
}

export function Paper4CaseEditor({
  test,
  index,
  disabled,
  onChange,
  onRemove,
  tx,
}: {
  test: Paper4RunnerCase;
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<Paper4RunnerCase>) => void;
  onRemove: () => void;
  tx: (zh: string, en: string) => string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-subtle p-3">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm">
          {tx("用例", "Case")} {index + 1}
        </strong>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label={tx("移除用例", "Remove case")}
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Paper4Field label={tx("用例编号", "Case ID")}>
          <input
            className={input}
            value={test.id}
            disabled={disabled}
            onChange={(event) => onChange({ id: event.target.value })}
          />
        </Paper4Field>
        <label className="mt-8 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={test.public}
            disabled={disabled}
            onChange={(event) => onChange({ public: event.target.checked })}
          />
          {tx("向学生显示本用例输出", "Show this case output to students")}
        </label>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Paper4Field label={tx("标准输入", "Standard input")}>
          <textarea
            rows={3}
            className={`${area} font-mono`}
            value={test.stdin}
            disabled={disabled}
            onChange={(event) => onChange({ stdin: event.target.value })}
          />
        </Paper4Field>
        <Paper4Field label={tx("预期标准输出", "Expected stdout")}>
          <textarea
            rows={3}
            className={`${area} font-mono`}
            value={test.expectedStdout}
            disabled={disabled}
            onChange={(event) =>
              onChange({ expectedStdout: event.target.value })
            }
          />
        </Paper4Field>
      </div>
      <Paper4Field
        label={tx(
          "测试驱动代码（可选，仅在此用例执行）",
          "Test driver code (optional, runs in this case only)",
        )}
      >
        <textarea
          rows={3}
          className={`${area} font-mono`}
          spellCheck={false}
          value={test.driverCode ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ driverCode: event.target.value })}
        />
      </Paper4Field>
      <Paper4FileMapEditor
        label={tx("此用例额外输入文件", "Additional input files for this case")}
        value={test.inputFiles}
        disabled={disabled}
        onChange={(inputFiles) => onChange({ inputFiles })}
        tx={tx}
      />
      <Paper4FileMapEditor
        label={tx("预期生成文件", "Expected generated files")}
        value={test.expectedFiles}
        disabled={disabled}
        onChange={(expectedFiles) => onChange({ expectedFiles })}
        tx={tx}
      />
    </div>
  );
}
