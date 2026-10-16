"use client";

import { memo, useMemo } from "react";
import { LessonContent } from "@/components/student/shared";
import { formatPaper4Statement } from "./paper4-content-format";
import styles from "./paper4-content.module.css";

export const Paper4Content = memo(function Paper4Content({ content }: { content: string }) {
  const display = useMemo(() => formatPaper4Statement(content), [content]);
  return <div className={styles.reading}><LessonContent content={display} preserveHeadingLevels/></div>;
});
