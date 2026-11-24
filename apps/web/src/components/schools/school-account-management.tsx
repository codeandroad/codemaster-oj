"use client";

import { useState } from "react";
import { Drawer, Loading, inputClass, useData, useAdminText } from "@/components/admin/common";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { genderLabel } from "@/lib/gender";
import type { CampusGender } from "@/lib/production-api";
import { RoleLabel, useSchoolText, type School, type SchoolRole } from "./school-ui";
import { schoolWorkspaceHref } from "./school-workspace-location";

export type Member = {
  accountId: string; username: string; name: string; number: string | null;
  role: SchoolRole; administrator: boolean; classes: string[];
  disabled: boolean; joinedAt: string; lastLoginAt: string | null;
  canResetPassword: boolean; identityId: string | null; gender: CampusGender | null;
};

export type AccountFilters = { q: string; className: string; role: string; status: string };

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
    <label className="text-xs">{text("Status", "账号状态")}
      <select className={inputClass} value={filters.status} onChange={e => onChange({ ...filters, q:query.trim(), className:className.trim(), status:e.target.value })}>
        <option value="all">{text("All statuses", "全部状态")}</option>
        <option value="enabled">{text("Enabled", "已启用")}</option><option value="disabled">{text("Disabled", "已禁用")}</option>
      </select></label>
    <Button type="submit" variant="secondary">{text("Search", "搜索")}</Button>
  </form>;
}

export function SchoolAccountDetails({ school, accountId, onClose }: { school: School; accountId: string; onClose: () => void }) {
  const text = useSchoolText(), t = useAdminText();
  const resource = useData<Member & { events: { createdAt: string; action: string }[] }>(`schools/${school.id}/accounts/${accountId}`);
  const member = resource.data;
  return <Drawer title={member?.name ?? text("Account details", "账号详情")} eyebrow={member?.username} onClose={onClose}>
    <Loading resource={resource}>{member && <div className="space-y-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
        <dt>{text("ID number", "身份编号")}</dt><dd>{member.number || "—"}</dd>
        <dt>{text("Gender", "性别")}</dt><dd>{t(genderLabel(member.gender))}</dd>
        <dt>{text("Role", "角色")}</dt><dd><RoleLabel role={member.role}/>{member.administrator && member.role !== "school_admin" && <> · <RoleLabel role="school_admin"/></>}</dd>
        <dt>{text("Classes", "关联班级")}</dt><dd>{member.classes.join("、") || "—"}</dd>
        <dt>{text("Joined", "加入日期")}</dt><dd>{new Date(member.joinedAt).toLocaleDateString()}</dd>
        <dt>{text("Status", "账号状态")}</dt><dd>{member.disabled ? text("Disabled","已禁用") : text("Enabled","已启用")}</dd>
      </dl>
      {member.identityId && <AppLink className="text-sm font-semibold text-primary" href={schoolWorkspaceHref(school.id,"identities")+"&identityId="+member.identityId}>
        {text("Open school identity", "查看校内身份档案")}</AppLink>}
      <section><h3 className="mb-2 text-sm font-semibold">{text("Recent account changes", "近期账号管理记录")}</h3>
        <ul className="space-y-1 text-sm">{member.events.map((event, index) => <li key={index}>
          {new Date(event.createdAt).toLocaleString()} · {event.action === "account.reset_issue" ? text("Password reset code issued","已签发密码重置码") : event.action}
        </li>)}</ul>
        {!member.events.length && <p className="text-sm text-muted-foreground">{text("No recent changes.", "暂无管理记录。")}</p>}
      </section>
    </div>}</Loading>
  </Drawer>;
}
