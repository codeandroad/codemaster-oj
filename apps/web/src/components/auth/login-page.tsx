"use client";

import Link from "next/link";
import { usePublicSite } from "./site-info";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError, apiMessage, productionApi, type AuthResponse, type CampusUser } from "@/lib/production-api";
import {useLocale} from "@/components/locale-context";

const inputClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30";

export function ProductionLoginPage({ onLogin }: { onLogin: (user: CampusUser) => void }) {
  const {t}=useLocale();
  const site = usePublicSite();
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const username = String(fields.get("username") ?? "").trim();
      const password = fields.get("password");
      if (mode === "login") {
        const response = await productionApi<AuthResponse>("auth/login", {
          method: "POST", body: { username, password },
        });
        form.reset();
        onLogin(response.user);
      } else {
        if (password !== fields.get("confirmation")) throw new Error(t("两次输入的新密码不一致。"));
        await productionApi("auth/reset", {
          method: "POST",
          body: { username, resetCode: String(fields.get("resetCode") ?? "").trim(), password },
        });
        form.reset();
        setMode("login");
        setShowPassword(false);
        setMessage(t("密码已重置，请使用新密码登录。"));
      }
    } catch (reason) {
      setError(reason instanceof ApiError && reason.code === "ACCOUNT_DISABLED" ? t("账号已禁用") : reason instanceof ApiError && reason.code === "LOGIN_FAILED" ? t("用户名或密码不正确") : apiMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-5 sm:px-6 sm:py-10">
      <div className="mx-auto grid max-w-[1120px] items-start gap-8 lg:min-h-[calc(100vh-80px)] lg:items-center lg:gap-10 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="hidden lg:block">
          <BrandLogo className="h-auto w-[386px] max-w-full" />
          <p className="mt-3 text-lg text-muted-foreground">{site.schoolName}</p>
          <div className="mt-8 grid max-w-xl grid-cols-3 gap-3 text-sm">{[["学生", "学习、作业、训练、订正"], ["教师", "题库、班级、活动"], ["管理员", "账号、服务、设置"]].map(([label, value]) => <div key={label} className="border border-border bg-surface p-4 panel-shadow"><div className="text-xs font-semibold text-muted-foreground">{t(label)}</div><div className="mt-2 text-sm font-semibold">{t(value)}</div></div>)}</div>
        </section>
        <section className="mx-auto w-full max-w-[520px] border border-border bg-surface p-4 panel-shadow sm:p-6" aria-labelledby="login-title">
          <BrandLogo className="mb-4 h-auto w-[230px] max-w-full lg:hidden" />
          <h2 id="login-title" className="text-2xl font-bold">{t(mode === "login" ? "登录" : "重置密码")}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(mode === "login" ? "使用你在注册时自行设置的用户名与密码登录。日常登录无需再次验证身份，也无需强制修改密码。" : "请先向学校管理员核实身份并取得一次性重置凭据，然后自行设置新密码。")}</p>
          {mode === "reset" && <div className="mt-4 space-y-3 text-sm leading-6"><h3 className="font-bold">{t("联系学校管理员重置密码")}</h3><p className="text-muted-foreground">{t("本校使用本地账号，没有公网邮件找回服务。请向课程教师或管理员提供用户名、姓名及学号 / 工号，由管理员核实身份后提供一次性重置凭据。不要提供原密码。")}</p><p className="border border-border bg-surface-subtle p-3">{t("已有账号无需重新注册或再次激活；重置密码不会删除班级、作业或提交记录。")}</p></div>}<form key={mode} onSubmit={submit} className="mt-5 space-y-4" aria-busy={busy}>
            <label htmlFor="login-username" className="block text-sm font-semibold">{t("用户名")}
              <input id="login-username" name="username" autoComplete="username" autoCapitalize="none" required maxLength={128} className={`mt-1 ${inputClass}`} />
            </label>
            {mode === "reset" && <label htmlFor="reset-code" className="block text-sm font-semibold">{t("一次性重置凭据")}
              <input id="reset-code" name="resetCode" autoComplete="off" required maxLength={256} className={`mt-1 ${inputClass}`} />
            </label>}
            <div>
              <label htmlFor="login-password" className="block text-sm font-semibold">{t(mode === "reset" ? "新密码（8–128 位）" : "密码")}</label>
              <div className="relative mt-1">
                <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "reset" ? 8 : undefined} maxLength={128} aria-describedby={error ? "login-error" : undefined} className={`${inputClass} pr-12`} />
                <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-11 w-11" aria-label={t(showPassword ? "隐藏密码" : "显示密码")} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</Button>
              </div>
            </div>
            {mode === "reset" && <label htmlFor="password-confirmation" className="block text-sm font-semibold">{t("再次输入新密码")}
              <input id="password-confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={`mt-1 ${inputClass}`} />
            </label>}
            {error && <p id="login-error" role="alert" className="border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
            {message && <p role="status" className="text-sm text-success">{message}</p>}
            <Button type="submit" disabled={busy} className="h-11 w-full"><LockKeyhole size={16} />{t(busy ? "正在处理…" : mode === "login" ? "登录" : "设置新密码")}</Button>
            <Button type="button" variant="link" className="h-11 px-0" disabled={busy} onClick={() => { setMode(mode === "login" ? "reset" : "login"); setError(""); setMessage(""); setShowPassword(false); }}>{t(mode === "login" ? "忘记密码？" : "返回登录")}</Button>
          </form>
          <Link href="/register" className={`${buttonVariants({ variant: "secondary" })} mt-3 min-h-11 w-full`}>{t("注册账号 / 激活身份")}</Link>
        </section>
      </div>
    </main>
  );
}
