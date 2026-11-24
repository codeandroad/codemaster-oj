"use client";

import { useState } from "react";
import { Drawer, Feedback, Loading, Modal, inputClass, useData, useAdminText, useMutation } from "@/components/admin/common";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { productionApi, ApiError } from "@/lib/production-api";
import { genderLabel } from "@/lib/gender";
import type { CampusGender } from "@/lib/production-api";
import { RoleLabel, useSchoolText, type School, type SchoolRole } from "./school-ui";
import { schoolWorkspaceHref } from "./school-workspace-location";
import { SchoolIdentityClasses } from "./school-identity-classes";

export type Member = {
  accountId: string; username: string; name: string; number: string | null;
  role: SchoolRole; administrator: boolean; classes: string[];
  disabled: boolean; suspended: boolean; canManageAccess: boolean; joinedAt: string; lastLoginAt: string | null;
  canEditRoles: boolean; canResetPassword: boolean; identityId: string | null; gender: CampusGender | null;
};

export type AccountFilters = { q: string; className: string; role: string; status: string; access: string };

export function SchoolAccountFilters({ filters, onChange }: { filters: AccountFilters; onChange: (next: AccountFilters) => void }) {
  const text = useSchoolText();
  const [query, setQuery] = useState(filters.q);
  const [className, setClassName] = useState(filters.className);
  return <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={event => {
    event.preventDefault();
    onChange({ ...filters, q: query.trim(), className: className.trim() });
  }}>
    <label className="min-w-44 flex-1 text-xs">{text("Name, username or ID", "姓名、用户名或学工号")}
      <input type="search" className={inputClass} maxLength={100} value={query} onChange={e => setQuery(e.target.value)}/></label>
    <label className="text-xs">{text("Class name", "班级名称")}
      <input type="search" className={inputClass} value={className} maxLength={100} onChange={e => setClassName(e.target.value)}/></label>
    <label className="text-xs">{text("Role", "角色")}
      <select className={inputClass} value={filters.role} onChange={e => onChange({ ...filters, q:query.trim(), className:className.trim(), role:e.target.value })}>
        <option value="all">{text("All roles", "全部角色")}</option>
        <option value="student">{text("Student", "学生")}</option><option value="teacher">{text("Teacher", "教师")}</option>
        <option value="school_admin">{text("School administrator", "学校管理员")}</option>
      </select></label>
    <label className="text-xs">{text("Platform login", "平台登录")}
      <select className={inputClass} value={filters.status} onChange={e => onChange({ ...filters, q:query.trim(), className:className.trim(), status:e.target.value })}>
        <option value="all">{text("All statuses", "全部状态")}</option>
        <option value="enabled">{text("Enabled", "已启用")}</option><option value="disabled">{text("Disabled", "已禁用")}</option>
      </select></label>
    <label className="text-xs">{text("School access", "本校访问")}
      <select className={inputClass} value={filters.access} onChange={e => onChange({ ...filters, q:query.trim(), className:className.trim(), access:e.target.value })}>
        <option value="all">{text("All statuses", "全部状态")}</option>
        <option value="active">{text("Active", "已开放")}</option><option value="suspended">{text("Suspended", "已暂停")}</option>
      </select></label>
    <Button type="submit" variant="secondary">{text("Search", "搜索")}</Button>
  </form>;
}

export function SchoolAccountDetails({ school, accountId, onClose, onClassesSaved }: {
  school: School; accountId: string; onClose: () => void; onClassesSaved: () => void;
}) {
  const text = useSchoolText(), t = useAdminText();
  const resource = useData<Member & { events: { createdAt: string; action: string }[] }>(`schools/${school.id}/accounts/${accountId}`);
  const member = resource.data;
  const [editingClasses, setEditingClasses] = useState(false);
  if (editingClasses && member?.identityId) {
    return <SchoolIdentityClasses school={school} identityId={member.identityId}
      onClose={() => setEditingClasses(false)}
      onSaved={() => { setEditingClasses(false); resource.reload(); onClassesSaved(); }}/>;
  }
  return <Drawer title={member?.name ?? text("Account details", "账号详情")} eyebrow={member?.username} onClose={onClose}>
    <Loading resource={resource}>{member && <div className="space-y-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
        <dt>{text("ID number", "身份编号")}</dt><dd>{member.number || "—"}</dd>
        <dt>{text("Gender", "性别")}</dt><dd>{t(genderLabel(member.gender))}</dd>
        <dt>{text("Role", "角色")}</dt><dd><RoleLabel role={member.role}/>{member.administrator && member.role !== "school_admin" && <> · <RoleLabel role="school_admin"/></>}</dd>
        <dt>{text("Classes", "关联班级")}</dt>
        <dd className="flex flex-wrap items-center gap-2">{member.classes.join("、") || "—"}
          {member.identityId && (member.role === "student" || member.role === "teacher") &&
            <Button size="sm" variant="secondary" onClick={() => setEditingClasses(true)}>{text("Adjust classes", "调整班级")}</Button>}
        </dd>
        <dt>{text("Joined", "加入日期")}</dt><dd>{new Date(member.joinedAt).toLocaleDateString()}</dd>
        <dt>{text("Platform login", "平台登录")}</dt><dd>{member.disabled ? text("Disabled","已禁用") : text("Enabled","已启用")}</dd>
        <dt>{text("School access", "本校访问")}</dt><dd>{member.suspended ? text("Suspended","已暂停") : text("Active","已开放")}</dd>
      </dl>
      {member.identityId && <AppLink className="text-sm font-semibold text-primary" href={schoolWorkspaceHref(school.id,"identities")+"&identityId="+member.identityId}>
        {text("Open school identity", "查看校内身份档案")}</AppLink>}
      <section><h3 className="mb-2 text-sm font-semibold">{text("Recent account changes", "近期账号管理记录")}</h3>
        <ul className="space-y-1 text-sm">{member.events.map((event, index) => <li key={index}>
          {new Date(event.createdAt).toLocaleString()} · {({
            "account.reset_issue": text("Password reset code issued","已签发密码重置码"),
            "school.account.roles": text("School roles updated","已修改校内角色"),
            "school.account.suspend": text("School access suspended","已暂停本校访问"),
            "school.account.restore": text("School access restored","已恢复本校访问"),
          } as Record<string,string>)[event.action] ?? event.action}
        </li>)}</ul>
        {!member.events.length && <p className="text-sm text-muted-foreground">{text("No recent changes.", "暂无管理记录。")}</p>}
      </section>
    </div>}</Loading>
  </Drawer>;
}

export function SchoolRoleEditor({ school, member, onClose, onSaved }: {school: School; member: Member; onClose: () => void; onSaved: () => void}) {
  const text = useSchoolText(), action = useMutation();
  const [role, setRole] = useState(member.role);
  const [administrator, setAdministrator] = useState(member.administrator);
  return <Modal title={text("Edit school roles", "编辑校内角色")} description={school.name + " · " + member.name + " · " + member.username} onClose={() => { if (!action.busy) onClose(); }}>
    <label className="grid gap-1 text-sm">{text("School membership role", "校内基础角色")}
      <select className={inputClass} value={role} disabled={Boolean(member.identityId) || action.busy} onChange={e => setRole(e.target.value as SchoolRole)}>
        <option value="student">{text("Student","学生")}</option><option value="teacher">{text("Teacher","教师")}</option>
      </select>
    </label>
    {member.identityId && <p className="text-sm text-muted-foreground">{text(
      "The base role follows the linked identity. To change it, unlink the current record, change the role and link the corresponding identity.",
      "基础角色与校内身份档案关联。如需切换学生或教师身份，请先解除原档案关联，更改角色后再关联对应档案。"
    )} <AppLink className="text-primary underline" href={schoolWorkspaceHref(school.id,"identities")+"&identityId="+member.identityId}>{text("Identity record", "查看身份档案")}</AppLink></p>}
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={administrator} disabled={action.busy}
      onChange={e=>setAdministrator(e.target.checked)}/>{text("School administrator (includes teaching access)", "授予本校管理员权限（含教学工作区）")}</label>
    <Feedback action={action}/>
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={action.busy}>{text("Cancel", "取消")}</Button>
      <Button disabled={action.busy || (role===member.role && administrator===member.administrator)} onClick={()=>void action.run(async()=>{
        try {
          await productionApi(`schools/${school.id}/accounts/${member.accountId}/roles`,{method:"PATCH",body:{
            role,administrator,expectedRole:member.role,expectedAdministrator:member.administrator,
          }});
        } catch(error) {
          if (error instanceof ApiError && error.status===409) throw new Error(text("The role or identity has changed. Close and refresh before editing.", "角色或身份已变化，请关闭并刷新后重试。"));
          throw error;
        }
        onSaved();
      })}>{text("Save roles", "保存角色")}</Button></div>
  </Modal>;
}
