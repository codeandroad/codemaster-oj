"use client";

import { Languages } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { useLocale } from "@/components/locale-context";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import styles from "./auth-shell.module.css";

/** Public authentication uses the system's light palette, outside workspace themes. */
export function AuthShell({ children, titleId = "login-title" }: { children: ReactNode; titleId?: string }) {
  const { locale, setLocale } = useLocale();
  const pathname = usePathname();
  const showLanguageToggle = pathname === "/" || pathname === "/login";
  const nextLocale = locale === "zh" ? "en" : "zh";
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const roles = [
    { name: tx("学生", "Students"), description: tx("课程学习、自由练习", "Courses and coding practice") },
    { name: tx("教师", "Teachers"), description: tx("课程、题库与教学活动", "Courses, problem banks and class activities") },
  ];
  return <div className={styles.page}>
    <main className={styles.main}>
      <div className={styles.frame}>
        <aside className={styles.introduction} aria-label={tx("CodeMaster 简介", "About CodeMaster")}>
          <div className={styles.brand}>
            <BrandLogo className={styles.logo} />
            <p className={styles.school}>{tx("计算机科学 • 在线学习平台", "Computer Science • Online Learning Platform")}</p>
          </div>
          <ul className={styles.roles}>
            {roles.map(({ name, description }) => <li className={styles.role} key={name}>
              <div><h2>{name}</h2><p>{description}</p></div>
            </li>)}
          </ul>
        </aside>
        <div className="flex min-w-0 flex-col">
          {showLanguageToggle && <Button type="button" variant="outline" size="icon" className="mb-2 self-end"
            lang={nextLocale === "zh" ? "zh-CN" : "en"} aria-label={nextLocale === "zh" ? "切换到简体中文" : "Switch to English"}
            onClick={() => setLocale(nextLocale)}>
            <Languages size={18} aria-hidden="true" />
          </Button>}
          <section className={styles.formPanel} aria-labelledby={titleId}>
            <BrandLogo className={styles.mobileLogo} />
            {children}
          </section>
        </div>
      </div>
    </main>
    <SiteFooter locale={locale} className={styles.footer} />
  </div>;
}

export function AuthConnectionNotice({ register, error, onRetry }: { register: boolean; error: string; onRetry: () => void }) {
  const { locale, t } = useLocale();
  const connecting = locale === "zh" ? "正在连接 CodeMaster…" : "Connecting to CodeMaster…";
  const title = error
    ? locale === "zh" ? "无法连接" : "Unable to connect"
    : register ? "Create account" : t("登录");
  return <AuthShell>
    <h2 id="login-title" className={styles.title}>{title}</h2>
    <p className={styles.description} role={error ? "alert" : "status"}>{error || connecting}</p>
    {error && <div className="mt-5 flex flex-wrap gap-2">
      <Button className="w-fit" onClick={onRetry}>{locale === "zh" ? "重试" : "Retry"}</Button>
      <Button type="button" variant="secondary" className="w-fit" onClick={() => window.location.reload()}>{locale === "zh" ? "刷新整个页面" : "Refresh page"}</Button>
    </div>}
  </AuthShell>;
}
