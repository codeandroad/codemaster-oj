"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileImage, Maximize2, Minus, Plus, Type } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import type { Paper4Paper, Paper4Question, Paper4Stage } from "./model";
import { Paper4Content } from "./paper4-content";
import { paper4OriginalPaperKey, paper4OriginalSegments, paper4OriginalStagePart, paper4OriginalStatement, parsePaper4OriginalManifest, type OriginalQuestionManifest } from "./paper4-original-question-model";
import styles from "./paper4-original-question.module.css";

const MAX_MANIFEST_BYTES = 262_144;
// Excerpts are rasterized at 144 dpi; 100% uses the 72 dpi PDF page size.
const RASTER_SCALE = 2;

async function readManifest(response: Response): Promise<unknown> {
  if (!response.ok || Number(response.headers.get("content-length")) > MAX_MANIFEST_BYTES || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function Paper4OriginalQuestion({ paper, question, selectedStage }: {
  paper: Paper4Paper;
  question: Paper4Question;
  selectedStage?: Paper4Stage | null;
}) {
  const paperKey = paper4OriginalPaperKey(paper);
  if (!paperKey) return <Paper4Content content={question.statement}/>;
  return <OriginalQuestionViewer key={`${paperKey}:${question.key}`} paperKey={paperKey} question={question} selectedStage={selectedStage}/>;
}

function OriginalQuestionViewer({ paperKey, question, selectedStage }: {
  paperKey: string;
  question: Paper4Question;
  selectedStage?: Paper4Stage | null;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [verified, setVerified] = useState<{ statement: string; manifest: OriginalQuestionManifest } | null>(null);
  const [retry, setRetry] = useState(0);
  const [textView, setTextView] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [choice, setChoice] = useState<{ stage: string; part: string } | null>(null);
  const [zoom, setZoom] = useState<{ mode: "fit" | "manual"; percent: number }>({ mode: "manual", percent: 120 });
  const [canvasWidth, setCanvasWidth] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const basePath = `/paper4-originals/${paperKey}/`;
  const original = verified?.statement === question.statement ? verified.manifest.questions[question.key] : null;
  const stageToken = `${selectedStage?.id ?? ""}:${selectedStage?.title ?? ""}`;
  const stagePart = paper4OriginalStagePart(selectedStage?.title);
  const suggestedPart = original?.parts.some(part => part.key === stagePart) ? stagePart! : "full";
  const part = choice?.stage === stageToken ? choice.part : suggestedPart;
  const images = useMemo(() => original ? paper4OriginalSegments(original, part) : [], [original, part]);
  const baseWidth = useMemo(() => original ? Math.max(...paper4OriginalSegments(original, "full").map(image => image.width / RASTER_SCALE)) : 1, [original]);
  const percent = zoom.mode === "fit" ? Math.min(200, Math.max(1, Math.floor((Math.max(canvasWidth, 64) - 32) / baseWidth * 100))) : zoom.percent;
  const number = question.key.match(/^Q(\d+)$/)?.[1] ?? question.key;
  const showingText = textView || imageFailed;

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void (async () => {
      try {
        if (!globalThis.crypto?.subtle) return;
        const response = await fetch(`${basePath}manifest.json`, { signal: controller.signal, credentials: "same-origin", redirect: "error" });
        const manifest = parsePaper4OriginalManifest(await readManifest(response), paperKey);
        const candidate = manifest?.questions[question.key];
        if (!manifest || !candidate) return;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(paper4OriginalStatement(question.statement)));
        const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        if (live && candidate.statementSha256 === fingerprint) setVerified({ statement: question.statement, manifest });
      } catch {
        // Optional original excerpts must never block the editable practice page.
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [basePath, paperKey, question.key, question.statement, retry]);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => setCanvasWidth(entries[0] ? node.clientWidth : 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, [original, showingText]);

  if (!original || !verified) return <Paper4Content content={question.statement}/>;
  const assetVersion = `?v=${verified.manifest.sourceSha256.slice(0, 12)}`;
  const pdfHref = `${basePath}${verified.manifest.pdf}${assetVersion}`;
  const changePart = (next: string) => {
    setChoice({ stage: stageToken, part: next });
    canvas.current?.scrollTo({ top: 0, left: 0 });
  };
  const changeZoom = (delta: number) => setZoom({ mode: "manual", percent: Math.max(40, Math.min(200, Math.round(percent / 10) * 10 + delta)) });

  return <section className={styles.viewer} aria-label={tx(`第 ${number} 题原试卷`, `Question ${number}, original paper`)} data-od-id="paper4-original-question">
    <header className={styles.header}>
      <h2 className={styles.title}>{tx(`第 ${number} 题 · 原试卷题干`, `Question ${number} · Original wording`)}</h2>
      <div className={styles.headerActions}>
        <button type="button" className={styles.textToggle} aria-pressed={showingText} onClick={() => { if (showingText) { setTextView(false); if (imageFailed) { setImageFailed(false); setRetry(value => value + 1); } } else setTextView(true); }}>{showingText ? <FileImage size={14} aria-hidden="true"/> : <Type size={14} aria-hidden="true"/>}{showingText ? tx("原卷视图", "Original view") : tx("文字视图", "Text view")}</button>
        <a href={pdfHref} target="_blank" rel="noopener noreferrer" className={styles.pdfLink} aria-label={tx("在新标签页打开原试卷 PDF", "Open original question paper PDF in a new tab")}>{tx("打开 PDF", "Open PDF")}<ExternalLink size={14} aria-hidden="true"/></a>
      </div>
    </header>
    {!showingText && <div className={styles.toolbar}>
      <div className={styles.parts} role="group" aria-label={tx("原试卷题目范围", "Original question sections")}>
        <button type="button" className={styles.partButton} aria-pressed={part === "full"} onClick={() => changePart("full")}>{tx("完整大题", "Full question")}</button>
        {original.parts.map(item => <button key={item.key} type="button" className={styles.partButton} aria-pressed={part === item.key} onClick={() => changePart(item.key)}>{item.label}</button>)}
      </div>
      <div className={styles.zoom} role="group" aria-label={tx("原试卷缩放", "Original paper zoom")}>
        <button type="button" className={styles.iconButton} aria-label={tx("缩小原试卷", "Zoom out original paper")} disabled={percent <= 40} onClick={() => changeZoom(-10)}><Minus size={15} aria-hidden="true"/></button>
        <output className={styles.percent} aria-live="polite" aria-label={tx("缩放比例", "Zoom level")}>{percent}%</output>
        <button type="button" className={styles.iconButton} aria-label={tx("放大原试卷", "Zoom in original paper")} disabled={zoom.mode === "manual" && percent >= 200} onClick={() => changeZoom(10)}><Plus size={15} aria-hidden="true"/></button>
        <button type="button" className={styles.fitButton} aria-pressed={zoom.mode === "fit"} onClick={() => { setZoom({ mode: "fit", percent: 100 }); canvas.current?.scrollTo({ left: 0 }); }}><Maximize2 size={13} aria-hidden="true"/>{tx("适应宽度", "Fit width")}</button>
      </div>
      <span className={styles.scope}>{part === "full" ? tx("完整大题", "Full question") : tx(`题干 + (${part})`, `Stem + part (${part})`)}</span>
    </div>}
    {showingText ? <div className={styles.textBody}>
      {imageFailed && <div className={styles.fallback} role="status"><span>{tx("原卷图片暂不可用，已显示完整文字题干。", "Original excerpts are unavailable. The full text is shown below.")}</span><button type="button" className={styles.textToggle} onClick={() => { setImageFailed(false); setTextView(false); setRetry(value => value + 1); }}>{tx("重试图片", "Retry images")}</button></div>}
      <Paper4Content content={question.statement}/>
    </div> : <div ref={canvas} className={styles.canvas} tabIndex={0} role="region" aria-label={tx("原试卷题干，可滚动查看；使用文字视图可选择和复制文字", "Original paper excerpts. Scroll to read; use Text view to select and copy text.")}>
      <div className={styles.sheets} style={{ width: baseWidth * percent / 100 }}>
        {images.map((image, index) => <div className={styles.sheet} key={`${image.src}:${index}`} style={{ width: image.width / RASTER_SCALE * percent / 100 }}>
          {/* Native images keep verified same-origin excerpts at their exact aspect ratio without an optimization service. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${basePath}${image.src}${assetVersion}`} width={image.width} height={image.height} loading={index === 0 ? "eager" : "lazy"} decoding="async" draggable={false} alt={tx(`第 ${number} 题原试卷第 ${image.page} 页节选 ${index + 1}；完整可复制文字见“文字视图”`, `Question ${number}, original PDF page ${image.page}, excerpt ${index + 1}. Full selectable text is available in Text view.`)} onError={() => setImageFailed(true)}/>
        </div>)}
      </div>
    </div>}
    {!showingText && <footer className={styles.footer}><span>{tx("原卷题干 · 平台作答说明见文字视图", "Original wording · See Text view for classroom instructions")}</span><a href={pdfHref} target="_blank" rel="noopener noreferrer">{tx("在新标签页打开", "Open in a separate tab")}<ExternalLink size={11} aria-hidden="true"/></a></footer>}
  </section>;
}
