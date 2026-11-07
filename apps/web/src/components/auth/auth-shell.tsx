"use client";

import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { useLocale } from "@/components/locale-context";
import styles from "./auth-shell.module.css";

/** Public authentication uses the system's light palette, outside workspace themes. */
export function AuthShell({ children, titleId = "login-title" }: { children: ReactNode; titleId?: string }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const roles = [
    { name: tx("学生", "Students"), description: tx("课程学习、自由练习", "Courses and coding practice") },
    { name: tx("教师", "Teachers"), description: tx("课程、题库与教学活动", "Courses, problem banks and class activities") },
  ];
  return <main className={styles.page}>
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
      <section className={styles.formPanel} aria-labelledby={titleId}>
        <BrandLogo className={styles.mobileLogo} />
        {children}
      </section>
    </div>
  </main>;
}

export function AuthNotice({ title, message, error = false, children }: { title: string; message: string; error?: boolean; children?: ReactNode }) {
  return <AuthShell><h2 id="login-title" className={styles.title}>{title}</h2><p className={styles.description} role={error ? "alert" : "status"}>{message}</p>{children}</AuthShell>;
}
