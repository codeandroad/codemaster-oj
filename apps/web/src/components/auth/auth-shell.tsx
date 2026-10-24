"use client";

import { Languages } from "lucide-react";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { usePublicSite } from "./site-info";
import styles from "./auth-shell.module.css";

/** Public authentication uses the system's light palette, outside workspace themes. */
export function AuthShell({ children, titleId = "login-title" }: { children: ReactNode; titleId?: string }) {
  const { locale, setLocale } = useLocale();
  const site = usePublicSite();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const roles = [
    { name: tx("学生", "Students"), description: tx("课程学习、自由练习", "Courses and coding practice") },
    { name: tx("教师", "Teachers"), description: tx("课程、题库与教学活动", "Courses, problem banks and class activities") },
  ];
  return <main className={styles.page}>
    <div className={styles.frame}>
      <aside className={styles.introduction} aria-label={tx("CodeMaster OJ 简介", "About CodeMaster OJ")}>
        <div className={styles.brand}>
          <BrandLogo className={styles.logo} />
          <p className={styles.school} title={site.schoolName}>{site.schoolName}</p>
        </div>
        <ul className={styles.roles}>
          {roles.map(({ name, description }) => <li className={styles.role} key={name}>
            <div><h2>{name}</h2><p>{description}</p></div>
          </li>)}
        </ul>
      </aside>
      <section className={styles.formPanel} aria-labelledby={titleId}>
        <BrandLogo className={styles.mobileLogo} />
        {children}
      </section>
    </div>
    <footer className={styles.footer}>
      <Button type="button" variant="ghost" className={styles.language} onClick={() => setLocale(locale === "en" ? "zh" : "en")} aria-label={locale === "en" ? "切换为简体中文" : "Switch to English"}>
        <Languages size={15} aria-hidden="true" />{locale === "en" ? "简体中文" : "English"}
      </Button>
    </footer>
  </main>;
}

export function AuthNotice({ title, message, error = false, children }: { title: string; message: string; error?: boolean; children?: ReactNode }) {
  return <AuthShell><h2 id="login-title" className={styles.title}>{title}</h2><p className={styles.description} role={error ? "alert" : "status"}>{message}</p>{children}</AuthShell>;
}
