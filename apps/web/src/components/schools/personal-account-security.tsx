"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Feedback,
  inputClass,
  panelClass,
  useMutation,
} from "@/components/admin/common";
import {
  productionApi,
  type AuthResponse,
  type CampusUser,
} from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

export function PersonalAccountSecurity({
  user,
  onSaved,
}: {
  user: CampusUser;
  onSaved: (user: CampusUser) => void;
}) {
  const text = useSchoolText();
  const action = useMutation();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [invalidField, setInvalidField] = useState("");
  const [email, setEmail] = useState(user.email ?? "");
  const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    inFlight.current = true;
    setInvalidField("");
    await action.run(async () => {
      const address = email.trim();
      if (address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        setInvalidField("email");
        (form.elements.namedItem("email") as HTMLInputElement).focus();
        throw new Error(
          text(
            "Enter a valid email, or leave it blank.",
            "请输入有效邮箱，或留空。",
          ),
        );
      }
      const password = String(data.get("newPassword") ?? "");
      const currentPassword = String(data.get("currentPassword") ?? "");
      if (
        open &&
        (!currentPassword ||
          password.length < 8 ||
          password.length > 128 ||
          password !== data.get("confirmation"))
      ) {
        setInvalidField(!currentPassword ? "currentPassword" : "newPassword");
        (
          form.elements.namedItem(
            !currentPassword ? "currentPassword" : "newPassword",
          ) as HTMLInputElement
        ).focus();
        throw new Error(
          text(
            "Enter your current password and matching new passwords of 8–128 characters.",
            "请输入当前密码，以及两次一致的 8–128 位新密码。",
          ),
        );
      }
      const result = await productionApi<AuthResponse>("auth/profile", {
        method: "PATCH",
        body: {
          email: address,
          ...(open ? { currentPassword, newPassword: password } : {}),
        },
      });
      onSaved(result.user);
      setOpen(false);
      setVisible(false);
      form.reset();
      action.success(text("Account details saved.", "账号资料已保存。"));
    });
    inFlight.current = false;
  }
  return (
    <section className={`${panelClass} p-4 sm:p-5`}>
      <h2 className="font-semibold">{text("Account security", "账号安全")}</h2>
      <form
        noValidate
        onSubmit={submit}
        className="mt-3 max-w-lg space-y-3"
        aria-busy={action.busy}
      >
        <fieldset disabled={action.busy} className="space-y-3">
          <label className="block text-sm font-medium">
            {text("Email (optional)", "邮箱（选填）")}
            <input
              name="email"
              aria-invalid={invalidField === "email"}
              aria-describedby={
                invalidField === "email"
                  ? "account-security-feedback"
                  : undefined
              }
              type="email"
              autoComplete="email"
              value={email}
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
              setVisible(false);
            }}
          >
            {open
              ? text("Cancel password change", "取消修改密码")
              : text("Change password", "修改密码")}
          </Button>
          {open && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {text("New password: 8–128 characters.", "新密码：8–128 位。")}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible
                  ? text("Hide passwords", "隐藏密码")
                  : text("Show passwords", "显示密码")}
              </Button>
            </div>
          )}
          {open &&
            [
              {
                name: "currentPassword",
                label: text("Current password", "当前密码"),
              },
              { name: "newPassword", label: text("New password", "新密码") },
              {
                name: "confirmation",
                label: text("Confirm password", "确认密码"),
              },
            ].map((field) => (
              <label key={field.name} className="block text-sm font-medium">
                {field.label}
                <input
                  name={field.name}
                  type={visible ? "text" : "password"}
                  aria-invalid={invalidField === field.name}
                  aria-describedby={
                    invalidField === field.name
                      ? "account-security-feedback"
                      : undefined
                  }
                  required
                  maxLength={128}
                  autoComplete={
                    field.name === "currentPassword"
                      ? "current-password"
                      : "new-password"
                  }
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            ))}
        </fieldset>
        <div id="account-security-feedback">
          <Feedback action={action} />
        </div>
        <Button type="submit" size="sm" disabled={action.busy}>
          {action.busy
            ? text("Saving…", "正在保存…")
            : text("Save changes", "保存修改")}
        </Button>
      </form>
    </section>
  );
}
