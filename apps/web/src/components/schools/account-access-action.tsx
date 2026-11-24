"use client";

import { useState } from "react";
import { Feedback, Modal, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { RowActionButton } from "@/components/ui/row-action";
import { productionApi } from "@/lib/production-api";
import { useSchoolText, type School } from "./school-ui";

type Access = { scope: "platform"; disabled: boolean } | { scope: "school"; school: School; suspended: boolean };

export function AccountAccessAction({ account, access, onSaved }: {
  account: { accountId: string; name: string; username: string }; access: Access; onSaved: () => void;
}) {
  const text = useSchoolText();
  const action = useMutation();
  const [open, setOpen] = useState(false);
  const platform = access.scope === "platform";
  const restore = platform ? access.disabled : access.suspended;
  const label = platform
    ? restore ? text("Restore platform login", "恢复平台登录") : text("Disable platform login", "禁止平台登录")
    : restore ? text("Restore school access", "恢复本校访问") : text("Suspend school access", "暂停本校访问");
  const effect = platform
    ? restore ? text("The account holder can sign in again. Each school's access settings still apply.", "该用户可以重新登录平台，各校的访问设置仍然生效。")
      : text("All current sessions will end. The account holder will lose access to the entire platform until login is restored.", "所有已登录设备都会退出。恢复平台登录前，该用户将无法使用整个平台。")
    : restore ? text("The member can use this school again when signed in, with their existing roles and classes.", "成员登录平台后，即可按原有角色和班级继续访问本校。")
      : text("Access to this school will stop immediately. Platform login and access to other schools are managed separately.", "成员将立即失去本校访问权限。平台登录及其他学校的访问权限独立管理。");
  async function save() {
    if (access.scope === "platform") {
      await productionApi(`platform/accounts/${account.accountId}/login`, { method: "PATCH", body: { disabled: !access.disabled } });
    } else {
      await productionApi(`schools/${access.school.id}/accounts/${account.accountId}/access`, { method: "PATCH", body: { suspended: !access.suspended } });
    }
    setOpen(false);
    onSaved();
  }
  return <>
    <RowActionButton onClick={() => { action.clear(); setOpen(true); }}>{label}</RowActionButton>
    {open && <Modal title={label} description={[platform ? "" : access.school.name, account.name, account.username].filter(Boolean).join(" · ")}
      onClose={() => { if (!action.busy) setOpen(false); }}>
      <p className="text-sm">{effect}</p>
      <Feedback action={action}/>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={action.busy} onClick={() => setOpen(false)}>{text("Cancel", "取消")}</Button>
        <Button variant={restore ? "primary" : "danger"} disabled={action.busy} onClick={() => void action.run(save)}>{label}</Button>
      </div>
    </Modal>}
  </>;
}
