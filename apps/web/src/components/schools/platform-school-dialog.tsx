"use client";

import { useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Feedback, inputClass, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";
import { usePlatformError, type PlatformSchoolAction } from "./platform-ui";

export function PlatformSchoolDialog({
  action,
  onClose,
  onSaved,
  restoreFocus,
}: {
  action: PlatformSchoolAction;
  onClose: () => void;
  onSaved: (message: string) => void;
  restoreFocus: () => void;
}) {
  const text = useSchoolText();
  const localError = usePlatformError();
  const mutation = useMutation();
  const inFlight = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(
    action.mode === "rename" ? action.school.name : "",
  );
  const [slug, setSlug] = useState("");
  const [username, setUsername] = useState("");
  const creating = action.mode === "create";
  const assigning = action.mode === "administrator";
  const title = creating
    ? text("Create school", "创建学校")
    : assigning
      ? text("Assign school administrator", "指定学校管理员")
      : text("Rename school", "修改学校名称");
  const description = creating
    ? text(
        "Create a school and assign an existing account as its administrator.",
        "创建学校，并将一个已有账号指定为学校管理员。",
      )
    : assigning
      ? text(
          `Give an existing account administrator access to ${action.school.name}. Its current teaching identity will be preserved.`,
          `为已有账号授予「${action.school.name}」的学校管理权限，保留其当前教学身份。`,
        )
      : text(
          `Change the display name of ${action.school.name}. Its school code and records remain linked.`,
          `修改「${action.school.name}」的显示名称，学校标识与记录关联保留。`,
        );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await mutation.run(async () => {
        try {
          if (action.mode === "create") {
            await productionApi("platform/schools", {
              method: "POST",
              body: {
                name: name.trim(),
                slug: slug.trim(),
                adminUsername: username.trim(),
              },
            });
          } else if (action.mode === "rename") {
            await productionApi(`platform/schools/${action.school.id}`, {
              method: "PATCH",
              body: { name: name.trim(), expectedName: action.school.name },
            });
          } else {
            await productionApi(
              `platform/schools/${action.school.id}/administrators`,
              { method: "POST", body: { username: username.trim() } },
            );
          }
          onSaved(
            creating
              ? text(
                  `School created: ${name.trim()}.`,
                  `学校已创建：${name.trim()}。`,
                )
              : assigning
                ? text(
                    `Administrator access assigned to ${username.trim()}.`,
                    `已向 ${username.trim()} 授予学校管理权限。`,
                  )
                : text(
                    `School renamed to ${name.trim()}.`,
                    `学校名称已改为 ${name.trim()}。`,
                  ),
          );
        } catch (error) {
          throw localError(error);
        }
      });
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !inFlight.current) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] max-w-md gap-3 overflow-y-auto p-4 [&>button]:hidden"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstInput.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (inFlight.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (inFlight.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <DialogTitle className="text-base leading-snug">{title}</DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={text("Close", "关闭")}
            disabled={mutation.busy}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>
        <DialogDescription>{description}</DialogDescription>
        <form className="space-y-3" onSubmit={(event) => void submit(event)}>
          <fieldset className="space-y-3" disabled={mutation.busy}>
            {!assigning && (
              <label className="block text-sm font-medium">
                {text("School name", "学校名称")}
                <input
                  ref={firstInput}
                  className={`${inputClass} mt-1`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={100}
                  autoComplete="off"
                />
              </label>
            )}
            {creating && (
              <label className="block text-sm font-medium">
                {text("School code", "学校标识")}
                <input
                  className={`${inputClass} mt-1`}
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  required
                  minLength={3}
                  maxLength={50}
                  pattern="[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-describedby="platform-school-code-hint"
                />
                <span
                  id="platform-school-code-hint"
                  className="mt-1 block text-xs font-normal text-muted-foreground"
                >
                  {text(
                    "3–50 lowercase letters, digits or hyphens.",
                    "3–50 位小写字母、数字或连字符。",
                  )}
                </span>
              </label>
            )}
            {(creating || assigning) && (
              <label className="block text-sm font-medium">
                {text("Administrator username", "管理员用户名")}
                <input
                  ref={assigning ? firstInput : undefined}
                  className={`${inputClass} mt-1`}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  maxLength={100}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
            )}
          </fieldset>
          <Feedback action={mutation} />
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.busy}
              onClick={onClose}
            >
              {text("Cancel", "取消")}
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.busy ||
                (!assigning && !name.trim()) ||
                ((creating || assigning) && !username.trim())
              }
            >
              {mutation.busy
                ? text("Saving…", "保存中…")
                : creating
                  ? text("Create school", "创建学校")
                  : assigning
                    ? text("Assign administrator", "指定管理员")
                    : text("Save name", "保存名称")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
