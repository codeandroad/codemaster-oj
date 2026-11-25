"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CopyCode } from "@/components/admin/common";
import { useSchoolText } from "./school-ui";

export type IssuedResetCode = { username: string; resetCode: string };

export function ResetCodeDialog({credential, onClose}: {credential: IssuedResetCode; onClose: () => void}) {
  const text = useSchoolText();
  const resetUrl = `${window.location.origin}/login?reset=1`;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle>{text("One-time reset credential", "一次性密码重置凭据")}</DialogTitle>
        <DialogDescription>
          {text(
            "Valid for 30 minutes and shown only here. Give it to the account holder privately.",
            "凭据有效期 30 分钟，仅在此处展示，请私下交给本人。",
          )}
        </DialogDescription>
        <div className="space-y-3 text-sm">
          <p>
            {text("Username: ", "用户名：")}
            <code>{credential.username}</code>
          </p>
          <div className="border border-dashed border-border-strong bg-surface-subtle p-3">
            <code className="select-all break-all">{credential.resetCode}</code>
            <CopyCode text={credential.resetCode} />
          </div>
          <p className="text-muted-foreground">
            {text(
              "Share the reset entry below with the newest code privately. The code works on the issuing site, and issuing a new code immediately invalidates the previous one.",
              "请把下方重置入口和最新凭据私下交给本人。凭据只能在签发站点使用，重新签发后旧凭据立即失效。",
            )}
          </p>
          <div className="space-y-1">
            <a href={resetUrl} className="break-all text-primary underline">
              {resetUrl}
            </a>
            <CopyCode text={resetUrl} label={text("Copy reset link", "复制重置入口")} />
          </div>
          <Button onClick={onClose}>
            {text("Done — close", "已记录，关闭")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
