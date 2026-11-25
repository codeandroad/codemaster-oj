"use client";

import { useState } from "react";
import { inputClass, Loading, useData } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { AccountAccessAction } from "./account-access-action";
import { PlatformPasswordReset } from "./platform-password-reset";
import { useSchoolText } from "./school-ui";

type LoginAccount = {accountId: string; name: string; username: string; disabled: boolean; platformAdmin: boolean; schoolAdmin: boolean; canResetPassword: boolean};

export function PlatformAccounts() {
  const text = useSchoolText();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ q: query, status, page: String(page) });
  const accounts = useData<{items: LoginAccount[]; hasMore: boolean}>(`platform/accounts?${params}`);
  return <section className="space-y-3">
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault(); setQuery(draft.trim()); setPage(1);
    }}>
      <label className="grid gap-1 text-sm">{text("Name or username", "姓名或用户名")}
        <input className={inputClass} type="search" maxLength={100} value={draft} onChange={e => setDraft(e.target.value)} /></label>
      <label className="grid gap-1 text-sm">{text("Platform login", "平台登录")}
        <select className={inputClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); setQuery(draft.trim()); }}>
          <option value="all">{text("All statuses", "全部状态")}</option>
          <option value="enabled">{text("Enabled", "已启用")}</option><option value="disabled">{text("Disabled", "已禁用")}</option>
        </select></label>
      <Button type="submit" variant="secondary">{text("Search", "搜索")}</Button>
    </form>
    <Loading resource={{ ...accounts, loading: accounts.pending || accounts.loading }}>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground"><tr>
            <th className="px-4 py-2">{text("Account", "账号")}</th><th className="px-4 py-2">{text("Platform login", "平台登录")}</th>
            <th className="px-4 py-2 text-right">{text("Actions", "操作")}</th>
          </tr></thead>
          <tbody className="divide-y divide-border">{accounts.data?.items.map(account => <tr key={account.accountId}>
            <td className="px-4 py-2"><span className="font-medium">{account.name}</span><span className="block text-xs text-muted-foreground">{account.username}{account.schoolAdmin && !account.platformAdmin && text(" · School administrator", " · 学校管理员")}</span></td>
            <td className="whitespace-nowrap px-4 py-2">{account.disabled ? text("Disabled","已禁用") : text("Enabled","已启用")}</td>
            <td className="px-4 py-2 text-right">{account.platformAdmin ? <span className="text-xs text-muted-foreground">{text("Recovery by deployment operator", "重置密码请联系部署维护者")}</span>
              : <div className="flex flex-wrap justify-end gap-2">
                {account.canResetPassword && <PlatformPasswordReset account={account}/>}
                <AccountAccessAction account={account} access={{scope:"platform",disabled:account.disabled}} onSaved={accounts.reload}/>
              </div>}</td>
          </tr>)}</tbody>
        </table>
        {!accounts.data?.items.length && <p className="p-4 text-sm text-muted-foreground">{text("No matching accounts.", "没有匹配的账号。")}</p>}
      </div>
      {(page > 1 || accounts.data?.hasMore) && <nav aria-label={text("Account pages", "账号分页")} className="flex items-center justify-end gap-2 text-sm">
        <span>{text(`Page ${page}`, `第 ${page} 页`)}</span>
        <Button variant="secondary" size="sm" disabled={page===1} onClick={() => setPage(page-1)}>{text("Previous","上一页")}</Button>
        <Button variant="secondary" size="sm" disabled={!accounts.data?.hasMore} onClick={() => setPage(page+1)}>{text("Next","下一页")}</Button>
      </nav>}
    </Loading>
  </section>;
}
