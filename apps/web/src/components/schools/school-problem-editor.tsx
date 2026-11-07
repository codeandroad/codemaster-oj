"use client";

import { useId, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useWorkspaceTheme } from "@/components/ui/theme-context";
import { CodeEditor } from "@/components/student/code-editor";
import { CopyCodeButton } from "@/components/student/copy-code-button";
import { defaultWorkspaceSettings } from "@/components/student/workspace-settings";
import { Feedback, useMutation } from "@/components/student/shared";
import { Field, Table, input, area } from "@/components/teacher/shared";
import { MathEditor } from "@/components/teacher/math-editor";
import { productionApi } from "@/lib/production-api";
import type { Bank, Definition, Problem } from "./school-practice-types";
import { equalSchoolTestWeights, schoolProblemDefaults, schoolProblemDraftIssue, schoolProblemMode, type ProblemEditorSection } from "./school-problem-draft";

type EditorProps = {
  problem: Problem | null; banks: Bank[]; bankId: string; base: string;
  close: () => void; saved: () => void;
};

export function SchoolProblemEditor({ problem, banks, bankId, base, close, saved }: EditorProps) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => locale === "zh" ? zh : en;
  const [draft, setDraft] = useState<Definition>(problem?.definition ?? schoolProblemDefaults);
  const [bank, setBank] = useState(problem?.bankId || bankId || banks[0]?.id || "");
  const [section, setSection] = useState<ProblemEditorSection>("statement");
  const action = useMutation(), id = useId();
  const pending = useRef(false), request = useRef({ body: "", id: "" });
  const change = (patch: Partial<Definition>) => setDraft(value => ({ ...value, ...patch }));
  const sections: { id: ProblemEditorSection; label: string }[] = [
    { id: "statement", label: tx("Statement", "题面") },
    { id: "interface", label: tx("Interface & starter", "程序接口与初始代码") },
    { id: "tests", label: tx("Test data", "测试数据") },
    { id: "reference", label: tx("Reference program", "参考程序") },
  ];
  const canEdit = !problem || problem.canManage;
  function dismiss() { if (!pending.current) close(); }
  return <Dialog open onOpenChange={open => { if (!open) dismiss(); }}>
    <DialogContent className="flex max-h-[92vh] max-w-6xl flex-col gap-3 overflow-hidden p-4 sm:p-6">
      <DialogTitle className="pr-9">{problem ? tx("Edit problem", "编辑题目") : tx("New problem", "新建题目")}</DialogTitle>
      <DialogDescription>{tx("Save the draft, then validate its reference program and review it for publication from the problem list.", "保存草稿后，可在题目列表验证参考程序并审核发布。")}</DialogDescription>
      <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={event => {
        event.preventDefault();
        if (pending.current || !canEdit) return;
        pending.current = true;
        void action.run(async () => {
          const issue = schoolProblemDraftIssue(draft, locale);
          if (issue) { setSection(issue.section); throw new Error(issue.message); }
          if (!bank) { setSection("statement"); throw new Error(tx("Choose a problem bank.", "请选择题库。")); }
          const body = { ...draft, bankId: bank, expectedRevision: problem?.revision };
          const serialized = JSON.stringify(body);
          if (request.current.body !== serialized) request.current = { body: serialized, id: crypto.randomUUID() };
          await productionApi(`${base}/problems${problem ? `/${problem.id}` : ""}`, {
            method: problem ? "PATCH" : "POST", body: { ...body, requestId: request.current.id },
          });
          saved();
        }).finally(() => { pending.current = false; });
      }}>
        <div className="mb-3 flex shrink-0 overflow-x-auto border-b border-border" role="tablist" aria-label={tx("Problem editor", "题目编辑")}>
          {sections.map((item, index) => <button type="button" key={item.id} id={`${id}-tab-${item.id}`} role="tab" aria-selected={section === item.id} aria-controls={`${id}-panel-${item.id}`} tabIndex={section === item.id ? 0 : -1}
            onClick={() => setSection(item.id)} onKeyDown={event => {
              const next = event.key === "ArrowRight" ? (index + 1) % sections.length : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault(); setSection(sections[next].id); document.getElementById(`${id}-tab-${sections[next].id}`)?.focus();
            }} className={`min-h-10 shrink-0 border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${section === item.id ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>{item.label}</button>)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <fieldset disabled={action.busy || !canEdit} className="min-w-0">
            <div id={`${id}-panel-statement`} role="tabpanel" aria-labelledby={`${id}-tab-statement`} hidden={section !== "statement"}>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="min-w-0 space-y-4">
                  <Field label={tx("Problem title", "题目标题")}><input className={input} value={draft.title} maxLength={200} onChange={event => change({ title: event.target.value })} /></Field>
                  <MathEditor fieldName="school-statement" label={tx("Statement / Markdown and LaTeX", "题面 / Markdown 与 LaTeX")} value={draft.statement} rows={11} disabled={action.busy || !canEdit} onChange={statement => change({ statement })} />
                </div>
                <aside className="space-y-4">
                  <Field label={tx("Problem bank", "所属题库")}>
                    {problem ? <input className={input} value={problem.bankName || banks.find(item => item.id === bank)?.name || ""} disabled /> : <select className={input} value={bank} onChange={event => setBank(event.target.value)}><option value="">{tx("Choose a bank", "选择题库")}</option>{banks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
                  </Field>
                  <div className="rounded-md border border-border bg-surface-subtle p-3 text-xs leading-5 text-muted-foreground">
                    <p className="font-semibold text-foreground">{problem?.published ? tx("Published version preserved", "保留已发布版本") : tx("Draft", "草稿")}</p>
                    <p>{tx("Changes are saved as a draft. Students continue to see the last published version until the new draft passes validation and is published.", "修改保存为草稿。新草稿通过验证并发布前，学生继续查看上次发布的版本。")}</p>
                  </div>
                </aside>
              </div>
            </div>
            <div id={`${id}-panel-interface`} role="tabpanel" aria-labelledby={`${id}-tab-interface`} hidden={section !== "interface"}>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={tx("Interface", "程序接口")}><select className={input} value={draft.mode} onChange={event => setDraft(value => schoolProblemMode(value, event.target.value as Definition["mode"]))}><option value="stdio">{tx("Standard input / output", "标准输入输出")}</option><option value="function">{tx("Function / JSON arguments", "函数 / JSON 参数")}</option></select></Field>
                  {draft.mode === "function" && <Field label={tx("Function name", "函数名称")}><input className={`${input} font-mono`} maxLength={80} value={draft.functionName ?? "solve"} onChange={event => change({ functionName: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">{tx("The judge calls this function with each case's arguments.", "判题程序会使用每条测试的参数调用此函数。")}</p></Field>}
                  <Field label={tx("Output comparison", "输出比较方式")}><select className={input} disabled={draft.mode === "function"} value={draft.mode === "function" ? "json" : draft.comparator} onChange={event => change({ comparator: event.target.value })}>{draft.mode !== "function" && <><option value="tokens">{tx("Tokens (ignore whitespace)", "按 token 比较（忽略空白）")}</option><option value="exact">{tx("Exact text", "精确文本")}</option></>}<option value="json">{tx("JSON value", "JSON 值")}</option></select></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={tx("Time limit (ms)", "时间限制（ms）")}><input className={input} type="number" min={100} max={5000} step={1} value={Number.isFinite(draft.timeLimitMs) ? draft.timeLimitMs : ""} onChange={event => change({ timeLimitMs: event.target.valueAsNumber })} /></Field>
                    <Field label={tx("Memory limit (MB)", "内存限制（MB）")}><input className={input} type="number" min={32} max={256} step={1} value={Number.isFinite(draft.memoryLimitMb) ? draft.memoryLimitMb : ""} onChange={event => change({ memoryLimitMb: event.target.valueAsNumber })} /></Field>
                  </div>
                </div>
                <ProgramField label={tx("Starter code · Python 3", "初始代码 · Python 3")} name="starter" code={draft.starterCode} onChange={starterCode => change({ starterCode })} disabled={action.busy || !canEdit} />
              </div>
            </div>
            <div id={`${id}-panel-tests`} role="tabpanel" aria-labelledby={`${id}-tab-tests`} hidden={section !== "tests"} className="space-y-5">
              <CaseRows kind="samples" draft={draft} change={change} />
              <CaseRows kind="tests" draft={draft} change={change} />
            </div>
            <div id={`${id}-panel-reference`} role="tabpanel" aria-labelledby={`${id}-tab-reference`} hidden={section !== "reference"} className="space-y-3">
              <p className="text-sm text-muted-foreground">{tx("Private teaching material. The reference program is used for isolated validation and is not included in the student's problem statement.", "教师私有资料。参考程序用于隔离验证，不会包含在学生题面中。")}</p>
              <ProgramField label={tx("Reference program · Python 3", "参考程序 · Python 3")} name="reference" code={draft.referenceCode ?? ""} onChange={referenceCode => change({ referenceCode })} disabled={action.busy || !canEdit} />
            </div>
          </fieldset>
        </div>
        <footer className="mt-4 shrink-0 border-t border-border pt-3">
          <Feedback action={action} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={action.busy} onClick={dismiss}>{tx("Cancel", "取消")}</Button><Button type="submit" disabled={action.busy || !canEdit}>{action.busy ? tx("Saving…", "保存中…") : tx("Save draft", "保存草稿")}</Button></div>
        </footer>
      </form>
    </DialogContent>
  </Dialog>;
}

function ProgramField({ label, name, code, onChange, disabled }: { label: string; name: string; code: string; onChange: (code: string) => void; disabled: boolean }) {
  const theme = useWorkspaceTheme();
  return <section className="min-w-0 space-y-2">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{label}</h3><CopyCodeButton code={code} /></div>
    <div className="h-72 overflow-hidden rounded-md border border-border"><CodeEditor idPrefix={`school-problem-${name}`} inputLabel={label} language="python" code={code} onChange={onChange} readOnly={disabled} settings={{ ...defaultWorkspaceSettings, theme: theme === "dark" ? "vs_dark" : "vs", fontSize: 13 }} /></div>
  </section>;
}

function CaseRows({ kind, draft, change }: { kind: "samples" | "tests"; draft: Definition; change: (patch: Partial<Definition>) => void }) {
  const { locale } = useLocale(), tx = (en: string, zh: string) => locale === "zh" ? zh : en;
  const formal = kind === "tests", rows = draft[kind] ?? [], limit = formal ? 100 : 20;
  const title = formal ? tx("Formal tests", "正式测试") : tx("Public samples", "公开样例");
  const setRows = (next: { input: string; expected: string; weight?: number }[]) => change(formal ? { tests: next.map(row => ({ ...row, weight: row.weight ?? 1 })) } : { samples: next });
  const weight = (draft.tests ?? []).reduce((sum, test) => sum + Math.round(test.weight * 10000), 0) / 10000;
  return <section className="overflow-hidden rounded-md border border-border">
    <div className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div><h3 className="text-sm font-bold">{title} · {rows.length}{formal && <span className={`ml-2 font-normal ${weight === 100 ? "text-muted-foreground" : "text-destructive"}`}>{tx("Weight", "权重")} {Number.isFinite(weight) ? weight : "—"}/100</span>}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{formal ? tx("Hidden inputs and expected results are never shown to students.", "隐藏输入与预期结果不会显示给学生。") : tx("Visible to students; excluded from formal scoring.", "学生可见，不计入正式得分。")}</p>
      </div>
      <div className="flex gap-2">{formal && <Button type="button" size="sm" variant="secondary" disabled={!rows.length} onClick={() => change({ tests: equalSchoolTestWeights(draft.tests ?? []) })}>{tx("Equal weights", "均分权重")}</Button>}<Button type="button" size="sm" disabled={rows.length >= limit} onClick={() => setRows([...rows, { input: "", expected: "", ...(formal ? { weight: 1 } : {}) }])}><Plus size={14} aria-hidden="true" />{tx("Add", "添加")}</Button></div>
    </div>
    <Table min={formal ? 700 : 600} headers={[tx("Case", "用例"), draft.mode === "function" ? tx("Arguments (JSON)", "参数（JSON）") : tx("Input", "输入"), draft.mode === "function" ? tx("Expected return (JSON)", "预期返回值（JSON）") : tx("Expected output", "预期输出"), ...(formal ? [tx("Weight", "权重")] : []), tx("Actions", "操作")]}>
      {rows.map((row, index) => <tr key={index}>
        <td className="w-12 align-top font-mono text-xs">{formal ? "T" : "S"}{index + 1}</td>
        {(["input", "expected"] as const).map(field => <td key={field} className="w-2/5 align-top"><textarea className={`${area} min-h-24 font-mono text-xs`} rows={3} spellCheck={false} aria-label={`${title} ${index + 1} · ${field === "input" ? tx("Input", "输入") : tx("Expected", "预期结果")}`} value={row[field]} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, [field]: event.target.value } : item))} /></td>)}
        {formal && <td className="w-24 align-top"><input className={`${input} w-24`} type="number" min={0.0001} max={100} step={0.0001} aria-label={`${title} ${index + 1} · ${tx("Weight", "权重")}`} value={"weight" in row && Number.isFinite(row.weight) ? row.weight as number : ""} onChange={event => setRows(rows.map((item, at) => at === index ? { ...item, weight: event.target.valueAsNumber } : item))} /></td>}
        <td className="align-top"><div className="flex gap-1"><Button type="button" size="icon" variant="ghost" disabled={rows.length >= limit} aria-label={`${tx("Copy", "复制")} ${title} ${index + 1}`} title={tx("Copy case", "复制用例")} onClick={() => setRows([...rows.slice(0, index + 1), { ...row }, ...rows.slice(index + 1)])}><Copy size={15} /></Button><Button type="button" size="icon" variant="ghost" aria-label={`${tx("Delete", "删除")} ${title} ${index + 1}`} title={tx("Delete case", "删除用例")} onClick={() => setRows(rows.filter((_, at) => at !== index))}><Trash2 size={15} /></Button></div></td>
      </tr>)}
      {!rows.length && <tr><td colSpan={formal ? 5 : 4} className="text-center text-muted-foreground">{tx("Add at least one case before saving.", "保存前请至少添加一条用例。")}</td></tr>}
    </Table>
    {draft.mode === "function" && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{tx('Use a JSON array of arguments, or {"args": [...], "kwargs": {...}}. For a single list argument, nest it inside the arguments array.', '参数使用 JSON 数组，或 {"args": [...], "kwargs": {...}}。一个列表参数需放在外层参数数组中。')}</p>}
  </section>;
}
