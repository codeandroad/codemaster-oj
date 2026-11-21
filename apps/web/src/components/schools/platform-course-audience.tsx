"use client";

import { useId, useRef, useState } from "react";
import { inputClass, useData } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { useSchoolText } from "./school-ui";
import type { AudienceMember, PlatformCourse } from "./platform-course-model";
import { directAdmissionRule, type AdmissionRule, type AudiencePolicy } from "./platform-course-admission-model";
import { PlatformCourseInvitation, PlatformCourseRuleEditor } from "./platform-course-rule-editor";

export function PlatformCourseAudience({ courseId, policy, onChange, schools, accounts, onSchools, onAccounts, catalogSchools, onCatalogSchools, disabled, dirty }: {
  courseId: string; policy: AudiencePolicy; onChange: (policy: AudiencePolicy) => void;
  schools: AudienceMember[]; accounts: AudienceMember[]; onSchools: (items: AudienceMember[]) => void; onAccounts: (items: AudienceMember[]) => void;
  catalogSchools: AudienceMember[]; onCatalogSchools: (items: AudienceMember[]) => void;
  disabled: boolean; dirty: boolean;
}) {
  const text = useSchoolText(), courses = useData<{ items: PlatformCourse[] }>("platform/courses?view=summary");
  const [schoolPicker, setSchoolPicker] = useState(policy.schoolRules.length > 0), [accountPicker, setAccountPicker] = useState(policy.accountRules.length > 0);
  const [savedSchools, setSavedSchools] = useState(policy.schoolRules), [savedAccounts, setSavedAccounts] = useState(policy.accountRules), [savedIndependent, setSavedIndependent] = useState(policy.independentRule);
  const otherScopeSchools = useRef<AudiencePolicy["schoolRules"]>([]);
  const prerequisites = (courses.data?.items ?? []).filter(course => course.id !== courseId);
  const schoolName = (id: string) => schools.find(item => item.id === id)?.name ?? text("Selected school", "指定学校");
  const accountName = (id: string) => {
    const account = accounts.find(item => item.id === id);
    return account ? `${account.name}${account.username ? ` (@${account.username})` : ""}` : text("Selected account", "指定账号");
  };
  const ruleView = (key: string, label: string, rule: AdmissionRule, update: (value: AdmissionRule) => void) => <div key={key} className="space-y-3" data-rule-target={key}>
    <PlatformCourseRuleEditor rule={rule} onChange={update} courses={prerequisites} disabled={disabled}/>
    {rule.admissionMode === "invite" && <PlatformCourseInvitation key={`${courseId}:${rule.ruleId ?? key}:${rule.generation ?? 0}`} courseId={courseId} rule={rule} label={label} disabled={disabled || dirty}/>}
  </div>;
  const summary = (rule: AdmissionRule) => {
    const method = rule.admissionMode === "direct" ? text("direct access", "直接学习") : rule.admissionMode === "application" ? text("platform approval", "由平台管理员审批") : text("6-character invitation", "6 位邀请码加入");
    const conditions = [
      ...rule.prerequisiteCourseIds.map(id => {
        const title = prerequisites.find(course => course.id === id)?.title;
        return title ? text(`Complete ${title}`, `完成「${title}」`) : text("Complete a prerequisite course", "完成一门前置课");
      }),
      ...(rule.minimumPoints > 0 ? [text(`${rule.minimumPoints} platform points`, `平台积分至少 ${rule.minimumPoints}`)] : []),
    ];
    const join = rule.requirementMode === "any" ? text(" or ", " 或 ") : text(" and ", " 且 ");
    return conditions.length ? `${method} · ${conditions.join(join)}` : method;
  };
  return <section className="min-w-0 space-y-4" data-od-id="platform-course-policy">
    <h3 className="text-sm font-semibold">{text("Audience and admission", "开放范围与准入")}</h3>
    <label className="grid gap-2 text-sm font-medium">{text("Audience", "开放范围")}<select className={inputClass} disabled={disabled} value={policy.scope} onChange={event => {
      const schoolRules = otherScopeSchools.current;
      otherScopeSchools.current = policy.schoolRules;
      if (event.target.value === "custom") setSchoolPicker(schoolRules.length > 0);
      onChange({ ...policy, scope: event.target.value as AudiencePolicy["scope"], schoolRules, allRule: policy.allRule ?? directAdmissionRule() });
    }}>
      <option value="all">{text("All registered users", "所有注册用户")}</option><option value="custom">{text("Custom audience", "自定义范围")}</option>
    </select></label>
    {courses.error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{courses.error}</p><Button type="button" variant="secondary" size="sm" onClick={courses.reload}>{text("Reload prerequisite courses", "重新加载前置课程")}</Button></div>}
    {policy.scope === "all" ? <>
      {ruleView("all", text("All registered users", "所有注册用户"), policy.allRule ?? directAdmissionRule(), allRule => onChange({ ...policy, allRule }))}
      <section aria-label={text("School catalog visibility", "校内展示")} className="space-y-2 border-t border-border pt-4">
        <h4 className="text-sm font-semibold">{text("School catalog visibility", "校内展示")}</h4>
        <p className="text-sm text-muted-foreground">{text(
          "Selected schools show this course in their school catalog. By default the public rule applies. Members may also qualify through an additional school rule in either catalog.",
          "所选学校会在「本校」课程列表展示这门课，默认沿用公开规则。添加学校规则后，该校成员满足公开或本校任一条完整规则，即可从两个页签学习。",
        )}</p>
        <AudiencePicker kind="schools" selected={catalogSchools} onSelected={items => {
          onCatalogSchools(items);
          onChange({ ...policy, schoolRules: policy.schoolRules.filter(rule => items.some(item => item.id === rule.schoolId)) });
        }} disabled={disabled}/>
        {catalogSchools.map(school => {
          const rule = policy.schoolRules.find(item => item.schoolId === school.id);
          const update = (value?: AdmissionRule) => onChange({ ...policy, schoolRules: [
            ...policy.schoolRules.filter(item => item.schoolId !== school.id), ...(value ? [{ ...value, schoolId: school.id }] : []),
          ] });
          return <fieldset key={school.id} className="space-y-2 border-t border-border pt-2" disabled={disabled}>
            <legend className="text-sm font-semibold">{school.name}</legend>
            <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={!!rule}
              onChange={event => update(event.target.checked ? directAdmissionRule() : undefined)}/>
              {text("Add an admission rule for this school", "为该校增加准入规则")}</label>
            {rule && ruleView(`school:${school.id}`, school.name, rule, update)}
          </fieldset>;
        })}
      </section>
    </> : <div className="space-y-4">
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
          <AudiencePicker kind="schools" showAdmissionHint selected={policy.schoolRules.map(rule => schools.find(school => school.id === rule.schoolId) ?? { id: rule.schoolId, name: schoolName(rule.schoolId) })} disabled={disabled} onSelected={items => {
            onSchools(items); onChange({ ...policy, schoolRules: items.map(item => policy.schoolRules.find(rule => rule.schoolId === item.id) ?? { schoolId: item.id, ...directAdmissionRule() }) });
          }}/>
          {policy.schoolRules.map(rule => <div key={rule.schoolId} className="space-y-3 border-t border-border pt-3"><h4 className="break-words text-sm font-semibold">{schoolName(rule.schoolId)}</h4>
            {ruleView(`school:${rule.schoolId}`, schoolName(rule.schoolId), rule, value => onChange({ ...policy, schoolRules: policy.schoolRules.map(item => item.schoolId === rule.schoolId ? { ...value, schoolId: rule.schoolId } : item) }))}
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
      {policy.scope === "all" ? <><p>{text("All registered users", "所有注册用户")}：{summary(policy.allRule ?? directAdmissionRule())}</p>{policy.schoolRules.map(rule => <p key={rule.schoolId}>{catalogSchools.find(school => school.id === rule.schoolId)?.name}：{summary(rule)}</p>)}</> : <>
        {policy.independentRule && <p>{text("Personal users without a school", "未加入学校的个人用户")}：{summary(policy.independentRule)}</p>}
        {policy.schoolRules.map(rule => <p key={rule.schoolId}>{schoolName(rule.schoolId)}：{summary(rule)}</p>)}
        {policy.accountRules.map(rule => <p key={rule.identityId}>{accountName(rule.identityId)}：{summary(rule)}</p>)}
        {!policy.independentRule && !policy.schoolRules.length && !policy.accountRules.length && <p className="text-warning">{text("Choose at least one audience before saving.", "保存前请至少选择一项开放范围。")}</p>}
      </>}
      <p className="text-muted-foreground">{text("Requirements apply before direct access, an application, or invitation redemption. No points are spent.", "直接学习、申请或兑换邀请码均须满足对应门槛，不扣除积分。")}</p>
    </div>
  </section>;
}

function AudiencePicker({ kind, selected, onSelected, disabled, showAdmissionHint = false }: {
  kind: "schools" | "students"; selected: AudienceMember[]; onSelected: (items: AudienceMember[]) => void; disabled: boolean; showAdmissionHint?: boolean;
}) {
  const text = useSchoolText(), [query, setQuery] = useState("");
  const schoolHintId = useId();
  const showSchoolHint = showAdmissionHint && selected.length === 0;
  const resource = useData<{ items: AudienceMember[] }>(`platform/courses/audience?${new URLSearchParams({ kind, q: query })}`);
  const toggle = (item: AudienceMember) => onSelected(selected.some(value => value.id === item.id) ? selected.filter(value => value.id !== item.id) : [...selected, item]);
  return <div className="space-y-2 rounded-md border border-border p-3">
    <p className="text-xs text-muted-foreground">{text(`${selected.length} selected`, `已选择 ${selected.length} 项`)}</p>
    {showSchoolHint && (
      <p id={schoolHintId} className="text-sm text-muted-foreground">
        {text(
          "Select a school below to configure its admission method and learning requirements.",
          "请先勾选下方的学校，再设置该校的准入方式和学习门槛。",
        )}
      </p>
    )}
    {selected.length > 0 && <ul className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">{selected.map(item => <li key={item.id} className="min-w-0 max-w-full"><Button type="button" size="sm" variant="secondary" className="h-auto min-h-8 max-w-full py-1 text-left" disabled={disabled} aria-label={text(`Remove ${item.name}`, `移除 ${item.name}`)} onClick={() => toggle(item)}><span className="min-w-0 break-words">{item.name}</span><span aria-hidden="true">×</span></Button></li>)}</ul>}
    <label className="grid gap-1 text-sm">{kind === "schools" ? text("Search schools", "搜索学校") : text("Search personal or school accounts", "搜索个人或学校账号")}<input type="search" className={inputClass} maxLength={100} disabled={disabled} value={query} aria-describedby={showSchoolHint ? schoolHintId : undefined} onChange={event => setQuery(event.target.value)}/></label>
    {resource.pending ? <p role="status" className="text-xs text-muted-foreground">{text("Loading…", "正在加载…")}</p> : resource.error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{resource.error}</p><Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={resource.reload}>{text("Retry search", "重新搜索")}</Button></div> : <>
      <div className="max-h-40 overflow-y-auto">{resource.data?.items.map(item => <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-2 border-b border-border py-2 text-sm last:border-0"><input type="checkbox" className="size-4 shrink-0 accent-primary" disabled={disabled} checked={selected.some(value => value.id === item.id)} onChange={() => toggle(item)}/><span className="min-w-0 break-words">{item.name}{item.username && <span className="ml-1 text-muted-foreground">@{item.username}</span>}</span></label>)}</div>
      {!resource.data?.items.length && <p className="text-xs text-muted-foreground">{kind === "students" && query.length < 2 ? text("Enter at least two characters to find accounts.", "输入至少两个字符查找账号。") : text("No matches.", "没有找到匹配项。")}</p>}
    </>}
  </div>;
}
