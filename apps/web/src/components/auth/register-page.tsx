"use client";

import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { apiMessage, productionApi } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";
import { AuthShell } from "./auth-shell";
import { registrationIssue, type RegistrationField, type RegistrationIssue, type RegistrationValues } from "./registration-fields";
import styles from "./auth-shell.module.css";

interface VerifiedPerson { kind: "student" | "teacher"; number: string; name: string; classes: string[]; }
type Issue = RegistrationIssue | { kind: "server"; message: string; field?: RegistrationField };

export function ProductionRegisterPage() {
  const { t, locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [step, setStep] = useState<"verify" | "account" | "done">("verify");
  const [kind, setKind] = useState<"student" | "teacher">("student");
  const [show, setShow] = useState(false), [showActivation, setShowActivation] = useState(false);
  const [busy, setBusy] = useState(false), [issue, setIssue] = useState<Issue | null>(null);
  const [person, setPerson] = useState<VerifiedPerson | null>(null);
  const [values, setValues] = useState<RegistrationValues>({ number: "", name: "", activationCode: "", username: "", password: "", confirmation: "", email: "" });
  const title = useRef<HTMLHeadingElement>(null), firstRender = useRef(true), submitting = useRef(false);
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } title.current?.focus(); }, [step]);
  const labels: Record<RegistrationField, string> = {
    number: t(kind === "student" ? "学号" : "工号"), name: t("姓名"), activationCode: t("激活码"),
    username: t("用户名"), password: t("密码"), confirmation: t("确认密码"), email: t("联系邮箱（可选）"),
  };
  const error = !issue ? "" : issue.kind === "server" ? t(issue.message) : {
    required: tx(`请填写${labels[issue.field]}。`, `Enter your ${labels[issue.field].toLowerCase()}.`),
    username: tx("用户名需为 3–40 位英文字母、数字、点、下划线或短横线，并以字母或数字开头。", "Use 3–40 letters, numbers, dots, underscores or hyphens, starting with a letter or number."),
    password: tx("密码需要 8–128 位。", "Use 8–128 characters for your password."),
    confirmation: t("两次输入的密码不一致，请重新确认。"),
    email: tx("请填写有效的邮箱地址，或留空。", "Enter a valid email address, or leave it blank."),
  }[issue.kind];
  function focusField(field?: RegistrationField) {
    requestAnimationFrame(() => document.getElementById(field ? `register-${field}` : "register-error")?.focus());
  }
  function change(field: RegistrationField, value: string) { setValues(old => ({ ...old, [field]: value })); setIssue(null); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || step === "done") return;
    const invalid = registrationIssue(step, values);
    if (invalid) { setIssue(invalid); focusField(invalid.field); return; }
    submitting.current = true; setBusy(true); setIssue(null);
    try {
      const identity = { kind, number: values.number.trim(), name: values.name.trim(), activationCode: values.activationCode.trim() };
      if (step === "verify") {
        const result = await productionApi<{ person: VerifiedPerson }>("auth/verify-identity", { method: "POST", body: identity });
        setPerson(result.person); setShowActivation(false); setStep("account");
      } else {
        await productionApi("auth/register", { method: "POST", body: { ...identity, username: values.username.trim(), password: values.password, email: values.email.trim() || null } });
        setValues(old => ({ ...old, activationCode: "", password: "", confirmation: "" })); setShow(false); setStep("done");
      }
    } catch (reason) {
      const field = step === "verify" ? "activationCode" : undefined;
      setIssue({ kind: "server", message: apiMessage(reason), field }); focusField(field);
    } finally { submitting.current = false; setBusy(false); }
  }
  function field(name: RegistrationField, options: { type?: string; autoComplete?: string; required?: boolean; minLength?: number; maxLength?: number } = {}) {
    const secret = name === "password" || name === "activationCode", revealed = name === "activationCode" ? showActivation : show;
    return <div><label htmlFor={`register-${name}`} className={styles.label}>{labels[name]}</label>
      <div className={styles.inputWrap}><input id={`register-${name}`} name={name} value={values[name]} onChange={event => change(name, event.target.value)}
        type={secret ? revealed ? "text" : "password" : options.type ?? "text"} autoComplete={options.autoComplete ?? "off"}
        autoCapitalize={name === "username" ? "none" : undefined} spellCheck={false} required={options.required ?? true}
        minLength={options.minLength} maxLength={options.maxLength ?? 128} aria-invalid={issue?.field === name}
        aria-describedby={issue?.field === name ? "register-error" : name === "password" ? "password-hint" : undefined}
        className={`${styles.input} ${secret ? styles.passwordInput : ""}`} />
        {secret && <Button type="button" variant="ghost" size="icon" className={styles.visibility}
          aria-label={name === "activationCode" ? tx(revealed ? "隐藏激活码" : "显示激活码", revealed ? "Hide activation code" : "Show activation code") : t(revealed ? "隐藏密码" : "显示密码")}
          aria-pressed={revealed} onClick={() => name === "activationCode" ? setShowActivation(value => !value) : setShow(value => !value)}>
          {revealed ? <EyeOff size={18} /> : <Eye size={18} />}</Button>}
      </div></div>;
  }
  const feedback = <div className={styles.feedback}>{error && <p id="register-error" tabIndex={-1} role="alert" className={styles.error}><AlertCircle size={16} aria-hidden="true" /><span>{error}</span></p>}</div>;
  return <AuthShell titleId="register-title">
    <header><h2 ref={title} tabIndex={-1} id="register-title" className={styles.title}>{t(step === "verify" ? "注册账号" : step === "account" ? "设置登录账号" : "注册完成")}</h2>
      <p className={styles.description}>{step === "done" ? t("请使用自行设置的用户名和密码登录。") : tx("先验证学校身份，再设置登录账号。", "Verify your school identity, then set up your account.")}</p></header>
    <ol aria-label={t("注册进度")} className={styles.steps}>{[["verify", "验证身份"], ["account", "设置账号"], ["done", "完成"]].map(([value, label], index) => {
      const done = step === "done" && value !== "done" || step === "account" && value === "verify";
      return <li key={value} aria-current={value === step ? "step" : undefined} className={`${styles.step} ${done ? styles.complete : ""}`}><span className={styles.stepNumber}>{done ? "✓" : index + 1}</span><span>{t(label)}</span></li>;
    })}</ol>
    {step === "verify" && <form onSubmit={submit} noValidate className={styles.registerForm} aria-busy={busy}>
      <fieldset disabled={busy} className={styles.fields}>
        <div role="group" aria-label={t("身份类型")} className={styles.identityKind}>{(["student", "teacher"] as const).map(role => <Button key={role} type="button" aria-pressed={role === kind} variant={role === kind ? "primary" : "secondary"} className={styles.kindButton} onClick={() => { setKind(role); setPerson(null); setShowActivation(false); setValues(old => ({ ...old, number: "", name: "", activationCode: "" })); setIssue(null); }}>{t(role === "student" ? "我是学生" : "我是教师")}</Button>)}</div>
        <details className={styles.help}><summary>{tx("如何获取激活码？", "How do I get an activation code?")}</summary><p>{t(kind === "student" ? "首次注册时，请填写名单中的学号和姓名，以及教师或管理员提供的激活码，认领已有身份。验证通过后，由你自行设置用户名与密码，管理员不代建账号。日常登录无需重复验证身份。" : "首次注册时，请填写名单中的工号和姓名，以及管理员提供的激活码，认领已有身份。验证通过后，由你自行设置用户名与密码，管理员不代建账号。日常登录无需重复验证身份。")}</p></details>
        <div className={styles.identityGrid}>{field("number", { maxLength: 200 })}{field("name", { autoComplete: "name", maxLength: 100 })}</div>
        {field("activationCode", { autoComplete: "one-time-code", maxLength: 100 })}
      </fieldset>{feedback}
      <Button type="submit" disabled={busy} className={styles.submit} aria-label={t(busy ? "正在验证…" : "验证身份")}>{busy ? <LoaderCircle size={17} className={styles.spinner} aria-hidden="true" /> : <KeyRound size={17} aria-hidden="true" />}<span role="status">{t(busy ? "正在验证…" : "验证身份")}</span></Button>
    </form>}
    {step === "account" && <form onSubmit={submit} noValidate className={styles.registerForm} aria-busy={busy}>
      <p className={styles.notice}>{t("身份验证通过")}：<strong>{person?.name}</strong> · {person?.number}{person?.classes.length ? `（${person.classes.join("、")}）` : ""}</p>
      <fieldset disabled={busy} className={`${styles.fields} ${styles.registerFields}`}>
        {field("username", { autoComplete: "username", minLength: 3, maxLength: 40 })}
        <div className={styles.fieldGrid}>{field("password", { autoComplete: "new-password", minLength: 8 })}{field("confirmation", { type: show ? "text" : "password", autoComplete: "new-password", minLength: 8 })}</div>
        <p id="password-hint" className={styles.hint}>{t("至少 8 位。")}</p>
        {field("email", { type: "email", autoComplete: "email", required: false, maxLength: 254 })}
      </fieldset>{feedback}
      <Button type="submit" disabled={busy} className={styles.submit} aria-label={t(busy ? "正在创建…" : "完成注册")}>{busy ? <LoaderCircle size={17} className={styles.spinner} aria-hidden="true" /> : <UserRound size={17} aria-hidden="true" />}<span role="status">{t(busy ? "正在创建…" : "完成注册")}</span></Button>
      <div className={styles.back}><Button type="button" variant="link" disabled={busy} className={styles.textButton} onClick={() => { setIssue(null); setShow(false); setShowActivation(false); setPerson(null); setStep("verify"); }}><ArrowLeft size={14} />{t("返回验证身份")}</Button></div>
    </form>}
    {step === "done" && <div className={styles.done}><CheckCircle2 size={34} aria-hidden="true" /><p>{values.name} · {values.number} {t("已关联账号")} <strong>{values.username}</strong>。{t("历史作业与提交记录仍属于你的身份档案。")}</p><Link href="/login" className={styles.submit + " inline-flex items-center justify-center text-sm font-semibold"}>{t("前往登录")}</Link></div>}
    {step !== "done" && <p className={styles.register}><span>{t("已有账号？")}</span><Link href="/login" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>{t("返回登录")}</Link></p>}
  </AuthShell>;
}
