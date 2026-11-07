"use client";

import type { ReactNode } from "react";
import { LearningCover, courseDifficulties } from "@/components/learning-course";
import { useLocale } from "@/components/locale-context";
import { Empty, Table } from "./shared";

export function CourseCatalogTable({ children, empty }: { children: ReactNode; empty?: string }) {
  const { t } = useLocale();
  return (
    <div data-od-id="learning-path-table" className="min-w-0 [&_th]:whitespace-nowrap [&_td:not(:first-child)]:whitespace-nowrap [&_th:first-child]:w-[42%] [&_td:first-child]:min-w-[300px] [&_th:nth-child(2)]:w-[12%] [&_th:nth-child(3)]:w-[7%] [&_th:nth-child(4)]:w-[14%] [&_th:nth-child(5)]:w-[9%] [&_th:last-child]:w-[16%] [&_td:first-child_p]:max-w-md">
      <Table min={1000} headers={[t("课程名称"), t("分类"), t("章节"), t("可见范围"), t("状态"), t("操作")]}>
        {children}
        {empty && <Empty columns={6}>{empty}</Empty>}
      </Table>
    </div>
  );
}

export function CourseCatalogRow({ course, title, access, status, actions }: {
  course: { category: string; chapterCount: number; description: string; difficulty?: keyof typeof courseDifficulties; coverKey?: string; coverImage?: string | null };
  title: ReactNode;
  access: ReactNode;
  status: ReactNode;
  actions: ReactNode;
}) {
  const { t } = useLocale();
  return <tr>
    <td>
      <div className="mb-2 w-36"><LearningCover coverKey={course.coverKey} coverImage={course.coverImage}/></div>
      {title}
      <p className="mt-1 text-xs text-muted-foreground">{t(courseDifficulties[course.difficulty ?? "beginner"])}</p>
      <p className="mt-1 text-xs text-muted-foreground">{course.description}</p>
    </td>
    <td>{course.category}</td>
    <td>{course.chapterCount}</td>
    <td className="max-w-64 whitespace-normal">{access}</td>
    <td>{status}</td>
    <td>{actions}</td>
  </tr>;
}
