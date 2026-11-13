"use client";

import type { ReactNode } from "react";
import { LearningCover, courseDifficulties } from "@/components/learning-course";
import { useLocale } from "@/components/locale-context";
import { Empty, Table } from "./shared";
import styles from "./course-catalog.module.css";

export function CourseCatalogTable({ children, empty }: { children: ReactNode; empty?: string }) {
  const { t, locale } = useLocale();
  const columnWidths = locale === "en" ? [34, 8, 6, 9, 8, 35] : [37, 10, 6, 11, 9, 27];
  return (
    <div data-od-id="learning-path-table" className="min-w-0 [&_th]:whitespace-nowrap [&_td]:align-middle [&_td:first-child]:min-w-[430px]">
      <Table min={1120} columnWidths={columnWidths} scrollLabel={locale==="en"?"Course list":"课程列表"} headers={[t("课程名称"), t("分类"), t("章节"), t("可见范围"), t("状态"), t("操作")]}>
        {children}
        {empty && <Empty columns={6}>{empty}</Empty>}
      </Table>
    </div>
  );
}

export function CourseCatalogRow({ course, title, access, status, actions }: {
  course: { id?: string; title?: string; ownerScope?: "school" | "platform"; category: string; chapterCount: number; description: string; difficulty?: keyof typeof courseDifficulties; coverKey?: string; coverImage?: string | null };
  title: ReactNode;
  access: ReactNode;
  status: ReactNode;
  actions: ReactNode;
}) {
  const { t } = useLocale();
  return <tr data-course-id={course.id}>
    <td>
      <div className={styles.summary} data-course-summary>
        <div className={styles.cover} data-course-cover><LearningCover coverKey={course.coverKey} coverImage={course.coverImage}/></div>
        <div className={styles.copy} data-course-copy>
          <div className={styles.title} title={course.title}>{title}</div>
          <div className={styles.metadata}><span>{t(courseDifficulties[course.difficulty ?? "beginner"])}</span>{course.ownerScope==="platform" && <span className="font-semibold text-primary">CodeMaster</span>}</div>
          {course.description&&<p className={styles.description} title={course.description}>{course.description}</p>}
        </div>
      </div>
    </td>
    <td><span className={styles.category} title={course.category}>{course.category}</span></td>
    <td>{course.chapterCount}</td>
    <td><div className={styles.access}>{access}</div></td>
    <td><div className={styles.status}>{status}</div></td>
    <td><div className={styles.actions}>{actions}</div></td>
  </tr>;
}
