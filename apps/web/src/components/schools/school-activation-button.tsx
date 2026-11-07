"use client";

import { useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyCode, Modal } from "@/components/admin/common";
import { ApiError, productionApi } from "@/lib/production-api";
import { useSchoolError, useSchoolText, type School } from "./school-ui";

type Identity = { id: string; kind: "student" | "teacher"; number: string; name: string; accountId: string | null };
type Credential = { school: { slug: string; name: string }; activationCode: string; expiresAt: string };

export function SchoolActivationButton({ school, identity }: { school: School; identity: Identity }) {
  const text = useSchoolText(), explain = useSchoolError();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [credential, setCredential] = useState<Credential | null>(null);
  const pending = useRef(false);
  async function issue() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      setCredential(await productionApi<Credential>(`schools/${school.id}/identities/${identity.id}/activation-code`, { method: "POST", body: {} }));
    } catch (reason) {
      setError(reason instanceof ApiError && reason.code === "ACTIVATED"
        ? text("This identity has already been activated. Refresh the list.", "该身份已经激活，请刷新列表。")
        : explain(reason).message);
    } finally { pending.current = false; setBusy(false); }
  }
  function close() { if (pending.current) return; setCredential(null); setError(""); setOpen(false); }
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><KeyRound size={14} />{text("Activation code", "激活码")}</Button>
    {open && <Modal title={text("Activate school identity", "激活学校身份")} description={`${school.name} · ${identity.name} · ${identity.number}`} onClose={close}>
      {!credential ? <>
        <p className="text-sm text-muted-foreground">{text("Generate a single-use code for this identity. A newly generated code replaces any previous code and expires after 7 days.", "为此身份生成一次性激活码，有效期 7 天。重新生成会使旧码作废。")}</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={close}>{text("Cancel", "取消")}</Button><Button disabled={busy} onClick={() => void issue()}>{text(busy ? "Generating…" : "Generate code", busy ? "正在生成…" : "生成激活码")}</Button></div>
      </> : <>
        <dl className="grid gap-3 rounded border border-border bg-surface-subtle p-3 text-sm">
          <div><dt className="text-muted-foreground">{text("School code", "学校标识")}</dt><dd className="select-all font-mono">{credential.school.slug}</dd></div>
          <div><dt className="text-muted-foreground">{text("Activation code", "激活码")}</dt><dd className="select-all break-all font-mono">{credential.activationCode}</dd></div>
        </dl>
        <p className="text-sm text-muted-foreground">{text("Give the school code, student/staff ID, name and activation code privately to this person. Open Activate school identity from the sign-in page. The code cannot be read again after this dialog closes.", "请将学校标识、学号或工号、姓名与激活码私下交给本人，从登录页进入“激活学校身份”。关闭此窗口后不能再次查看明文。")}</p>
        <div className="flex justify-end gap-2"><CopyCode label={text("Copy activation details", "复制激活信息")} text={`${credential.school.name}\n${text("School code", "学校标识")}: ${credential.school.slug}\n${identity.kind === "student" ? text("Student ID", "学号") : text("Staff ID", "工号")}: ${identity.number}\n${text("Name", "姓名")}: ${identity.name}\n${text("Activation code", "激活码")}: ${credential.activationCode}`} /><Button onClick={close}>{text("Done, close", "已记录，关闭")}</Button></div>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Modal>}
  </>;
}
