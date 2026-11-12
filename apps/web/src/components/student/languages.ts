import type { ProductionProblem, SubmissionLanguage } from "@/lib/production-api";
import type { AppLocale } from "@/lib/app-locale";

export const supportedLanguages: SubmissionLanguage[] = ["python", "cpp", "javascript"];

export const languageInfo: Record<SubmissionLanguage, { name: string; file: string; runtime: string }> = {
  python: { name: "Python 3", file: "main.py", runtime: "Python 3.12" },
  cpp: { name: "C++", file: "main.cpp", runtime: "Clang · GCC libstdc++" },
  javascript: { name: "JavaScript", file: "main.js", runtime: "Node.js 22" },
};

export function requiredLanguageText(locale: AppLocale, language: SubmissionLanguage, scope: "course" | "assignment" | "correction") {
  const name = languageInfo[language].name;
  const subject = locale === "en"
    ? { course: "This course", assignment: "This assignment", correction: "This correction" }[scope]
    : { course: "本课程", assignment: "本作业", correction: "本订正" }[scope];
  return locale === "en" ? `${subject} requires ${name}` : `${subject}要求使用 ${name}`;
}

export function submissionLanguage(value: string | null | undefined): SubmissionLanguage {
  return value === "cpp" || value === "javascript" ? value : "python";
}

export function starterFor(problem: Pick<ProductionProblem, "starterCode" | "starterCodes">, language: SubmissionLanguage): string {
  return problem.starterCodes?.[language] ?? (language === "python" ? problem.starterCode ?? "" : "");
}
