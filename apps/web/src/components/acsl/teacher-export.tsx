"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Printer } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { Loading, inputClass, useData } from "@/components/admin/common";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiMessage, productionApi } from "@/lib/production-api";
import { AcslRichContent } from "./rich-content";
import type { AcslLanguage } from "./model";
import {
  acslTeacherHref,
  type AcslExportEnvelope,
  type AcslPrintDocument,
} from "./teacher-model";
import styles from "./teacher-export.module.css";

function bytes(envelope: AcslExportEnvelope) {
  if (envelope.contentType !== "application/json")
    throw new Error("Unexpected export format.");
  return Uint8Array.from(atob(envelope.contentBase64), (char) =>
    char.charCodeAt(0),
  );
}
export function decodeAcslPrint(
  envelope: AcslExportEnvelope,
  kind: "questions" | "answers",
  language: AcslLanguage,
): AcslPrintDocument {
  const document = JSON.parse(
    new TextDecoder().decode(bytes(envelope)),
  ) as AcslPrintDocument;
  if (
    document.schemaVersion !== 1 ||
    document.kind !== kind ||
    document.language !== language ||
    !Array.isArray(document.questions)
  )
    throw new Error("Unexpected print document.");
  return document;
}
function download(envelope: AcslExportEnvelope) {
  const url = URL.createObjectURL(
    new Blob([bytes(envelope)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${
    envelope.filename
      .replace(/\.json$/i, "")
      .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 120) || "acsl-paper"
  }.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function printHref(
  baseHref: string,
  paperId: string,
  kind: "questions" | "answers",
  language: AcslLanguage,
) {
  const [path, query] = acslTeacherHref(
    baseHref,
    paperId,
    false,
    language,
  ).split("?");
  const params = new URLSearchParams(query);
  params.set("export", kind);
  return `${path}?${params}`;
}

export function AcslTeacherExportDialog({
  schoolId,
  paperId,
  title,
  baseHref,
  language: initialLanguage,
  onClose,
}: {
  schoolId: string;
  paperId: string;
  title: string;
  baseHref: string;
  language: AcslLanguage;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const [language, setLanguage] = useState(initialLanguage);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function backup() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const envelope = await productionApi<AcslExportEnvelope>(
        `schools/${schoolId}/acsl/manage/${paperId}/export?include=package&language=${language}`,
      );
      download(envelope);
      setMessage(tx("JSON backup downloaded.", "JSON 备份已下载。"));
    } catch (reason) {
      setError(apiMessage(reason));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent data-od-id="acsl-export-dialog">
        <DialogTitle>{tx("Export paper", "导出试卷")}</DialogTitle>
        <DialogDescription>{title}</DialogDescription>
        <label className="block text-sm font-medium">
          {tx("Print language", "打印语言")}
          <select
            className={`${inputClass} mt-1`}
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value as AcslLanguage)
            }
            data-od-id="acsl-export-language"
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </label>
        <div className="grid gap-2">
          <AppLink
            href={printHref(baseHref, paperId, "questions", language)}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "secondary" })}
            data-od-id="acsl-export-questions"
          >
            <Printer size={16} aria-hidden="true" />
            {tx("Student paper · Print / PDF", "学生卷 · 打印 / PDF")}
          </AppLink>
          <AppLink
            href={printHref(baseHref, paperId, "answers", language)}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "secondary" })}
            data-od-id="acsl-export-answers"
          >
            <Printer size={16} aria-hidden="true" />
            {tx(
              "Answers and explanations · Print / PDF",
              "答案解析版 · 打印 / PDF",
            )}
          </AppLink>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void backup()}
            data-od-id="acsl-export-json"
          >
            <Download size={16} aria-hidden="true" />
            {busy
              ? tx("Downloading…", "正在下载…")
              : tx("Download JSON backup", "下载 JSON 备份")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {tx(
            "Print preview opens in a new tab. Use your browser's print dialog to save a PDF. JSON includes both languages, answers and judge data; keep it with your teaching materials.",
            "打印预览在新标签页打开，可在浏览器打印对话框中保存 PDF。JSON 包含双语内容、答案及判题数据，请作为教学资料保存。",
          )}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-success">
            {message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PrintDocument({ paper }: { paper: AcslPrintDocument }) {
  const zh = paper.language === "zh";
  return (
    <article
      className={styles.document}
      data-od-id="acsl-print-document"
      data-audience={paper.kind}
      lang={paper.language}
    >
      <h1>{paper.title}</h1>
      <p className="text-sm">
        {paper.division} · {paper.season} ·{" "}
        {zh ? `第 ${paper.round} 轮` : `Contest ${paper.round}`} ·{" "}
        {paper.kind === "questions"
          ? zh
            ? "学生卷"
            : "Student paper"
          : zh
            ? "答案解析版"
            : "Answers and explanations"}
      </p>
      {paper.kind === "questions" && (
        <p className="mt-4 text-sm">
          {zh
            ? "姓名：________________　班级：________________"
            : "Name: ________________  Class: ________________"}
        </p>
      )}
      {paper.questions.map((question) => (
        <section key={question.id} className={styles.question} data-question-id={question.id}>
          <h2>
            {question.number}. {question.topic}
          </h2>
          <p className="mb-3 text-sm">
            {question.type === "multiple"
              ? zh
                ? "请选择所有正确选项。"
                : "Select all correct answers."
              : zh
                ? "请选择一个正确选项。"
                : "Select one answer."}
          </p>
          <AcslRichContent
            content={question.statement}
            diagrams={question.statementDiagrams}
            language={paper.language}
            zoomable={false}
          />
          {question.options.map((option) => (
            <div key={option.id} className={styles.option}>
              <span>{option.id}.</span>
              <div>
                <AcslRichContent
                  content={option.text}
                  diagrams={option.diagrams}
                  language={paper.language}
                  compact
                  zoomable={false}
                />
              </div>
            </div>
          ))}
          {paper.kind === "answers" && (
            <div className={styles.answer} data-od-id="acsl-print-answer">
              <p className="mb-3 font-semibold">
                {zh ? "正确答案" : "Correct answer"}:{" "}
                {question.correctOptionIds?.join(", ")}
              </p>
              <AcslRichContent
                content={question.explanation ?? ""}
                diagrams={question.explanationDiagrams}
                language={paper.language}
                zoomable={false}
              />
            </div>
          )}
        </section>
      ))}
      {paper.programming && (
        <section className={styles.question}>
          <h2>
            {zh ? "编程题" : "Programming"} · {paper.programming.title}
          </h2>
          <AcslRichContent
            content={paper.programming.statement}
            diagrams={paper.programming.statementDiagrams}
            language={paper.language}
            zoomable={false}
          />
          {paper.programming.samples.map((sample, index) => (
            <div key={index}>
              <h3>{zh ? `样例 ${index + 1}` : `Sample ${index + 1}`}</h3>
              <div className={styles.sample}>
                <div>
                  <p>{zh ? "输入" : "Input"}</p>
                  <pre>{sample.input}</pre>
                </div>
                <div>
                  <p>{zh ? "输出" : "Output"}</p>
                  <pre>{sample.expected}</pre>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}

export function AcslTeacherPrintPage({
  schoolId,
  paperId,
  baseHref,
  kind,
  language,
}: {
  schoolId: string;
  paperId: string;
  baseHref: string;
  kind: "questions" | "answers";
  language: AcslLanguage;
}) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => (locale === "en" ? en : zh);
  const resource = useData<AcslExportEnvelope>(
    `schools/${schoolId}/acsl/manage/${paperId}/export?include=${kind}&language=${language}`,
  );
  const [printing, setPrinting] = useState(false);
  let paper: AcslPrintDocument | null = null;
  let error = "";
  if (resource.data) {
    try {
      paper = decodeAcslPrint(resource.data, kind, language);
    } catch {
      error = tx(
        "The print document could not be read. Reload and try again.",
        "无法读取打印文档，请重新加载后重试。",
      );
    }
  }
  const title = paper?.title ?? tx("Print ACSL paper", "打印 ACSL 试卷");
  useEffect(() => {
    document.title = `${title} · CodeMaster`;
  }, [title]);
  async function print() {
    if (printing) return;
    setPrinting(true);
    try {
      await document.fonts.ready;
      window.print();
    } finally {
      setPrinting(false);
    }
  }
  return (
    <div className="space-y-4" data-od-id="acsl-teacher-print">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AppLink
          href={acslTeacherHref(baseHref, paperId, false, language)}
          className="text-sm text-primary hover:underline"
        >
          {tx("Back to paper", "返回试卷")}
        </AppLink>
        <Button
          disabled={!paper || printing}
          onClick={() => void print()}
          data-od-id="acsl-print-button"
        >
          <Printer size={16} aria-hidden="true" />
          {tx("Print / Save PDF", "打印 / 保存 PDF")}
        </Button>
      </div>
      <Loading resource={resource}>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          paper && (
            <div className="rounded-lg border border-border bg-surface p-4 sm:p-8">
              <PrintDocument paper={paper} />
            </div>
          )
        )}
      </Loading>
      {paper &&
        typeof document !== "undefined" &&
        createPortal(
          <div className={styles.printRoot} data-od-id="acsl-print-root">
            <PrintDocument paper={paper} />
          </div>,
          document.body,
        )}
    </div>
  );
}
