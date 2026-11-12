"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-context";
import {
  courseLanguageKey,
  validCourseLanguage,
  type CourseLanguage,
} from "./course-localization";

const CourseLanguageContext = createContext<{
  language: CourseLanguage;
  save: (language: CourseLanguage) => void;
}>({ language: "en", save: () => {} });
export function CourseLanguageProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const [language, setLanguage] = useState<CourseLanguage>("en");
  useEffect(() => {
    const read = () => {
      try {
        setLanguage(
          validCourseLanguage(
            localStorage.getItem(courseLanguageKey(accountId)),
          ) ?? "en",
        );
      } catch {}
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [accountId]);
  const save = useCallback(
    (next: CourseLanguage) => {
      setLanguage(next);
      try {
        localStorage.setItem(courseLanguageKey(accountId), next);
      } catch {}
    },
    [accountId],
  );
  return (
    <CourseLanguageContext.Provider value={{ language, save }}>
      {children}
    </CourseLanguageContext.Provider>
  );
}
export function useCourseLanguage() {
  const context = useContext(CourseLanguageContext),
    params = useSearchParams();
  const language =
    validCourseLanguage(params.get("contentLanguage")) ?? context.language;
  function change(next: CourseLanguage) {
    context.save(next);
    const url = new URL(window.location.href);
    url.searchParams.set("contentLanguage", next);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  return { language, setLanguage: change };
}
export function CourseLanguageControl({
  language,
  onChange,
  missing = false,
}: {
  language: CourseLanguage;
  onChange: (language: CourseLanguage) => void;
  missing?: boolean;
}) {
  const { locale } = useLocale();
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-od-id="course-content-language"
    >
      <label className="flex items-center gap-2 text-sm font-medium">
        {locale === "en" ? "Content language" : "内容语言"}
        <select
          value={language}
          onChange={(event) => onChange(event.target.value as CourseLanguage)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          <option value="en">English</option>
          <option value="zh">中文</option>
        </select>
      </label>
      {missing && (
        <span role="status" className="text-xs text-muted-foreground">
          {locale === "en"
            ? "Translation unavailable; showing the original content."
            : "暂无此语言译文，显示原有内容。"}
        </span>
      )}
    </div>
  );
}
