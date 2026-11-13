"use client";
import { useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Feedback, input, useAction } from "@/components/teacher/shared";
import { readProblemImport, type ImportCandidate } from "@/components/teacher/problem-package";
import { productionApi } from "@/lib/production-api";
import type { PlatformProblemBank } from "./platform-problem-model";

export function PlatformProblemImport({ banks, initialBankId, onClose, onImported }: { banks: PlatformProblemBank[]; initialBankId?: string; onClose: () => void; onImported: () => void }) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [rows, setRows] = useState<ImportCandidate[]>([]), [selected, setSelected] = useState<number[]>([]), [files, setFiles] = useState<string[]>([]), [bankId, setBankId] = useState(initialBankId ?? ""), [key, setKey] = useState(() => crypto.randomUUID()), [imported, setImported] = useState<number | null>(null);
  const action = useAction(), pending = useRef(false), inputRef = useRef<HTMLInputElement>(null);
  const resetKey = () => setKey(crypto.randomUUID());
  function run(operation: () => Promise<string | void>) {
    if (pending.current) return;
    pending.current = true;
    void action.run(operation).finally(() => { pending.current = false; });
  }
  function downloadTemplate() {
    const template = [{ title: "Echo a value", statement: "Read one line and print it unchanged.", mode: "stdio", comparator: "tokens", timeLimitMs: 1000, memoryLimitMb: 128, referenceLanguage: "python", referenceCode: "print(input())", starterCode: "", samples: [{ input: "2", expected: "2" }], tests: [{ input: "7", expected: "7", weight: 100 }], tags: ["Python"] }];
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: "application/json" })), link = document.createElement("a");
    link.href = url; link.download = "platform-problems-template.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}><DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
    <DialogTitle>{tx("上传平台题目", "Upload platform problems")}</DialogTitle>
    <DialogDescription>{tx("支持单题 JSON、题目数组 JSON 或标准 ZIP 题包，可一次选择多个文件。每次最多 100 道题、合计 2 MB。先预览再导入，题目保存为草稿。", "Upload a single-problem JSON, a JSON array, or standard ZIP packages. Select one or more files, up to 100 problems and 2 MB in total. Preview before importing; problems are saved as drafts.")}</DialogDescription>
    <Feedback action={action} />
    {imported !== null ? <><p role="status" className="text-sm text-success">{tx(`已导入 ${imported} 道题目。请在题目编辑器中完成验证，再由平台管理员发布。`, `${imported} problems imported. Complete validation in the problem editor before platform publication.`)}</p><div className="flex justify-end"><Button type="button" onClick={onClose}>{tx("返回题库", "Back to library")}</Button></div></> : <form aria-label={tx("题目上传", "Problem upload")} className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); run(async () => {
      if (!selected.length) throw new Error(tx("请先选择文件和要导入的题目。", "Choose files and select problems to import first."));
      const response = await productionApi<{ importedCount: number }>("platform/source-problems/import", { method: "POST", body: { bankId: bankId || null, problems: selected.map(index => ({ ...rows[index], saveDraft: true })), idempotencyKey: key } }); setImported(response.importedCount); onImported();
    }); }}>
      <div className="flex flex-wrap items-center gap-2"><label className="grid min-w-0 flex-1 basis-56 gap-1 text-sm font-medium">{tx("选择文件", "Choose files")}<input ref={inputRef} type="file" name="files" accept=".json,.zip,application/json,application/zip" multiple disabled={action.busy} className="w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-subtle file:px-3 file:py-2 file:font-semibold" onChange={event => {
        const chosen = Array.from(event.target.files ?? []); if (!chosen.length) return;
        run(async () => {
          setRows([]); setSelected([]); setFiles([]);
          if (chosen.reduce((total, file) => total + file.size, 0) > 2 * 1024 * 1024) throw new Error(tx("所选文件合计不能超过 2 MB。", "Selected files must total 2 MB or less."));
          const parsed: ImportCandidate[] = [];
          for (const file of chosen) parsed.push(...(await readProblemImport(file)).rows);
          if (parsed.length > 100 || new TextEncoder().encode(JSON.stringify(parsed)).length > 2 * 1024 * 1024 - 8192) throw new Error(tx("最多导入 100 道题，解析后数据不能超过 2 MB。请拆分文件。", "Import up to 100 problems and 2 MB of parsed data. Split the files into smaller batches."));
          setRows(parsed); setSelected(parsed.map((_, index) => index)); setFiles(chosen.map(file => file.name)); resetKey();
          return tx(`已读取 ${parsed.length} 道候选题目，请核对后导入。`, `${parsed.length} candidate problems loaded. Review them before importing.`);
        });
      }} /></label><Button type="button" variant="ghost" size="sm" onClick={downloadTemplate}>{tx("下载 JSON 模板", "Download JSON template")}</Button></div>
      <label className="grid gap-1 text-sm font-medium">{tx("目标分类", "Destination category")}<select aria-label={tx("目标分类", "Destination category")} name="bankId" className={input} value={bankId} disabled={action.busy} onChange={event => { setBankId(event.target.value); resetKey(); }}><option value="">{tx("未分类", "Unclassified")}</option>{banks.filter(bank => !bank.archivedAt).map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
      {rows.length > 0 && <><p className="break-words text-xs text-muted-foreground">{files.join(" · ")}</p><div className="max-h-80 overflow-auto rounded-md border border-border focus-visible:outline-2 focus-visible:outline-primary" role="region" aria-label={tx("导入题目预览", "Import preview")} tabIndex={0}><table className="w-full min-w-[560px] text-left text-sm"><thead className="sticky top-0 bg-surface-subtle"><tr><th scope="col" className="p-2"><input type="checkbox" aria-label={tx("选择全部导入题目", "Select all import candidates")} checked={selected.length === rows.length} disabled={action.busy} onChange={event => { setSelected(event.target.checked ? rows.map((_, index) => index) : []); resetKey(); }} /></th><th scope="col" className="p-2">{tx("题目", "Problem")}</th><th scope="col" className="p-2">{tx("接口", "Interface")}</th><th scope="col" className="p-2">{tx("样例 / 测试", "Samples / tests")}</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-border"><td className="p-2"><input type="checkbox" aria-label={tx(`导入第 ${index + 1} 题`, `Import problem ${index + 1}`)} checked={selected.includes(index)} disabled={action.busy} onChange={event => { setSelected(current => event.target.checked ? [...current, index] : current.filter(value => value !== index)); resetKey(); }} /></td><th scope="row" className="max-w-sm break-words p-2 font-normal">{row.title || tx("缺少标题", "Missing title")}{row._importWarnings?.map(warning => <p key={warning} className="mt-1 text-xs text-warning">{warning}</p>)}</th><td className="p-2">{row.mode === "function" ? tx("函数", "Function") : tx("标准输入输出", "Standard I/O")}</td><td className="p-2 tabular-nums">{row.samples?.length ?? 0} / {row.tests?.length ?? 0}</td></tr>)}</tbody></table></div></>}
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{tx(`已选 ${selected.length} / ${rows.length} 道题`, `${selected.length} of ${rows.length} problems selected`)}</p><div className="flex gap-2"><Button type="button" variant="secondary" disabled={action.busy} onClick={onClose}>{tx("取消", "Cancel")}</Button><Button type="submit" disabled={action.busy}>{action.busy ? tx("处理中…", "Working…") : tx("确认导入", "Import selected")}</Button></div></div>
    </form>}
  </DialogContent></Dialog>;
}
