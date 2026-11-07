import { jsonValue, validateFunctionInput } from "../../lib/function-input.ts";
import type { Definition } from "./school-practice-types.ts";

export const schoolProblemDefaults: Definition = {
  title: "", statement: "", mode: "stdio", comparator: "tokens",
  starterCode: "# Read input and print the result.\n", referenceCode: "",
  samples: [{ input: "", expected: "" }],
  tests: [{ input: "", expected: "", weight: 100 }],
  timeLimitMs: 1000, memoryLimitMb: 128,
};
export type ProblemEditorSection = "statement" | "interface" | "tests" | "reference";
export type DraftIssue = { section: ProblemEditorSection; message: string };

// Switching interfaces must not replace a teacher's program or test cases.
export function schoolProblemMode(draft: Definition, mode: Definition["mode"]): Definition {
  const name = draft.functionName || "solve";
  const template = `def ${name}(data):\n    pass\n`;
  const untouched = !draft.starterCode || draft.starterCode === schoolProblemDefaults.starterCode || draft.starterCode === template;
  return { ...draft, mode, functionName: name, comparator: mode === "function" ? "json" : draft.mode === "function" ? "tokens" : draft.comparator,
    starterCode: untouched ? mode === "function" ? template : schoolProblemDefaults.starterCode : draft.starterCode };
}

export function equalSchoolTestWeights(tests: NonNullable<Definition["tests"]>) {
  if (!tests.length) return [];
  const units = Math.floor(1_000_000 / tests.length);
  return tests.map((test, index) => ({ ...test, weight: (index === tests.length - 1 ? 1_000_000 - units * index : units) / 10_000 }));
}

export function schoolProblemDraftIssue(draft: Definition, locale: string): DraftIssue | null {
  const tx = (en: string, zh: string) => locale === "zh" ? zh : en;
  const issue = (section: ProblemEditorSection, en: string, zh: string): DraftIssue => ({ section, message: tx(en, zh) });
  if (!draft.title.trim()) return issue("statement", "Enter a problem title.", "请输入题目名称。");
  if (!draft.statement.trim()) return issue("statement", "Enter the problem statement.", "请输入题面。");
  if (draft.mode === "function" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(draft.functionName ?? "")) return issue("interface", "Enter a valid Python function name.", "请输入有效的 Python 函数名称。");
  if (!Number.isInteger(draft.timeLimitMs) || draft.timeLimitMs < 100 || draft.timeLimitMs > 5000) return issue("interface", "Time limit must be an integer from 100 to 5000 ms.", "时间限制须为 100 至 5000 毫秒的整数。");
  if (!Number.isInteger(draft.memoryLimitMb) || draft.memoryLimitMb < 32 || draft.memoryLimitMb > 256) return issue("interface", "Memory limit must be an integer from 32 to 256 MB.", "内存限制须为 32 至 256 MB 的整数。");
  for (const kind of ["samples", "tests"] as const) {
    const rows = draft[kind] ?? [], max = kind === "samples" ? 20 : 100;
    if (!rows.length || rows.length > max) return issue("tests", `${kind === "samples" ? "Public samples" : "Formal tests"} must contain 1–${max} cases.`, `${kind === "samples" ? "公开样例" : "正式测试"}须有 1 至 ${max} 条。`);
    for (const [index, row] of rows.entries()) {
      try {
        if (draft.mode === "function") validateFunctionInput(row.input);
        if (draft.mode === "function" || draft.comparator === "json") jsonValue(row.expected);
      } catch {
        return issue("tests", `${kind === "samples" ? "Sample" : "Test"} ${index + 1}: check JSON arguments and expected return value.`, `${kind === "samples" ? "样例" : "测试"} ${index + 1}：请检查 JSON 参数和预期返回值。`);
      }
    }
  }
  const tests = draft.tests ?? [];
  if (tests.some(test => !Number.isFinite(test.weight) || test.weight <= 0 || test.weight > 100 || Math.abs(Math.round(test.weight * 10000) / 10000 - test.weight) > 1e-9) || tests.reduce((sum, test) => sum + Math.round(test.weight * 10000), 0) !== 1_000_000) {
    return issue("tests", "Formal test weights must be positive, use at most 4 decimal places, and total 100.", "正式测试权重须为正数、最多 4 位小数，合计 100。");
  }
  if (!draft.referenceCode?.trim()) return issue("reference", "Enter a reference program for validation.", "请输入用于验证的参考程序。");
  return null;
}
