"use client";

import { useRef, useState } from "react";
import { Feedback, inputClass, Modal, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { RowActionButton } from "@/components/ui/row-action";
import { productionApi } from "@/lib/production-api";
import { ResetCodeDialog, type IssuedResetCode } from "./reset-code-dialog";
import { usePlatformError } from "./platform-ui";
import { useSchoolText } from "./school-ui";

export function PlatformPasswordReset({account}: {account: {accountId: string; username: string}}) {
  const text = useSchoolText();
  const localError = usePlatformError();
  const action = useMutation();
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [credential, setCredential] = useState<IssuedResetCode | null>(null);
  const issue = async () => {
    if (pending.current || !note.trim()) return;
    pending.current = true;
    try {
      await action.run(async () => {
        try {
          const issued = await productionApi<IssuedResetCode>(`platform/accounts/${account.accountId}/reset`, {
            method: "POST", body: {verificationNote: note.trim()},
          });
          setOpen(false);
          setNote("");
          setCredential(issued);
        } catch (error) { throw localError(error); }
      });
    } finally { pending.current = false; }
  };
  return <>
    <RowActionButton onClick={() => { action.clear(); setNote(""); setOpen(true); }}>{text("Reset password", "重置密码")}</RowActionButton>
    {open && <Modal title={text(`Verify account ownership · ${account.username}`, `核验账号归属 · ${account.username}`)}
      description={text("After verifying ownership, record how you confirmed it. Omit passwords, codes and identity document numbers.", "确认申请人是账号本人后，简要记录核验方式。请勿填写密码、验证码或证件号码。")}
      onClose={() => { if (!pending.current) setOpen(false); }}>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void issue(); }}>
        <label className="grid gap-1 text-sm">{text("Verification note", "人工核验记录")}
          <textarea className={inputClass} required maxLength={300} rows={2} value={note} disabled={action.busy} onChange={event => setNote(event.target.value)} />
        </label>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={action.busy} onClick={() => setOpen(false)}>{text("Cancel", "取消")}</Button>
          <Button type="submit" disabled={action.busy || !note.trim()}>{text("Issue reset code", "签发重置码")}</Button>
        </div>
      </form>
    </Modal>}
    {credential && <ResetCodeDialog credential={credential} onClose={() => setCredential(null)} />}
  </>;
}
