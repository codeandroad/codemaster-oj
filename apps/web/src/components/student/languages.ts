import type { ProductionProblem, SubmissionLanguage } from "@/lib/production-api";

export const supportedLanguages: SubmissionLanguage[] = ["python", "cpp", "javascript"];

export const languageInfo: Record<SubmissionLanguage, { name: string; file: string; runtime: string }> = {
  python: { name: "Python 3", file: "main.py", runtime: "Python 3.12" },
  cpp: { name: "C++", file: "main.cpp", runtime: "Clang · GCC libstdc++" },
  javascript: { name: "JavaScript", file: "main.js", runtime: "Node.js 22" },
};

export function submissionLanguage(value: string | null | undefined): SubmissionLanguage {
  return value === "cpp" || value === "javascript" ? value : "python";
}

export function starterFor(problem: ProductionProblem, language: SubmissionLanguage): string {
  return problem.starterCodes?.[language] ?? (language === "python" ? problem.starterCode ?? "" : "");
}
