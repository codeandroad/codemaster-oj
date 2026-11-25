"use client";

import { schoolClassApiPath } from "./school-workspace-location";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useRangeSelection } from "@/components/ui/use-range-selection";
import { Feedback, State, input, textarea, useData, useMutation } from "@/components/student/shared";
import { productionApi } from "@/lib/production-api";
import { defaultActivityAssistance, ActivityRuleFields, type ActivityRule } from "./school-scholarship";
import { useSchoolText } from "./school-ui";
import { activityDateInput, activityDateValue, moveActivityProblem, type ActivityKind, type ActivityOptions, type SchoolActivity } from "./school-activities-model";

const newAssignmentRule: ActivityRule = {
  amount: 0, minimumAc: 1, minimumScore: 0, requireAll: true, completionAvailable: true,
  taskKind: "challenge", allowSolutionAssisted: false, revision: 0,
  assistance: defaultActivityAssistance,
};

export function SchoolActivityEditor({ schoolId, kind, activity, onSaved, onCancel }: {
  schoolId: string; kind: ActivityKind; activity: SchoolActivity | null; onSaved: (activity: SchoolActivity) => void; onCancel: () => void;
}) {
  const text = useSchoolText();
  const base = `schools/${schoolId}/activities`;
  const options = useData<ActivityOptions>(schoolClassApiPath(`${base}/options`));
  const storedRule = useData<ActivityRule>(activity ? `schools/${schoolId}/scholarship/activity-rule?activityId=${activity.id}` : "");
  const [editedRule, setEditedRule] = useState<ActivityRule | null>(null);
  const originalRule = storedRule.data;
  const rule = editedRule ?? (originalRule ? {
    ...originalRule, requireAll: originalRule.requireAll || (originalRule.completionAvailable && originalRule.revision === 0),
  } : newAssignmentRule);
  const showReward = kind === "assignment" || Boolean(activity);
  const ruleReady = !activity || Boolean(originalRule && !storedRule.error && !storedRule.loading);
  const action = useMutation(), pending = useRef(false), request = useRef(crypto.randomUUID());
  const [tab, setTab] = useState("basic"), [title, setTitle] = useState(activity?.title ?? ""), [description, setDescription] = useState(activity?.description ?? "");
  const [startsAt, setStartsAt] = useState(activityDateInput(activity?.startsAt ?? null)), [endsAt, setEndsAt] = useState(activityDateInput(activity?.endsAt ?? null));
  const [duration, setDuration] = useState(activity?.durationMinutes ?? 60);
  const [selected, setSelected] = useState(activity?.problems.map(p => ({ problemId: p.id, versionId: p.versionId, points: p.points, title: p.title })) ?? []);
  const [students, setStudents] = useState(activity?.identityIds ?? []);
  const [classes, setClasses] = useState(activity?.classIds ?? []);
  const classStudents = new Set(options.data?.students.filter(s => s.classIds.some(id => classes.includes(id))).map(s => s.id));
  const recipients = new Set([...students, ...classStudents]);
  const [picker, setPicker] = useState(false), [query, setQuery] = useState(""), [bank, setBank] = useState("");
  const [studentQuery, setStudentQuery] = useState(""), [classFilter, setClassFilter] = useState("");
  const problems = options.data?.problems.filter(p => (!bank || p.bankId === bank) && p.title.toLowerCase().includes(query.toLowerCase())) ?? [];
  const candidates = options.data?.students.filter(s => (!classFilter || (classFilter === "unassigned" ? !s.classIds.length : s.classIds.includes(classFilter))) && `${s.name} ${s.number}`.toLowerCase().includes(studentQuery.toLowerCase())) ?? [];
  const problemRange = useRangeSelection(problems.map(p => ({ id: p.problemId })), `${bank}:${query}`);
  const studentRange = useRangeSelection(candidates, `${classFilter}:${studentQuery}`);
  const addProblems = (problemIds: string[], checked: boolean) => setSelected(old => checked ? [...old, ...problems.filter(p => problemIds.includes(p.problemId) && !old.some(x => x.problemId === p.problemId)).map(p => ({ ...p, points: 100 }))] : old.filter(p => !problemIds.includes(p.problemId)));
  const selectStudents = (ids: string[], checked: boolean) => setStudents(old => checked ? [...new Set([...old, ...ids])] : old.filter(id => !ids.includes(id)));
  async function save() {
    if (pending.current) return;
    pending.current = true;
    await action.run(async () => {
      if (!title.trim()) {
        setTab("basic");
        throw new Error(text("Enter the assignment title.", "请填写标题。"));
      }
      if (editedRule && (!Number.isInteger(rule.amount) || rule.amount < 0 || rule.amount > (options.data?.activityRewardCap ?? 0))) {
        setTab("basic");
        throw new Error(text(`Enter a scholarship amount from 0 to ${options.data?.activityRewardCap}.`, `奖学金金额应为 0 至 ${options.data?.activityRewardCap} 的整数。`));
      }
      const scholarshipRule = editedRule && {
        amount: editedRule.amount, minimumAc: editedRule.minimumAc, minimumScore: editedRule.minimumScore,
        requireAll: editedRule.requireAll, taskKind: editedRule.taskKind, allowSolutionAssisted: editedRule.allowSolutionAssisted,
        expectedRevision: editedRule.revision,
        ...(JSON.stringify(editedRule.assistance) !== JSON.stringify((originalRule ?? newAssignmentRule).assistance)
          && { assistance: editedRule.assistance }),
      };
      const value = await productionApi<SchoolActivity>(schoolClassApiPath(`${base}${activity ? `/${activity.id}` : ""}`), { method: activity ? "PATCH" : "POST", body: {
        kind, title, description, startsAt: activityDateValue(startsAt), endsAt: activityDateValue(endsAt), durationMinutes: duration,
        problems: selected.map(({ problemId, versionId, points }) => ({ problemId, versionId, points })), identityIds: students, classIds: classes,
        ...(scholarshipRule && { scholarshipRule }),
        expectedRevision: activity?.revision, requestId: request.current,
      } });
      onSaved(value);
    });
    pending.current = false;
  }
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3"><h1 className="font-semibold">{activity ? text("Edit draft", "编辑草稿") : text(kind === "timed" ? "New timed practice" : "New assignment", kind === "timed" ? "新建限时训练" : "新建作业")}</h1><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={action.busy} onClick={onCancel}>{text("Cancel", "取消")}</Button><Button size="sm" disabled={action.busy || !options.data || !ruleReady} onClick={() => void save()}>{action.busy ? text("Saving…", "保存中…") : text("Save draft", "保存草稿")}</Button></div></div>
    <Feedback action={action}/>
    {activity && storedRule.error && <State data={storedRule}>{null}</State>}
    <State data={options}>
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex overflow-x-auto border-b border-border px-3" role="tablist" aria-label={text("Activity editor", "活动编辑")}>
          {[["basic", "Basic information", "基本信息"], ["problems", "Problems", "题目"], ["recipients", "Recipients", "学生名单"], ["rules", "Rules", "规则"], ["preview", "Preview", "预览"]].map(([id, en, zh]) => <button type="button" role="tab" aria-selected={tab === id} key={id} className={`border-b-2 px-4 py-3 text-sm font-semibold ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`} onClick={() => setTab(id)}>{text(en, zh)}</button>)}
        </div>
        <div className="p-4">
          {tab === "basic" && <div className="grid items-start gap-6 lg:grid-cols-2">
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm font-medium">{text("Title", "标题")}<input className={input} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)}/></label>
              <label className="grid gap-1.5 text-sm font-medium">{text("Instructions", "作业说明")}<textarea className={textarea} rows={4} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)}/></label>
            </div>
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">{text("Opens at", "开放时间")}{kind === "assignment" && <span className="text-xs font-normal text-muted-foreground">{text("Optional · immediately when empty", "选填，留空则立即开放")}</span>}<input type="datetime-local" className={input} value={startsAt} onChange={e => setStartsAt(e.target.value)}/></label><label className="grid gap-1.5 text-sm font-medium">{text(kind === "assignment" ? "Deadline" : "Closes at", "截止时间")}{kind === "assignment" && <span className="text-xs font-normal text-muted-foreground">{text("Optional · no deadline when empty", "选填，留空则不设截止")}</span>}<input type="datetime-local" className={input} value={endsAt} onChange={e => setEndsAt(e.target.value)}/></label></div>
              {kind === "assignment" && ruleReady && <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1.5 text-sm font-medium">{text("Assignment completion scholarship", "作业完成奖学金")}
                  <input className={input} type="number" min={0} max={options.data?.activityRewardCap} step={1} value={rule.amount}
                    onChange={e => setEditedRule({ ...rule, amount: Number(e.target.value) })}/>
                  <span className="text-xs font-normal text-muted-foreground">{text(`0 disables the reward · school limit ${options.data?.activityRewardCap}`, `0 表示不发放，学校上限 ${options.data?.activityRewardCap}`)}</span>
                </label>
                <Button size="sm" variant="secondary" onClick={() => setTab("rules")}>{text("Award conditions", "设置发放条件")}</Button>
              </div>}
            </div>
          </div>}
          {tab === "problems" && <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{selected.length} {text("problems", "道题")} · {selected.reduce((n, p) => n + p.points, 0)} {text("marks", "分")}</span><Button size="sm" variant="secondary" onClick={() => setPicker(true)}><Plus size={15}/>{text("Choose from banks", "从题库选择")}</Button></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-border bg-surface-subtle text-muted-foreground"><tr><th className="p-2">#</th><th className="p-2">{text("Problem", "题目")}</th><th className="w-28 p-2">{text("Marks", "分值")}</th><th className="w-32 p-2">{text("Order", "顺序")}</th></tr></thead><tbody>{selected.map((p, index) => <tr key={p.problemId} className="border-b border-border"><td className="p-2 tabular-nums">{index + 1}</td><td className="p-2 font-medium">{p.title}</td><td className="p-2"><input type="number" min={1} max={1000} aria-label={`${p.title} ${text("marks", "分值")}`} className={input} value={p.points} onChange={e => setSelected(old => old.map(row => row.problemId === p.problemId ? { ...row, points: Number(e.target.value) } : row))}/></td><td className="p-2"><div className="flex"><Button size="sm" variant="ghost" disabled={!index} aria-label={text("Move up", "上移")} onClick={() => setSelected(old => moveActivityProblem(old, index, -1))}><ArrowUp size={14}/></Button><Button size="sm" variant="ghost" disabled={index === selected.length - 1} aria-label={text("Move down", "下移")} onClick={() => setSelected(old => moveActivityProblem(old, index, 1))}><ArrowDown size={14}/></Button><Button size="sm" variant="ghost" aria-label={text("Remove problem", "移除题目")} onClick={() => setSelected(old => old.filter(row => row.problemId !== p.problemId))}><Trash2 size={14}/></Button></div></td></tr>)}</tbody></table>{!selected.length && <p className="p-6 text-center text-sm text-muted-foreground">{text("Choose published problems. Their versions and order are saved with this activity.", "请选择已发布题目。活动保存题目版本和排列顺序。")}</p>}</div></div>}
          {tab === "recipients" && <div className="space-y-3">
            {!!options.data?.classes.length && <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
              <legend className="mb-2 text-sm font-semibold">{text("Assign to entire classes", "按整班布置")}</legend>
              {options.data.classes.map(c => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={classes.includes(c.id)}
                onChange={e => setClasses(old => e.target.checked ? [...old, c.id] : old.filter(id => id !== c.id))}/>{c.name}</label>)}
            </fieldset>}
            <div className="flex flex-wrap items-center gap-2"><input className={`${input} max-w-xs`} placeholder={text("Search name or student ID", "搜索姓名或学号")} aria-label={text("Search students", "搜索学生")} value={studentQuery} onChange={e => setStudentQuery(e.target.value)}/><select className={`${input} max-w-xs`} value={classFilter} onChange={e => setClassFilter(e.target.value)} aria-label={text("Filter class", "筛选班级")}><option value="">{text("All classes", "所有班级")}</option><option value="unassigned">{text("Unassigned students", "未分班学生")}</option>{options.data?.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><span className="text-sm text-muted-foreground">{recipients.size} {text("selected", "人已选")}</span></div><div className="max-h-96 overflow-auto rounded border border-border"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-surface-subtle"><tr><th className="w-10 p-2"><input type="checkbox" aria-label={text("Select filtered students", "选择筛选出的学生")} checked={!!candidates.length && candidates.every(s => recipients.has(s.id))} onChange={e => selectStudents(candidates.map(s => s.id), e.target.checked)}/></th><th className="p-2">{text("Student ID", "学号")}</th><th className="p-2">{text("Name", "姓名")}</th><th className="p-2">{text("Account", "账号")}</th></tr></thead><tbody>{candidates.map(s => <tr key={s.id} className="border-t border-border"><td className="p-2"><input type="checkbox" checked={recipients.has(s.id)} disabled={classStudents.has(s.id)} aria-label={`${text("Select", "选择")} ${s.name}`} onChange={e => { const range = studentRange.getRange(s.id, e); selectStudents(range ?? [s.id], range ? true : e.target.checked); }}/></td><td className="p-2 font-mono text-xs">{s.number}</td><td className="p-2">{s.name}</td><td className="p-2 text-muted-foreground">{s.activated ? text("Active", "已激活") : text("Not activated", "未激活")}</td></tr>)}</tbody></table></div><p className="text-xs text-muted-foreground">{text("Select students across classes, including those without a class. Shift-click selects a range. The published roster stays fixed.", "支持跨班级及未分班学生；Shift 点击连续选择。发布后名单固定。")}</p></div>}
          {tab === "rules" && <div className="max-w-3xl space-y-4">{showReward && ruleReady && <fieldset className="space-y-3">
            <legend className="font-semibold">{text("Scholarship and assistance", "奖学金与辅助规则")}</legend>
            <ActivityRuleFields draft={rule} setDraft={setEditedRule} cap={options.data?.activityRewardCap}/>
          </fieldset>}{kind === "timed" && <label className="grid max-w-xs gap-1.5 text-sm font-medium">{text("Duration (minutes)", "答题时长（分钟）")}<input className={input} type="number" min={1} max={1440} value={duration} onChange={e => setDuration(Number(e.target.value))}/></label>}<p className="text-sm text-muted-foreground">{text("Times use Asia/Shanghai (UTC+8). Rules and recipients freeze when published.", "时间使用 Asia/Shanghai（UTC+8）。发布后规则及名单冻结。")}</p><p className="text-sm text-muted-foreground">{kind === "timed" ? text("Each student gets one timed attempt. The earlier of their personal deadline and closing time applies. Formal scores are hidden until results are published.", "每人一次限时答题，以个人有效截止时间与活动关闭时间中较早者为准。正式成绩在教师公布后可见。") : text("The best formal score received by the deadline counts. Students can still submit after the deadline without earning assignment scholarship. A formal AC on the same version elsewhere by the deadline gives full credit without another submission or activity rewards.", "取截止前有效正式提交的最高分。学生可在截止后补交，补交不发放作业奖学金。同版本在其他入口于截止前正式 AC 可直接计满分，无需重复提交，也不额外发放活动奖励。")}</p></div>}
          {tab === "preview" && <div className="space-y-3"><h2 className="text-xl font-bold">{title || text("Untitled draft", "未命名草稿")}</h2><p className="whitespace-pre-wrap text-sm">{description}</p><p className="text-sm text-muted-foreground">{selected.length} {text("problems", "道题")} · {recipients.size} {text("students", "名学生")} · {selected.reduce((n, p) => n + p.points, 0)} {text("marks", "分")}</p>{showReward && ruleReady && <p className="text-sm">{text("Scholarship", "奖学金")} · {rule.amount}
            {rule.amount > 0 && <> · {rule.requireAll ? text("Pass every required problem", "通过全部必做题")
              : text(`At least ${rule.minimumAc} accepted and ${rule.minimumScore}%`, `至少通过 ${rule.minimumAc} 题且得分达到 ${rule.minimumScore}%`)}
              · {rule.allowSolutionAssisted ? text("Solution assistance allowed", "允许题解辅助") : text("Unassisted", "独立完成")}</>}
          </p>}<ol className="list-inside list-decimal space-y-1 text-sm">{selected.map(p => <li key={p.problemId}>{p.title} <span className="text-muted-foreground">({p.points})</span></li>)}</ol></div>}
        </div>
      </section>
    </State>
    <Dialog open={picker} onOpenChange={setPicker}><DialogContent className="max-w-3xl"><DialogTitle>{text("Choose from banks", "从题库选择")}</DialogTitle><DialogDescription>{text("Published versions only. Shift-click to select a range; use the arrows to set the saved order.", "仅选择已发布版本。Shift 点击连续勾选，添加后可用箭头调整保存顺序。")}</DialogDescription><div className="flex gap-2"><select className={input} value={bank} onChange={e => setBank(e.target.value)} aria-label={text("Bank", "题库")}><option value="">{text("All banks", "所有题库")}</option>{[...new Map(options.data?.problems.map(p => [p.bankId, p.bankName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><input className={input} placeholder={text("Search problems", "搜索题目")} value={query} onChange={e => setQuery(e.target.value)}/></div><div className="max-h-[55vh] overflow-auto rounded border border-border"><label className="flex gap-3 border-b border-border bg-surface-subtle p-3 text-sm"><input type="checkbox" checked={!!problems.length && problems.every(p => selected.some(s => s.problemId === p.problemId))} onChange={e => addProblems(problems.map(p => p.problemId), e.target.checked)}/>{text("Select filtered problems", "选择筛选出的题目")}</label>{problems.map(p => <label key={p.problemId} className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2.5 text-sm last:border-0"><input className="mt-1" type="checkbox" checked={selected.some(s => s.problemId === p.problemId)} onChange={e => { const range = problemRange.getRange(p.problemId, e); addProblems(range ?? [p.problemId], range ? true : e.target.checked); }}/><span><b>{p.title}</b><span className="ml-2 text-xs text-muted-foreground">{p.bankName}</span></span></label>)}</div><div className="flex justify-end"><Button onClick={() => setPicker(false)}>{text("Done", "完成")} ({selected.length})</Button></div></DialogContent></Dialog>
  </div>;
}
