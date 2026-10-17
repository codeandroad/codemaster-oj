"use client";
import { useEffect, useRef, useState } from "react";
import { FileArchive, Loader2, Upload } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { apiMessage, productionApi } from "@/lib/production-api";
import { paper4ExamLabel } from "./paper4-catalog";
type ImportFile = { filename: string; contentBase64: string };
type PreviewItem = { sourceFilename: string; preview: {title: string; shortTitle?: string; examYear?: number | null; examSession?: "summer" | "autumn" | null; examVariant?: 41 | 42 | 43 | null; questionCount: number; totalMarks: number; caseCount: number; referenceSolutionCount: number} };
export function Paper4BatchImportDialog({ open, onOpenChange, onImported }: {open: boolean; onOpenChange: (open: boolean) => void; onImported: (count: number) => void}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [files, setFiles] = useState<ImportFile[]>([]), [preview, setPreview] = useState<PreviewItem[]>([]);
  const [busy, setBusy] = useState(false), [importing, setImporting] = useState(false), [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function inspect(selected: FileList | null) {
    setFiles([]); setPreview([]); setError(""); if (!selected?.length) return;
    const input = Array.from(selected);
    if (input.length > 100 || input.some(file => !/\.(json|zip)$/i.test(file.name))) {setError(tx("请选择 1–100 个 Paper 4 JSON 或 ZIP 试卷包。", "Choose 1–100 Paper 4 JSON or ZIP package files.")); return;}
    if (input.reduce((size, file) => size + file.size, 0) > 8 * 1024 * 1024) {setError(tx("所选文件合计不可超过 8 MiB，请分批导入。", "Selected files exceed 8 MiB. Import them in smaller batches.")); return;}
    setBusy(true);
    try {
      const prepared = await Promise.all(input.map(async file => {
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
        for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
        return { filename: file.name, contentBase64: btoa(binary) };
      }));
      const result = await productionApi<{ items: PreviewItem[] }>("paper4/imports/batch-preview", { method: "POST", body: { files: prepared } });
      setFiles(prepared); setPreview(result.items);
    } catch (reason) { setError(apiMessage(reason)); } finally { setBusy(false); }
  }
  async function importPapers() {
    setBusy(true); setImporting(true); setError("");
    try {const result = await productionApi<{ count: number }>("paper4/papers/batch-import", { method: "POST", body: { files } }); onImported(result.count); onOpenChange(false);}
    catch (reason) { setError(apiMessage(reason)); } finally { setBusy(false); setImporting(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
    <DialogTitle>{tx("导入 Paper 4 试卷", "Import Paper 4 papers")}</DialogTitle><DialogDescription>{tx("可一次选择多个 JSON / ZIP 试卷包，或直接上传批量导出的 Paper 4 ZIP。全部校验通过后统一创建自由练习草稿。", "Select multiple JSON / ZIP paper packages, or upload an exported Paper 4 collection ZIP. Every paper is checked before the complete batch is created as free-practice drafts.")}</DialogDescription>
    {error && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive focus-visible:outline-2 focus-visible:outline-destructive">{error}</p>}
    <label className="block rounded-md border border-dashed border-input bg-surface-subtle p-4 text-sm font-semibold"><span className="flex items-center gap-2"><FileArchive size={18} aria-hidden="true"/>{tx("选择 Paper 4 JSON / ZIP 文件（支持多选）", "Choose Paper 4 JSON / ZIP files (multiple allowed)")}</span><input type="file" multiple accept=".json,.zip,application/json,application/zip" disabled={busy} className="mt-3 block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:font-semibold file:text-secondary-foreground focus-visible:outline-2 focus-visible:outline-primary" onChange={event => void inspect(event.currentTarget.files)}/><span className="mt-2 block text-xs font-normal text-muted-foreground">{tx("每批最多 100 套试卷，文件合计不超过 8 MiB。", "Up to 100 papers and 8 MiB of files per batch.")}</span></label>
    <p className="text-xs leading-5 text-muted-foreground">{tx("普通 OJ 题目包 problems.json 请在“题库 → 导入题目”中使用。原始试卷 PDF、素材 ZIP 和课程习题包需要先转换为 Paper 4 结构化格式。", "Import an ordinary problems.json from Problem banks → Import problems. Raw PDFs, source/data ZIPs and course problem packs must first be converted into structured Paper 4 packages.")}</p>
    {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true"/>{importing ? tx("正在创建草稿…", "Creating drafts…") : tx("正在校验试卷…", "Checking papers…")}</p>}
    {preview.length > 0 && <section aria-label={tx("导入预览", "Import preview")} className="overflow-hidden rounded-md border border-border"><div className="flex flex-wrap items-center justify-between gap-2 bg-surface-subtle px-3 py-2 text-sm"><strong>{tx(`${preview.length} 套试卷 · 格式校验通过`, `${preview.length} papers · Format checked`)}</strong><span className="text-xs text-muted-foreground">{tx("将创建草稿，不会自动公开", "Creates drafts; does not publish")}</span></div><ul className="max-h-72 divide-y divide-border overflow-y-auto">{preview.map((item, index) => <li key={`${item.sourceFilename}:${index}`} className="px-3 py-3 text-sm"><strong className="block">{item.preview.title}</strong>{item.preview.shortTitle && <span className="mt-1 block text-xs text-muted-foreground">{tx("导航名称", "Navigation name")}: {item.preview.shortTitle}</span>}<span className="mt-1 block break-all text-xs text-muted-foreground">{item.sourceFilename}</span><span className="mt-1 block text-xs text-muted-foreground">{[paper4ExamLabel(item.preview, locale), tx(`${item.preview.questionCount} 道大题 · ${item.preview.totalMarks} 分`, `${item.preview.questionCount} questions · ${item.preview.totalMarks} marks`), tx(`${item.preview.caseCount} 个测试 · ${item.preview.referenceSolutionCount} 份参考答案`, `${item.preview.caseCount} tests · ${item.preview.referenceSolutionCount} references`)].filter(Boolean).join(" · ")}</span></li>)}</ul></section>}
    <DialogFooter><Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>{tx("取消", "Cancel")}</Button><Button disabled={busy || !files.length || !preview.length} onClick={() => void importPapers()}><Upload size={16} aria-hidden="true"/>{tx(`创建 ${preview.length || ""} 套草稿`, `Create ${preview.length || ""} drafts`)}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
