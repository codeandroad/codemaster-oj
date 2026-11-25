"use client";

import Link from "next/link";
import { AlertCircle, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError, apiMessage, productionApi, type AuthResponse, type CampusUser } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";
import { sitePolicyHref } from "@/lib/site-policy-links";
import { AuthShell } from "./auth-shell";
import styles from "./auth-shell.module.css";

type Field = "username" | "password" | "resetCode" | "confirmation";
type FormIssue = { field?: Field; kind: "username" | "password" | "resetCode" | "passwordLength" | "confirmation" | "login" | "disabled" | "resetFailed" | "server"; message?: string };

export function ProductionLoginPage({ onLogin, joinIntent = false, resetIntent = false }: { onLogin: (user: CampusUser) => void; joinIntent?: boolean; resetIntent?: boolean }) {
  const { t, locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [mode, setMode] = useState<"login" | "reset">(resetIntent ? "reset" : "login");
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
    resetFailed: tx("重置凭据无效或已过期。请打开管理员提供的重置入口，并使用最新的一次性凭据。", "The reset code is invalid or expired. Open the reset link from your administrator and use the newest code."),
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
        : reason instanceof ApiError && reason.code === "RESET_FAILED" ? { kind: "resetFailed", field: "resetCode" }
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
      <p className={styles.description}>{mode === "login" ? joinIntent ? tx("登录后，在「设置 → 学校」中选择「加入学校」。", "After signing in, open Settings → Schools and select “Join a school”.") : tx("登录后继续课程学习与编程练习。", "Continue your courses and coding practice.") : tx("未入校的个人用户请联系平台管理员；账号由学校独立管理的师生请联系本校管理员。", "For a personal account with no school membership, contact a platform administrator. For a student or teacher account managed exclusively by one school, contact that school’s administrator.")}</p>
    </header>
    {mode === "reset" && <details className={styles.help}>
      <summary>{tx("如何获取重置凭据？", "How do I get a reset code?")}</summary>
      <p>{tx("未入校的旧个人账号，即使没有绑定邮箱、无法登录，也可申请人工核验。请提供用户名，由平台管理员与你核对账号归属。", "If you have an older personal account with no school membership, you can request a manual review even without an email address or access to the account. Give the platform administrator your username to start the review.")} <Link className="text-primary underline" href={sitePolicyHref(locale, "contact")}>{tx("联系平台管理员", "Contact platform support")}</Link></p>
      <p>{tx("学校独立管理的账号由本校管理员核对档案姓名和学号或工号。管理员核实后会私下提供一次性重置码，有效期 30 分钟。平台不会自动发送找回邮件。", "For school-managed accounts, your school administrator checks your name and student or staff ID. After verification, the administrator gives you a one-time code valid for 30 minutes. There is no automated recovery email.")}</p>
      <p>{tx("已入校的个人账号、跨校账号或管理员账号如需帮助，请联系平台咨询。", "For help with a personal account linked to a school, a multi-school account or an administrator account, contact platform support.")}</p>
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
    <Link href={joinIntent ? "/register?join=1" : "/register"} className={`${buttonVariants({ variant: "secondary" })} ${styles.registerAction}`}>{tx("创建个人账号", "Create a personal account")}</Link>
  </AuthShell>;
}
