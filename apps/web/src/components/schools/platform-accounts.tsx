"use client";

import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ChevronRight, RefreshCw, Search } from "lucide-react";
import { Drawer, inputClass, Loading, panelClass, useData } from "@/components/admin/common";
import { useLocale } from "@/components/locale-context";
import { StatusPill } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import { AccountAccessAction } from "./account-access-action";
import { PlatformPasswordReset } from "./platform-password-reset";
import { RoleLabel, schoolDisplayName, useSchoolText, type School, type SchoolRole } from "./school-ui";
import { platformMemberProfileHref } from "./school-workspace-location";
import { AppLink } from "@/components/navigation";

type SchoolOption = Omit<School, "roles">;
type Affiliation = SchoolOption & { roles: SchoolRole[]; suspended: boolean };
type LoginAccount = {
  accountId: string;
  name: string;
  username: string;
  createdAt: string;
  lastLoginAt: string | null;
  disabledAt: string | null;
  disabled: boolean;
  platformAdmin: boolean;
  canResetPassword: boolean;
  schools: Affiliation[];
};
type AccountDirectory = { items: LoginAccount[]; total: number; hasMore: boolean };
type AccountEvent = {
  id: string;
  action: "platform.administrator.provision" | "platform.password_reset.issue" |
    "deployment.password_reset.issue" | "platform.login.disable" | "platform.login.restore";
  createdAt: string;
  actorUsername: string | null;
};
type AccountDetail = Omit<LoginAccount, "schools"> & {
  schools: (Affiliation & {
    joinedAt: string;
    identity: { id: string; name: string; number: string; kind: string } | null;
  })[];
  events: AccountEvent[];
};

const defaults = { q: "", status: "all", schoolId: "all", role: "all", sort: "username" };
const fieldClass = "grid min-w-0 gap-1.5 text-sm font-medium";
const cellClass = "px-4 py-3 align-middle";
const schoolColumn = "hidden @min-[40rem]/accounts:table-cell";
const loginColumn = "hidden @min-[49rem]/accounts:table-cell";
const actionColumn = "hidden @min-[63rem]/accounts:table-cell";

export function PlatformAccounts() {
  const text = useSchoolText();
  const { locale } = useLocale();
  const [draft, setDraft] = useState("");
  const [filters, setFilters] = useState(defaults);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LoginAccount | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const schools = useData<{ schools: SchoolOption[] }>("platform/accounts/filters");
  const params = new URLSearchParams({ ...filters, page: String(page) });
  const accounts = useData<AccountDirectory>(`platform/accounts?${params}`);
  const hasFilters = Object.entries(defaults).some(([key, value]) => filters[key as keyof typeof defaults] !== value);

  function update(change: Partial<typeof defaults>) {
    setFilters(current => ({ ...current, q: draft.trim(), ...change }));
    setPage(1);
  }

  function showAccount(account: LoginAccount, event: MouseEvent<HTMLButtonElement>) {
    trigger.current = event.currentTarget;
    setSelected(account);
  }

  function closeAccount() {
    setSelected(null);
    requestAnimationFrame(() => {
      (trigger.current?.isConnected ? trigger.current : searchInput.current)?.focus();
    });
  }

  return <section className="@container/accounts min-w-0 space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold">{text("Platform accounts", "平台账号")}</h1>
      <Button type="button" variant="outline" size="sm" disabled={accounts.pending} onClick={() => { accounts.reload(); schools.reload(); }}>
        <RefreshCw size={14} aria-hidden="true" />{text("Refresh", "刷新")}
      </Button>
    </header>

    <form className={`${panelClass} p-4`} onSubmit={event => { event.preventDefault(); update({}); }}>
      <div className="grid gap-3 @min-[34rem]/accounts:grid-cols-2 @min-[63rem]/accounts:grid-cols-[minmax(14rem,2fr)_repeat(4,minmax(8rem,1fr))]">
        <label className={`${fieldClass} @min-[34rem]/accounts:col-span-2 @min-[63rem]/accounts:col-span-1`}>
          {text("Find an account", "查找账号")}
          <div className="relative">
            <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground" />
            <input ref={searchInput} name="q" type="search" maxLength={100} className={`${inputClass} pl-9`}
              placeholder={text("Name, username, or school ID number", "姓名、用户名、学号或工号")} value={draft}
              onChange={event => setDraft(event.target.value)} />
          </div>
        </label>
        <div className={fieldClass}>
          <label htmlFor="platform-account-school">{text("School", "所属学校")}</label>
          <select id="platform-account-school" name="schoolId" className={inputClass} value={filters.schoolId} onChange={event => update({ schoolId: event.target.value })}>
            <option value="all">{text("All schools", "全部学校")}</option>
            <option value="none">{text("No school", "未加入学校")}</option>
            {schools.data?.schools.map(school => <option key={school.id} value={school.id}>{schoolDisplayName(school, locale)}</option>)}
          </select>
        </div>
        <div className={fieldClass}>
          <label htmlFor="platform-account-role">{text("Role", "角色")}</label>
          <select id="platform-account-role" name="role" className={inputClass} value={filters.role} onChange={event => update({ role: event.target.value })}>
            <option value="all">{text("All roles", "全部角色")}</option>
            <option value="platform_admin">{text("Platform administrator", "平台管理员")}</option>
            <option value="school_admin">{text("School administrator", "学校管理员")}</option>
            <option value="teacher">{text("Teacher", "教师")}</option>
            <option value="student">{text("Student", "学生")}</option>
          </select>
        </div>
        <div className={fieldClass}>
          <label htmlFor="platform-account-status">{text("Sign-in status", "登录状态")}</label>
          <select id="platform-account-status" name="status" className={inputClass} value={filters.status} onChange={event => update({ status: event.target.value })}>
            <option value="all">{text("All statuses", "全部状态")}</option>
            <option value="enabled">{text("Enabled", "已启用")}</option>
            <option value="disabled">{text("Disabled", "已禁用")}</option>
          </select>
        </div>
        <div className={fieldClass}>
          <label htmlFor="platform-account-sort">{text("Sort by", "排序")}</label>
          <select id="platform-account-sort" name="sort" className={inputClass} value={filters.sort} onChange={event => update({ sort: event.target.value })}>
            <option value="username">{text("Username", "用户名")}</option>
            <option value="recent">{text("Last sign-in", "最近登录")}</option>
            <option value="newest">{text("Newest account", "最新创建")}</option>
          </select>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm text-muted-foreground" role="status">
          {accounts.data && !accounts.pending && !accounts.error ? text(`${accounts.data.total} matching accounts`, `共 ${accounts.data.total} 个账号`) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {(hasFilters || draft) && <Button type="button" size="sm" variant="ghost" onClick={() => {
            setDraft(""); setFilters(defaults); setPage(1);
          }}>{text("Clear filters", "清除筛选")}</Button>}
          <Button type="submit" size="sm">{text("Search", "搜索")}</Button>
        </div>
      </div>
      {schools.error && <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span role="alert" className="text-destructive">{text("School options could not be loaded.", "无法加载学校选项。")}</span>
        <Button type="button" size="sm" variant="ghost" onClick={schools.reload}>{text("Retry", "重试")}</Button>
      </div>}
    </form>

    <Loading resource={{ ...accounts, loading: accounts.pending || accounts.loading }}>
      <div className={`${panelClass} overflow-hidden`}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{text("Platform account directory", "平台账号目录")}</caption>
          <thead className="border-b border-border bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className={cellClass}>{text("Account", "账号")}</th>
              <th scope="col" className={schoolColumn + " " + cellClass}>{text("Schools and roles", "学校与角色")}</th>
              <th scope="col" className={cellClass}>{text("Platform sign-in", "平台登录")}</th>
              <th scope="col" className={loginColumn + " " + cellClass}>{text("Last sign-in", "最近登录")}</th>
              <th scope="col" className={actionColumn + " " + cellClass + " text-right"}>{text("Actions", "操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.data?.items.map(account => <tr key={account.accountId} className="hover:bg-muted/35">
              <th scope="row" className={`${cellClass} font-normal`}>
                <button type="button" onClick={event => showAccount(account, event)} aria-haspopup="dialog"
                  aria-label={text(`View ${account.name} · ${account.username}`, `查看 ${account.name} · ${account.username}`)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded text-left font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="break-all">{account.name}</span><ChevronRight size={14} className="shrink-0" aria-hidden="true" />
                </button>
                <span className="mt-0.5 block break-all text-xs text-muted-foreground">{account.username}</span>
                {account.platformAdmin && <span className="mt-1 inline-block rounded bg-info-soft px-1.5 py-0.5 text-xs font-medium text-primary">{text("Platform administrator", "平台管理员")}</span>}
              </th>
              <td className={schoolColumn + " " + cellClass}>
                <SchoolSummary schools={account.schools} selectedSchool={filters.schoolId} selectedRole={filters.role} />
              </td>
              <td className={cellClass}><LoginStatus disabled={account.disabled} /></td>
              <td className={loginColumn + " " + cellClass + " text-xs text-muted-foreground"}><AccountTime value={account.lastLoginAt} /></td>
              <td className={actionColumn + " " + cellClass + " text-right"}>
                <AccountActions account={account} onChanged={accounts.reload} />
              </td>
            </tr>)}
          </tbody>
        </table>
        {!accounts.data?.items.length && <p className="p-8 text-center text-sm text-muted-foreground">
          {text("No accounts match these filters.", "没有符合筛选条件的账号。")}
        </p>}
        {(page > 1 || accounts.data?.hasMore) && <nav aria-label={text("Account pages", "账号分页")}
          className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 text-sm">
          <span className="mr-1 text-muted-foreground">{text(`Page ${page}`, `第 ${page} 页`)}</span>
          <Button type="button" variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{text("Previous", "上一页")}</Button>
          <Button type="button" variant="secondary" size="sm" disabled={!accounts.data?.hasMore} onClick={() => setPage(page + 1)}>{text("Next", "下一页")}</Button>
        </nav>}
      </div>
    </Loading>
    {selected && <AccountDrawer account={selected} onClose={closeAccount} onChanged={accounts.reload} />}
  </section>;
}

function LoginStatus({ disabled }: { disabled: boolean }) {
  const text = useSchoolText();
  return <StatusPill status={disabled ? text("Disabled", "已禁用") : text("Enabled", "已启用")} tone={disabled ? "warning" : "success"} />;
}

function AccountTime({ value }: { value: string | null }) {
  const { locale } = useLocale();
  const text = useSchoolText();
  if (!value) return text("No record", "暂无记录");
  return <time dateTime={value}>{new Date(value).toLocaleString(locale === "en" ? "en-GB" : "zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  })}</time>;
}

function SchoolSummary({ schools, selectedSchool, selectedRole }: {
  schools: Affiliation[]; selectedSchool: string; selectedRole: string;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const school = schools.find(item => item.id === selectedSchool) ??
    schools.find(item => item.roles.some(role => role === selectedRole)) ?? schools[0];
  if (!school) return <span className="text-muted-foreground">{text("No school", "未加入学校")}</span>;
  return <div className="min-w-0">
    <p className="break-words font-medium">{schoolDisplayName(school, locale)}{schools.length > 1 && (
      <span className="ml-2 text-xs font-normal text-muted-foreground">{text(`+${schools.length - 1} more`, `另 ${schools.length - 1} 所`)}</span>
    )}</p>
    <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {school.roles.map(role => <span key={role}><RoleLabel role={role} /></span>)}
      {school.suspended && <span className="text-warning">{text("Suspended", "校内访问已暂停")}</span>}
    </p>
  </div>;
}

function AccountActions({ account, onChanged, onReset }: { account: LoginAccount; onChanged: () => void; onReset?: () => void }) {
  const text = useSchoolText();
  if (account.platformAdmin) return <p className="text-xs text-muted-foreground">{text("Recovery by deployment operator", "重置密码请联系部署维护者")}</p>;
  return <div className="flex flex-wrap justify-end gap-2">
    {account.canResetPassword && <PlatformPasswordReset account={account} onIssued={onReset} />}
    <AccountAccessAction account={account} access={{ scope: "platform", disabled: account.disabled }} onSaved={onChanged} />
  </div>;
}

function AccountDrawer({ account, onClose, onChanged }: { account: LoginAccount; onClose: () => void; onChanged: () => void }) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const detail = useData<AccountDetail>(`platform/accounts/${account.accountId}`);
  const labels: Record<AccountEvent["action"], string> = {
    "platform.administrator.provision": text("Granted platform administrator access", "授予平台管理员权限"),
    "platform.password_reset.issue": text("Issued a password reset code", "签发密码重置码"),
    "deployment.password_reset.issue": text("Issued a deployment recovery code", "签发部署恢复码"),
    "platform.login.disable": text("Disabled platform sign-in", "禁止平台登录"),
    "platform.login.restore": text("Restored platform sign-in", "恢复平台登录"),
  };
  return <Drawer title={account.name} eyebrow={account.username} onClose={onClose}>
    <Loading resource={detail}>
      {detail.data && <div className="space-y-6">
        <section aria-label={text("Access and security", "登录与安全")} className={`${panelClass} space-y-4 p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{text("Access and security", "登录与安全")}</h2>
            <LoginStatus disabled={detail.data.disabled} />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">{text("Account created", "账号创建")}</dt><dd className="mt-0.5"><AccountTime value={detail.data.createdAt} /></dd></div>
            <div><dt className="text-xs text-muted-foreground">{text("Last sign-in", "最近登录")}</dt><dd className="mt-0.5"><AccountTime value={detail.data.lastLoginAt} /></dd></div>
            {detail.data.disabledAt && <div><dt className="text-xs text-muted-foreground">{text("Sign-in disabled at", "禁用时间")}</dt><dd className="mt-0.5"><AccountTime value={detail.data.disabledAt} /></dd></div>}
          </dl>
          <div className="border-t border-border pt-3">
            <AccountActions account={detail.data} onReset={detail.reload} onChanged={() => { detail.reload(); onChanged(); }} />
          </div>
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">{text("School memberships", "所属学校与身份")}</h2>
          {detail.data.schools.length ? <ul className={`${panelClass} divide-y divide-border`}>
            {detail.data.schools.map(school => <li key={school.id} className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="break-words font-medium">{schoolDisplayName(school, locale)}</h3>
                <StatusPill status={school.suspended ? text("Suspended", "已暂停访问") : text("Active", "有效")} tone={school.suspended ? "warning" : "success"} />
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {school.roles.map(role => <li className="rounded border border-border px-1.5 py-0.5 text-xs" key={role}><RoleLabel role={role} /></li>)}
              </ul>
              <p className="break-words text-muted-foreground">
                {school.identity ? <>{school.identity.name} · <span className="font-mono">{school.identity.number}</span></> : text("No linked school identity", "尚未关联校内档案")}
              </p>
              {!school.suspended && !detail.data?.disabled &&
                <AppLink className="text-sm font-semibold text-primary" href={platformMemberProfileHref(school.id,
                  school.roles.includes("student") && school.identity?.kind === "student" ? school.identity.id : account.accountId)}>
                  {school.roles.includes("student") ? text("View student profile", "查看学生主页") : text("View profile", "查看主页")}
                </AppLink>}
              <p className="text-xs text-muted-foreground">{text("Joined", "加入时间")} <AccountTime value={school.joinedAt} /></p>
            </li>)}
          </ul> : <p className={`${panelClass} p-4 text-sm text-muted-foreground`}>{text("No school memberships.", "该账号尚未加入学校。")}</p>}
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">{text("Recent management activity", "近期管理记录")}</h2>
          {detail.data.events.length ? <ul className={`${panelClass} divide-y divide-border`}>
            {detail.data.events.map(event => <li key={event.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span>{labels[event.action]}{event.actorUsername && <span className="ml-2 break-all text-xs text-muted-foreground">{event.actorUsername}</span>}</span>
              <span className="text-xs text-muted-foreground"><AccountTime value={event.createdAt} /></span>
            </li>)}
          </ul> : <p className={`${panelClass} p-4 text-sm text-muted-foreground`}>{text("No management activity recorded.", "暂无管理操作记录。")}</p>}
        </section>
      </div>}
    </Loading>
  </Drawer>;
}
