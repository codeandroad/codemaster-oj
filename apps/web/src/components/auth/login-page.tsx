"use client";

import Link from "next/link";
import { AlertCircle, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError, apiMessage, productionApi, type AuthResponse, type CampusUser } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";
import { AuthShell } from "./auth-shell";
import styles from "./auth-shell.module.css";

type Field = "username" | "password" | "resetCode" | "confirmation";
type FormIssue = { field?: Field; kind: "username" | "password" | "resetCode" | "passwordLength" | "confirmation" | "login" | "disabled" | "server"; message?: string };

export function ProductionLoginPage({ onLogin }: { onLogin: (user: CampusUser) => void }) {
  const { t, locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetCode, setShowResetCode] = useState(false);
  const [issue, setIssue] = useState<FormIssue | null>(null);
  const [resetComplete, setResetComplete] = useState(false);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const error = issue ? {
    username: tx("请输入用户名。", "Enter your username."),
    password: tx("请输入密码。", "Enter your password."),
    resetCode: tx("请输入管理员提供的一次性重置凭据。", "Enter the one-time reset code from your administrator."),
    passwordLength: tx("新密码需要 8–128 位。", "Use 8–128 characters for your new password."),
    confirmation: t("两次输入的新密码不一致。"),
    login: t("用户名或密码不正确"),
    disabled: t("账号已禁用"),
    server: issue.message ?? "",
  }[issue.kind] : "";

  function focusField(field: Field) {
    const input = formRef.current?.elements.namedItem(field);
    if (input instanceof HTMLInputElement) input.focus();
  }
  function clearIssue() { setIssue(null); setResetComplete(false); }
  function switchMode() {
    if (submitting.current) return;
    setMode(current => current === "login" ? "reset" : "login");
    setShowPassword(false); setShowResetCode(false); setIssue(null); setResetComplete(false);
    requestAnimationFrame(() => titleRef.current?.focus());
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const login = String(fields.get("username") ?? "").trim();
    const password = String(fields.get("password") ?? "");
    const resetCode = String(fields.get("resetCode") ?? "").trim();
    const invalid: FormIssue | null = !login ? { field: "username", kind: "username" }
      : mode === "reset" && !resetCode ? { field: "resetCode", kind: "resetCode" }
      : !password ? { field: "password", kind: "password" }
      : mode === "reset" && (password.length < 8 || password.length > 128) ? { field: "password", kind: "passwordLength" }
      : mode === "reset" && password !== fields.get("confirmation") ? { field: "confirmation", kind: "confirmation" } : null;
    setResetComplete(false);
    if (invalid) { setIssue(invalid); focusField(invalid.field!); return; }
    submitting.current = true; setBusy(true); setIssue(null);
    try {
      if (mode === "login") {
        const response = await productionApi<AuthResponse>("auth/login", { method: "POST", body: { username: login, password } });
        form.reset(); setUsername(""); onLogin(response.user);
      } else {
        await productionApi("auth/reset", { method: "POST", body: { username: login, resetCode, password } });
        form.reset(); setMode("login"); setShowPassword(false); setShowResetCode(false); setResetComplete(true);
        requestAnimationFrame(() => titleRef.current?.focus());
      }
    } catch (reason) {
      const next: FormIssue = reason instanceof ApiError && reason.code === "ACCOUNT_DISABLED" ? { kind: "disabled", field: "username" }
        : reason instanceof ApiError && reason.code === "LOGIN_FAILED" ? { kind: "login", field: "password" }
        : { kind: "server", message: apiMessage(reason) };
      setIssue(next);
      // The focused error remains associated after the busy fieldset is enabled.
      requestAnimationFrame(() => next.field ? focusField(next.field) : document.getElementById("login-error")?.focus());
    } finally { submitting.current = false; setBusy(false); }
  }
  const invalid = (field: Field) => issue?.field === field || issue?.kind === "login" && field === "username";
  const describedBy = (field: Field) => invalid(field) ? "login-error" : undefined;

  return <AuthShell>
    <header>
      <h2 ref={titleRef} tabIndex={-1} id="login-title" className={styles.title}>{mode === "login" ? t("登录") : t("重置密码")}</h2>
      <p className={styles.description}>{t(mode === "login" ? "使用你在注册时自行设置的用户名与密码登录。日常登录无需再次验证身份，也无需强制修改密码。" : "请先向学校管理员核实身份并取得一次性重置凭据，然后自行设置新密码。")}</p>
    </header>
    {mode === "reset" && <details className={styles.help}>
      <summary>{tx("如何获取重置凭据？", "How do I get a reset code?")}</summary>
      <p>{t("本校使用本地账号，没有公网邮件找回服务。请向课程教师或管理员提供用户名、姓名及学号 / 工号，由管理员核实身份后提供一次性重置凭据。不要提供原密码。")}</p>
      <p>{t("已有账号无需重新注册或再次激活；重置密码不会删除班级、作业或提交记录。")}</p>
    </details>}
    <form key={mode} ref={formRef} onSubmit={submit} className={styles.form} aria-busy={busy} noValidate>
      <fieldset className={styles.fields} disabled={busy}>
        <div>
          <label htmlFor="login-username" className={styles.label}>{t("用户名")}</label>
          <div className={styles.inputWrap}><input id="login-username" name="username" value={username} onChange={event => { setUsername(event.target.value); clearIssue(); }} autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={128} aria-invalid={invalid("username")} aria-describedby={describedBy("username")} className={styles.input} /></div>
        </div>
        {mode === "reset" && <div>
          <label htmlFor="reset-code" className={styles.label}>{t("一次性重置凭据")}</label>
          <div className={styles.inputWrap}><input id="reset-code" name="resetCode" type={showResetCode ? "text" : "password"} autoComplete="off" required maxLength={256} onChange={clearIssue} aria-invalid={invalid("resetCode")} aria-describedby={describedBy("resetCode")} className={`${styles.input} ${styles.passwordInput}`} /><Button type="button" variant="ghost" size="icon" className={styles.visibility} aria-label={tx(showResetCode ? "隐藏重置凭据" : "显示重置凭据", showResetCode ? "Hide reset code" : "Show reset code")} aria-pressed={showResetCode} onClick={() => setShowResetCode(current => !current)}>{showResetCode ? <EyeOff size={18} /> : <Eye size={18} />}</Button></div>
        </div>}
        <div className={styles.passwordField}>
          <div className={styles.labelRow}>
            <label htmlFor="login-password" className={styles.label}>{t(mode === "reset" ? "新密码（8–128 位）" : "密码")}</label>
          </div>
          <div className={styles.inputWrap}>
            <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "reset" ? 8 : undefined} maxLength={128} onChange={clearIssue} aria-invalid={invalid("password")} aria-describedby={describedBy("password")} className={`${styles.input} ${styles.passwordInput}`} />
            <Button type="button" variant="ghost" size="icon" className={styles.visibility} aria-label={t(showPassword ? "隐藏密码" : "显示密码")} aria-pressed={showPassword} onClick={() => setShowPassword(current => !current)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</Button>
          </div>
        </div>
        {mode === "reset" && <div>
          <label htmlFor="password-confirmation" className={styles.label}>{t("再次输入新密码")}</label>
          <div className={styles.inputWrap}><input id="password-confirmation" name="confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} maxLength={128} onChange={clearIssue} aria-invalid={invalid("confirmation")} aria-describedby={describedBy("confirmation")} className={styles.input} /></div>
        </div>}
      </fieldset>
      <div className={styles.loginFeedback}>
        {error && <p id="login-error" tabIndex={-1} role="alert" className={styles.error}><AlertCircle size={16} aria-hidden="true" /><span>{error}</span></p>}
        {resetComplete && <p role="status" className={styles.success}>{t("密码已重置，请使用新密码登录。")}</p>}
      </div>
      <Button type="submit" disabled={busy} className={styles.submit} aria-label={busy ? tx(mode === "login" ? "正在登录…" : "正在处理…", mode === "login" ? "Signing in…" : "Processing…") : t(mode === "login" ? "登录" : "设置新密码")}>
        {busy ? <LoaderCircle size={17} className={styles.spinner} aria-hidden="true" /> : <LockKeyhole size={17} aria-hidden="true" />}
        <span role="status">{busy ? tx(mode === "login" ? "正在登录…" : "正在处理…", mode === "login" ? "Signing in…" : "Processing…") : t(mode === "login" ? "登录" : "设置新密码")}</span>
      </Button>
      <Button type="button" variant="link" className={styles.forgot} disabled={busy} onClick={switchMode}>{t(mode === "login" ? "忘记密码？" : "返回登录")}</Button>
    </form>
    <Link href="/register" className={`${buttonVariants({ variant: "secondary" })} ${styles.registerAction}`}>{t("注册账号 / 激活身份")}</Link>
  </AuthShell>;
}
