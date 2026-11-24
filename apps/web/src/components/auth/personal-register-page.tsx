"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, LoaderCircle, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/locale-context";
import {
  ApiError,
  apiMessage,
  productionApi,
  type AuthResponse,
  type CampusUser,
} from "@/lib/production-api";
import { invalidAccountField } from "./registration-fields";
import { AuthShell } from "./auth-shell";
import styles from "./auth-shell.module.css";

export function PersonalRegisterPage({
  onRegistered,
  joinIntent = false,
}: {
  onRegistered: (user: CampusUser) => void;
  joinIntent?: boolean;
}) {
  const { locale } = useLocale();
  const text = (en: string, zh: string) => (locale === "en" ? en : zh);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [issue, setIssue] = useState<{
    field?: string;
    message: string;
  } | null>(null);
  const inFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldError = (field: string) => issue?.field === field;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const values = new FormData(event.currentTarget);
    const username = String(values.get("username") ?? "").trim();
    const displayName = String(values.get("displayName") ?? "").trim();
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    const invalidField = displayName
      ? invalidAccountField({username, password, confirmation:String(values.get("confirmation") ?? ""), email})
      : "displayName";
    const messages = {
      displayName: text("Enter your name.", "请输入姓名。"),
      username: text("Use 3–40 letters, numbers, underscores, dots or hyphens. Start with a letter or number.", "用户名使用 3–40 位字母、数字、下划线、点或连字符，首位为字母或数字。"),
      password: text("Use 8–128 characters for your password.", "密码需为 8–128 位。"),
      confirmation: text("Passwords do not match.", "两次输入的密码不一致。"),
      email: text("Enter a valid email, or leave it blank.", "请输入有效邮箱，或留空。"),
    };
    const invalid = invalidField ? {field: invalidField, message: messages[invalidField]} : null;
    setIssue(invalid);
    if (invalid) {
      (
        formRef.current?.elements.namedItem(invalid.field) as HTMLInputElement
      )?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await productionApi<AuthResponse>(
        "auth/register-personal",
        {
          method: "POST",
          body: {
            username,
            displayName,
            password,
            ...(email ? { email } : {}),
          },
        },
      );
      onRegistered(result.user);
    } catch (error) {
      setIssue({
        message:
          error instanceof ApiError &&
          ["USERNAME_TAKEN", "CONFLICT"].includes(error.code)
            ? text(
                "This username is already in use. Choose another.",
                "用户名已被使用，请换一个。",
              )
            : apiMessage(error),
      });
      requestAnimationFrame(() =>
        document.getElementById("register-error")?.focus(),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthShell titleId="register-title">
      <header>
        <h2 id="register-title" className={styles.title}>
          {text("Create account", "创建账号")}
        </h2>
        <p className={styles.description}>
          {joinIntent
            ? text(
                "Create your account, then claim your identity or apply to join a school.",
                "先创建个人账号，再认领校内身份或申请入校。",
              )
            : text(
                "Practice independently. You can also claim a school identity or apply to join.",
                "可独立学习公开课程与题目，也可认领校内身份或申请入校。",
              )}
        </p>
      </header>
      <form
        ref={formRef}
        noValidate
        onSubmit={submit}
        className={styles.form}
        aria-busy={busy}
        onChange={() => setIssue(null)}
      >
        <fieldset disabled={busy} className={styles.fields}>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                name: "displayName",
                label: text("Name", "姓名"),
                auto: "name",
              },
              {
                name: "username",
                label: text("Username", "用户名"),
                auto: "username",
              },
            ].map((field) => (
              <div key={field.name}>
                <label
                  htmlFor={`personal-${field.name}`}
                  className={styles.label}
                >
                  {field.label}
                </label>
                <input
                  id={`personal-${field.name}`}
                  name={field.name}
                  autoComplete={field.auto}
                  autoCapitalize="none"
                  maxLength={field.name === "username" ? 40 : 80}
                  required
                  aria-invalid={fieldError(field.name)}
                  aria-describedby={
                    fieldError(field.name) ? "register-error" : undefined
                  }
                  className={styles.input}
                />
              </div>
            ))}
          </div>
          <div>
            <label htmlFor="personal-password" className={styles.label}>
              {text("Password", "密码")}
            </label>
            <div className={styles.inputWrap}>
              <input
                id="personal-password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                aria-invalid={fieldError("password")}
                aria-describedby={
                  fieldError("password")
                    ? "password-help register-error"
                    : "password-help"
                }
                className={`${styles.input} ${styles.passwordInput}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={styles.visibility}
                aria-label={text(
                  visible ? "Hide passwords" : "Show passwords",
                  visible ? "隐藏密码" : "显示密码",
                )}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </Button>
            </div>
            <p
              id="password-help"
              className="mt-1 text-xs text-muted-foreground"
            >
              {text("8–128 characters", "8–128 位")}
            </p>
          </div>
          <div>
            <label htmlFor="personal-confirmation" className={styles.label}>
              {text("Confirm password", "确认密码")}
            </label>
            <input
              id="personal-confirmation"
              name="confirmation"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              maxLength={128}
              required
              aria-invalid={fieldError("confirmation")}
              aria-describedby={
                fieldError("confirmation") ? "register-error" : undefined
              }
              className={styles.input}
            />
          </div>
          <div>
            <label htmlFor="personal-email" className={styles.label}>
              {text("Email (optional)", "邮箱（选填）")}
            </label>
            <input
              id="personal-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              aria-invalid={fieldError("email")}
              aria-describedby={
                fieldError("email") ? "register-error" : undefined
              }
              className={styles.input}
            />
          </div>
        </fieldset>
        {issue && (
          <p
            id="register-error"
            role="alert"
            tabIndex={-1}
            className={styles.error}
          >
            {issue.message}
          </p>
        )}
        <Button
          type="submit"
          disabled={busy}
          className={`${styles.submit} mt-4`}
        >
          {busy ? (
            <LoaderCircle size={17} className="animate-spin" />
          ) : (
            <UserPlus size={17} />
          )}
          <span role="status">
            {busy
              ? text("Creating account…", "正在创建…")
              : text("Create account", "创建账号")}
          </span>
        </Button>
      </form>
      <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-border pt-4 text-sm">
        <Link
          href={joinIntent ? "/login?join=1" : "/login"}
          className="font-semibold text-primary hover:underline"
        >
          {text("Already registered? Sign in", "已有账号？登录")}
        </Link>
        <Link
          href="/activate"
          className="text-muted-foreground hover:text-primary hover:underline"
        >
          {text("Already have a school claim code?", "已有学校身份认领码？")}
        </Link>
      </div>
    </AuthShell>
  );
}
