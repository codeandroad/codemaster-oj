"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Feedback, Loading, inputClass, useData, useMutation } from "@/components/admin/common";
import { productionApi, type ProductionProblem, type ProblemCase } from "@/lib/production-api";
import { useDirty } from "@/components/teacher/shared";
import { PlatformContentEditors } from "./platform-content-editors";
import { useSchoolText } from "./school-ui";

type Problem = ProductionProblem & { tests: ProblemCase[]; referenceCode: string; referenceLanguage?: string; canPublish?: boolean; inputDescription?: string; outputDescription?: string };
type Summary = { id: string; title: string; published: boolean; validationStatus: string };

export function PlatformProblems() {
  const text = useSchoolText(), data = useData<{ items: Summary[]; canManage: boolean }>("platform/source-problems");
  const [selected, setSelected] = useState<string | null>(null), [grant, setGrant] = useState<Summary | null>(null), [query, setQuery] = useState("");
  if (selected) return <ProblemDetail id={selected} onClose={() => { setSelected(null); data.reload(); }}/>;
  const items = data.data?.items.filter(item => item.title.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">{text("Maintain platform-owned problem sources. Editing a draft preserves the versions used by courses and previous submissions.", "维护平台自有题目。修改草稿会保留课程所关联的版本和历史提交记录。")}</p>
    <label className="grid max-w-lg gap-2 text-sm">{text("Search problems", "搜索题目")}<input className={inputClass} value={query} onChange={e => setQuery(e.target.value)}/></label>
    <Loading resource={data}><ul className="divide-y divide-border rounded-lg border border-border bg-surface">{items.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0 flex-1 break-words text-sm"><h2 className="font-semibold">{item.title}</h2><p className="mt-1 text-xs text-muted-foreground">{item.published ? text("Published", "已发布") : text("Draft", "草稿")} · {item.validationStatus}</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setSelected(item.id)}>{text("Edit", "编辑")}</Button>{data.data?.canManage && <Button size="sm" variant="ghost" onClick={() => setGrant(item)}>{text("Editors", "编辑授权")}</Button>}</div></li>)}</ul>{!items.length && <p className="text-sm text-muted-foreground">{text("No editable problems.", "暂无可编辑题目。")}</p>}</Loading>
    {grant && <PlatformContentEditors kind="problem" id={grant.id} title={grant.title} onClose={() => setGrant(null)}/>}
  </div>;
}
function ProblemDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const data = useData<Problem>(`platform/source-problems/${id}`), text = useSchoolText();
  return <><Button variant="ghost" onClick={onClose}>{text("Back to problems", "返回题目列表")}</Button><Loading resource={data}>{data.data && <ProblemEditor key={data.data.versionId} problem={data.data} onSaved={data.reload}/>}</Loading></>;
}
function ProblemEditor({ problem, onSaved }: { problem: Problem; onSaved: () => void }) {
  const text = useSchoolText(), action = useMutation();
  const [draft, setDraft] = useState(problem);
  const dirty = JSON.stringify(draft) !== JSON.stringify(problem);
  useDirty(dirty);
  const update = (patch: Partial<Problem>) => setDraft(value => ({ ...value, ...patch }));
  const save = () => action.run(async () => {
    await productionApi(`platform/source-problems/${problem.id}/versions`, { method: "POST", body: { ...draft, expectedVersionId: problem.versionId, saveDraft: true } });
    onSaved();
  });
  return <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save(); }}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{text("Edit platform problem", "编辑平台题目")}</h2><Button type="submit" disabled={action.busy || !dirty}>{text("Save new version", "保存新版本")}</Button></div>
    <Feedback action={action}/>
    <fieldset disabled={action.busy} className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <label className="grid gap-2 text-sm font-semibold">{text("Title", "题目名称")}<input required maxLength={200} className={inputClass} value={draft.title} onChange={e => update({ title: e.target.value })}/></label>
      <label className="grid gap-2 text-sm font-semibold">{text("Statement", "题目说明")}<textarea className={inputClass} rows={10} value={draft.statement} onChange={e => update({ statement: e.target.value })}/></label>
      <div className="grid gap-4 sm:grid-cols-2">{([['inputDescription', 'Input description', '输入说明'], ['outputDescription', 'Output description', '输出说明']] as const).map(([key, en, zh]) => <label key={key} className="grid gap-2 text-sm">{text(en, zh)}<textarea className={inputClass} rows={3} value={draft[key] ?? ""} onChange={e => update({ [key]: e.target.value })}/></label>)}</div>
      {draft.mode === "function" && <label className="grid gap-2 text-sm">{text("Function name", "函数名称")}<input className={inputClass} value={draft.functionName ?? ""} onChange={e => update({ functionName: e.target.value })}/></label>}
      <label className="grid gap-2 text-sm">{text("Starter code", "初始代码")}<textarea className={`${inputClass} font-mono`} rows={5} value={draft.starterCode ?? ""} onChange={e => update({ starterCode: e.target.value })}/></label>
      <label className="grid gap-2 text-sm">{text("Reference language", "参考解答语言")}<select className={inputClass} value={draft.referenceLanguage ?? "python"} onChange={e => update({ referenceLanguage: e.target.value })}><option value="python">Python</option><option value="cpp">C++</option><option value="javascript">JavaScript</option></select></label>
      <label className="grid gap-2 text-sm">{text("Reference solution", "参考解答")}<textarea className={`${inputClass} font-mono`} rows={10} value={draft.referenceCode} onChange={e => update({ referenceCode: e.target.value })}/></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">{text("Time limit (ms)", "时间限制（毫秒）")}<input className={inputClass} type="number" min={100} max={5000} value={draft.timeLimitMs} onChange={e => update({ timeLimitMs: Number(e.target.value) })}/></label><label className="grid gap-2 text-sm">{text("Memory limit (MB)", "内存限制（MB）")}<input className={inputClass} type="number" min={32} max={256} value={draft.memoryLimitMb} onChange={e => update({ memoryLimitMb: Number(e.target.value) })}/></label></div>
      <Cases title={text("Public samples", "公开样例")} values={draft.samples} onChange={samples => update({ samples })}/>
      <Cases title={text("Formal tests", "正式测试")} values={draft.tests} onChange={tests => update({ tests })} formal/>
    </fieldset>
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4"><p className="min-w-0 flex-1 text-sm">{text("Validation", "校验状态")}: {problem.validationStatus}. {text("Publishing preserves existing course version pins. Update a course link explicitly to use a new version.", "发布不会改变课程已关联的版本；使用新版本需明确更新课程关联。")}</p><Button type="button" variant="secondary" disabled={action.busy} onClick={onSaved}>{text("Refresh status", "刷新状态")}</Button>{problem.canPublish && <Button type="button" disabled={action.busy || dirty || problem.published || problem.validationStatus !== "AC"} onClick={() => void action.run(async () => { await productionApi(`platform/source-problems/${problem.id}/publish`, { method: "POST", body: { expectedVersionId: problem.versionId } }); onSaved(); })}>{text("Publish version", "发布版本")}</Button>}</div>
  </form>;
}
function Cases({ title, values, onChange, formal = false }: { title: string; values: ProblemCase[]; onChange: (items: ProblemCase[]) => void; formal?: boolean }) {
  const text = useSchoolText();
  return <section className="space-y-3"><h3 className="text-sm font-semibold">{title}</h3>{values.map((item, index) => <div key={index} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2">{(["input", "expected"] as const).map(key => <label key={key} className="grid gap-1 text-sm">{text(key === "input" ? "Input" : "Expected output", key === "input" ? "输入" : "预期输出")} {index + 1}<textarea className={`${inputClass} font-mono`} rows={3} value={item[key]} onChange={e => onChange(values.map((value, i) => i === index ? { ...value, [key]: e.target.value } : value))}/></label>)}{formal && <label className="grid gap-1 text-sm">{text("Weight (%)", "权重（%）")}<input className={inputClass} type="number" min={0.0001} max={100} step="any" value={item.weight ?? 0} onChange={e => onChange(values.map((value, i) => i === index ? { ...value, weight: Number(e.target.value) } : value))}/></label>}<Button type="button" variant="ghost" size="sm" onClick={() => onChange(values.filter((_, i) => i !== index))}>{text("Remove case", "移除用例")}</Button></div>)}<Button type="button" size="sm" variant="secondary" onClick={() => onChange([...values, { input: "", expected: "", ...(formal ? { weight: values.length ? 1 : 100 } : {}) }])}>{text("Add case", "添加用例")}</Button></section>;
}
