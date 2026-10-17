"use client";

import { useLocale, type AppLocale } from "@/components/locale-context";
export interface CourseAccessMetadata {
  authorName?: string;
  authoredAt?: string | null;
  createdAt?: string;
  coverImage?: string | null;
  accessScope?: "school" | "classes";
  classIds?: string[];
  classes?: { id: string; name: string; archived?: boolean }[];
  availableFrom?: string | null;
  availableUntil?: string | null;
  listed?: boolean;
  withdrawnAt?: string | null;
}
export function courseStatus(course: CourseAccessMetadata & { published: boolean; archived?: boolean }, locale: AppLocale) {
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  return course.archived ? tx("已归档", "Archived") : !course.published ? course.withdrawnAt ? tx("已下架", "Withdrawn") : tx("草稿", "Draft") : course.listed === false ? tx("已公开 · 目录隐藏", "Public · Unlisted") : course.availableFrom && Date.parse(course.availableFrom) > Date.now() ? tx("已公开 · 待开放", "Public · Scheduled") : course.availableUntil && Date.parse(course.availableUntil) <= Date.now() ? tx("已公开 · 已关闭", "Public · Closed") : tx("已公开", "Public");
}
export function CourseAccessSummary({ course, showAuthor = false }: { course: CourseAccessMetadata; showAuthor?: boolean }) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const date = (value: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium" }).format(new Date(value));
  const dateTime = (value: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-muted-foreground">
    <span>{course.accessScope === "classes" ? course.classes?.map(item => item.name).join(" / ") || tx("指定班级", "Selected classes") : tx("全校可学", "School-wide")}</span>
    {(course.availableFrom || course.availableUntil) && <span>{course.availableFrom ? dateTime(course.availableFrom) : tx("即日起", "Available now")} – {course.availableUntil ? dateTime(course.availableUntil) : tx("无截止时间", "No closing date")}</span>}
    {showAuthor && course.authorName && <span>{tx("创建者：", "Author: ")}{course.authorName}</span>}
    {showAuthor && (course.authoredAt || course.createdAt) && <span>{date((course.authoredAt || course.createdAt)!)}</span>}
  </span>;
}
