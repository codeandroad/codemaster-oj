"use client";

import { useState } from "react";
import { inputClass, useData } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { useSchoolText } from "./school-ui";
import type { AudienceMember, PlatformCourse } from "./platform-course-model";
import { directAdmissionRule, type AdmissionRule, type AudiencePolicy } from "./platform-course-admission-model";
import { PlatformCourseInvitation, PlatformCourseRuleEditor } from "./platform-course-rule-editor";

export function PlatformCourseAudience({ courseId, policy, onChange, schools, accounts, onSchools, onAccounts, disabled, dirty }: {
  courseId: string; policy: AudiencePolicy; onChange: (policy: AudiencePolicy) => void;
  schools: AudienceMember[]; accounts: AudienceMember[]; onSchools: (items: AudienceMember[]) => void; onAccounts: (items: AudienceMember[]) => void;
  disabled: boolean; dirty: boolean;
}) {
  const text = useSchoolText(), courses = useData<{ items: PlatformCourse[] }>("platform/courses");
  const [schoolPicker, setSchoolPicker] = useState(policy.schoolRules.length > 0), [accountPicker, setAccountPicker] = useState(policy.accountRules.length > 0);
  const [savedSchools, setSavedSchools] = useState(policy.schoolRules), [savedAccounts, setSavedAccounts] = useState(policy.accountRules), [savedIndependent, setSavedIndependent] = useState(policy.independentRule);
  const prerequisites = (courses.data?.items ?? []).filter(course => course.id !== courseId);
  const publicPoints = text("Public practice points", "公开练习积分");
  const schoolName = (id: string) => schools.find(item => item.id === id)?.name ?? text("Selected school", "指定学校");
  const accountName = (id: string) => {
    const account = accounts.find(item => item.id === id);
    return account ? `${account.name}${account.username ? ` (@${account.username})` : ""}` : text("Selected account", "指定账号");
  };
  const ruleView = (key: string, label: string, rule: AdmissionRule, update: (value: AdmissionRule) => void, pointsSource = publicPoints) => <div key={key} className="space-y-3" data-rule-target={key}>
    <PlatformCourseRuleEditor rule={rule} onChange={update} courses={prerequisites} pointsSource={pointsSource} disabled={disabled}/>
    {rule.admissionMode === "invite" && <PlatformCourseInvitation key={`${courseId}:${rule.ruleId ?? key}:${rule.generation ?? 0}`} courseId={courseId} rule={rule} label={label} disabled={disabled || dirty}/>}
  </div>;
  const summary = (rule: AdmissionRule) => [
    rule.admissionMode === "direct" ? text("direct access", "直接学习") : rule.admissionMode === "application" ? text("platform approval", "由平台管理员审批") : text("6-character invitation", "6 位邀请码加入"),
    ...(rule.prerequisiteCourseIds.length ? [text(`complete ${rule.prerequisiteCourseIds.length} prerequisite courses`, `完成 ${rule.prerequisiteCourseIds.length} 门前置课程`)] : []),
    ...(rule.minimumPoints > 0 ? [text(`at least ${rule.minimumPoints} points`, `积分至少 ${rule.minimumPoints}`)] : []),
  ].join(" · ");
  return <section className="min-w-0 space-y-4" data-od-id="platform-course-policy">
    <h3 className="text-sm font-semibold">{text("Audience and admission", "开放范围与准入")}</h3>
    <label className="grid gap-2 text-sm font-medium">{text("Audience", "开放范围")}<select className={inputClass} disabled={disabled} value={policy.scope} onChange={event => onChange({ ...policy, scope: event.target.value as AudiencePolicy["scope"], allRule: policy.allRule ?? directAdmissionRule() })}>
      <option value="all">{text("All registered users", "所有注册用户")}</option><option value="custom">{text("Custom audience", "自定义范围")}</option>
    </select></label>
    {courses.error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{courses.error}</p><Button type="button" variant="secondary" size="sm" onClick={courses.reload}>{text("Reload prerequisite courses", "重新加载前置课程")}</Button></div>}
    {policy.scope === "all" ? ruleView("all", text("All registered users", "所有注册用户"), policy.allRule ?? directAdmissionRule(), allRule => onChange({ ...policy, allRule })) : <div className="space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">{text("Meeting one complete rule is enough. School membership is checked across your schools, regardless of the current workspace.", "满足任意一条完整规则即可。学校资格按账号的有效成员身份匹配，不受当前工作区影响。")}</p>
      <div className="space-y-3 border-t border-border pt-3">
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4 shrink-0 accent-primary" disabled={disabled} checked={Boolean(policy.independentRule)} onChange={event => {
          if (!event.target.checked) setSavedIndependent(policy.independentRule);
          onChange({ ...policy, independentRule: event.target.checked ? savedIndependent ?? directAdmissionRule() : null });
        }}/>{text("Personal users without a school", "未加入学校的个人用户")}</label>
        {policy.independentRule && ruleView("independent", text("Personal users without a school", "未加入学校的个人用户"), policy.independentRule, independentRule => onChange({ ...policy, independentRule }))}
      </div>
      <div className="space-y-3 border-t border-border pt-3">
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4 shrink-0 accent-primary" disabled={disabled} checked={schoolPicker} onChange={event => {
          setSchoolPicker(event.target.checked); if (!event.target.checked) setSavedSchools(policy.schoolRules);
          onChange({ ...policy, schoolRules: event.target.checked ? savedSchools : [] });
        }}/>{text("Selected schools", "指定学校")}</label>
        {schoolPicker && <>
          <AudiencePicker kind="schools" selected={policy.schoolRules.map(rule => schools.find(school => school.id === rule.schoolId) ?? { id: rule.schoolId, name: schoolName(rule.schoolId) })} disabled={disabled} onSelected={items => {
            onSchools(items); onChange({ ...policy, schoolRules: items.map(item => policy.schoolRules.find(rule => rule.schoolId === item.id) ?? { schoolId: item.id, ...directAdmissionRule() }) });
          }}/>
          {policy.schoolRules.map(rule => <div key={rule.schoolId} className="space-y-3 border-t border-border pt-3"><h4 className="break-words text-sm font-semibold">{schoolName(rule.schoolId)}</h4>
            {ruleView(`school:${rule.schoolId}`, schoolName(rule.schoolId), rule, value => onChange({ ...policy, schoolRules: policy.schoolRules.map(item => item.schoolId === rule.schoolId ? { ...value, schoolId: rule.schoolId } : item) }), text(`${schoolName(rule.schoolId)} school points`, `${schoolName(rule.schoolId)}校内积分`))}
          </div>)}
        </>}
      </div>
      <div className="space-y-3 border-t border-border pt-3">
        <label className="flex min-h-10 items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4 shrink-0 accent-primary" disabled={disabled} checked={accountPicker} onChange={event => {
          setAccountPicker(event.target.checked); if (!event.target.checked) setSavedAccounts(policy.accountRules);
          onChange({ ...policy, accountRules: event.target.checked ? savedAccounts : [] });
        }}/>{text("Selected accounts", "指定账号")}</label>
        {accountPicker && <>
          <AudiencePicker kind="students" selected={policy.accountRules.map(rule => accounts.find(account => account.id === rule.identityId) ?? { id: rule.identityId, name: accountName(rule.identityId) })} disabled={disabled} onSelected={items => {
            onAccounts(items); onChange({ ...policy, accountRules: items.map(item => policy.accountRules.find(rule => rule.identityId === item.id) ?? { identityId: item.id, ...directAdmissionRule() }) });
          }}/>
          {policy.accountRules.map(rule => <div key={rule.identityId} className="space-y-3 border-t border-border pt-3"><h4 className="break-words text-sm font-semibold">{accountName(rule.identityId)}</h4>
            {ruleView(`account:${rule.identityId}`, accountName(rule.identityId), rule, value => onChange({ ...policy, accountRules: policy.accountRules.map(item => item.identityId === rule.identityId ? { ...value, identityId: rule.identityId } : item) }))}
          </div>)}
        </>}
      </div>
    </div>}
    <div className="space-y-2 rounded-md border border-border bg-surface-subtle p-3 text-xs leading-5" data-od-id="platform-admission-summary">
      <p className="font-semibold">{text("Effective rules after saving", "保存后生效的规则")}</p>
      {policy.scope === "all" ? <p>{text("All registered users", "所有注册用户")}：{summary(policy.allRule ?? directAdmissionRule())} · {publicPoints}</p> : <>
        {policy.independentRule && <p>{text("Personal users without a school", "未加入学校的个人用户")}：{summary(policy.independentRule)} · {publicPoints}</p>}
        {policy.schoolRules.map(rule => <p key={rule.schoolId}>{schoolName(rule.schoolId)}：{summary(rule)} · {text("school points", "校内积分")}</p>)}
        {policy.accountRules.map(rule => <p key={rule.identityId}>{accountName(rule.identityId)}：{summary(rule)} · {publicPoints}</p>)}
        {!policy.independentRule && !policy.schoolRules.length && !policy.accountRules.length && <p className="text-warning">{text("Choose at least one audience before saving.", "保存前请至少选择一项开放范围。")}</p>}
      </>}
      <p className="text-muted-foreground">{text("Requirements apply before direct access, an application, or invitation redemption. No points are spent.", "直接学习、申请或兑换邀请码均须满足对应门槛，不扣除积分。")}</p>
    </div>
  </section>;
}

function AudiencePicker({ kind, selected, onSelected, disabled }: {
  kind: "schools" | "students"; selected: AudienceMember[]; onSelected: (items: AudienceMember[]) => void; disabled: boolean;
}) {
  const text = useSchoolText(), [query, setQuery] = useState("");
  const resource = useData<{ items: AudienceMember[] }>(`platform/courses/audience?${new URLSearchParams({ kind, q: query })}`);
  const toggle = (item: AudienceMember) => onSelected(selected.some(value => value.id === item.id) ? selected.filter(value => value.id !== item.id) : [...selected, item]);
  return <div className="space-y-2 rounded-md border border-border p-3">
    <p className="text-xs text-muted-foreground">{text(`${selected.length} selected`, `已选择 ${selected.length} 项`)}</p>
    {selected.length > 0 && <ul className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">{selected.map(item => <li key={item.id} className="min-w-0 max-w-full"><Button type="button" size="sm" variant="secondary" className="h-auto min-h-8 max-w-full py-1 text-left" disabled={disabled} aria-label={text(`Remove ${item.name}`, `移除 ${item.name}`)} onClick={() => toggle(item)}><span className="min-w-0 break-words">{item.name}</span><span aria-hidden="true">×</span></Button></li>)}</ul>}
    <label className="grid gap-1 text-sm">{kind === "schools" ? text("Search schools", "搜索学校") : text("Search personal or school accounts", "搜索个人或学校账号")}<input type="search" className={inputClass} maxLength={100} disabled={disabled} value={query} onChange={event => setQuery(event.target.value)}/></label>
    {resource.pending ? <p role="status" className="text-xs text-muted-foreground">{text("Loading…", "正在加载…")}</p> : resource.error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{resource.error}</p><Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={resource.reload}>{text("Retry search", "重新搜索")}</Button></div> : <>
      <div className="max-h-40 overflow-y-auto">{resource.data?.items.map(item => <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-2 border-b border-border py-2 text-sm last:border-0"><input type="checkbox" className="size-4 shrink-0 accent-primary" disabled={disabled} checked={selected.some(value => value.id === item.id)} onChange={() => toggle(item)}/><span className="min-w-0 break-words">{item.name}{item.username && <span className="ml-1 text-muted-foreground">@{item.username}</span>}</span></label>)}</div>
      {!resource.data?.items.length && <p className="text-xs text-muted-foreground">{kind === "students" && query.length < 2 ? text("Enter at least two characters to find accounts.", "输入至少两个字符查找账号。") : text("No matches.", "没有找到匹配项。")}</p>}
    </>}
  </div>;
}
