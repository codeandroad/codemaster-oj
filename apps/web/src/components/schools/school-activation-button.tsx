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
        ? text("This identity has already been claimed. Refresh the list.", "该身份已经认领，请刷新列表。")
        : explain(reason).message);
    } finally { pending.current = false; setBusy(false); }
  }
  function close() { if (pending.current) return; setCredential(null); setError(""); setOpen(false); }
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><KeyRound size={14} />{text("Identity claim code", "认领码")}</Button>
    {open && <Modal title={text("Identity claim code", "身份认领码")} description={`${school.name} · ${identity.name} · ${identity.number}`} onClose={close}>
      {!credential ? <>
        <p className="text-sm text-muted-foreground">{text("Generate a single-use code for this identity. A newly generated code replaces any previous code and expires after 7 days.", "为此身份生成一次性认领码，有效期 7 天。重新生成会使旧码作废。")}</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={close}>{text("Cancel", "取消")}</Button><Button disabled={busy} onClick={() => void issue()}>{text(busy ? "Generating…" : "Generate code", busy ? "正在生成…" : "生成认领码")}</Button></div>
      </> : <>
        <dl className="grid gap-3 rounded border border-border bg-surface-subtle p-3 text-sm">
          <div><dt className="text-muted-foreground">{text("School code", "学校标识")}</dt><dd className="select-all font-mono">{credential.school.slug}</dd></div>
          <div><dt className="text-muted-foreground">{text("Identity claim code", "认领码")}</dt><dd className="select-all break-all font-mono">{credential.activationCode}</dd></div>
        </dl>
        <p className="text-sm text-muted-foreground">{text("Give this code privately to its recipient. After signing in, they can select this school in Settings → Schools → Join a school and enter the code. Copy the code before closing.", "请将认领码私下交给本人。对方登录后，在“设置 → 学校 → 加入学校”中选择本校，输入认领码即可。关闭前请复制留存。")}</p>
        <div className="flex justify-end gap-2"><CopyCode label={text("Copy activation details", "复制认领信息")} text={`${credential.school.name}\n${text("School code", "学校标识")}: ${credential.school.slug}\n${text("Identity claim code", "认领码")}: ${credential.activationCode}`} /><Button onClick={close}>{text("Done, close", "已记录，关闭")}</Button></div>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Modal>}
  </>;
}
