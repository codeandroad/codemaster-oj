import { importGender } from "../../lib/gender.ts";
import type { CampusGender } from "../../lib/production-api";

export type IdentityImportMode = "students" | "teachers";
export type IdentityKind = "student" | "teacher";

export function availableIdentityImportModes(isTeacherWorkspace: boolean): readonly IdentityImportMode[] {
  return isTeacherWorkspace ? ["students"] : ["students", "teachers"];
}

export interface IdentityImportRow {
  kind: IdentityKind;
  number: string;
  name: string;
  gender: CampusGender | null;
  genderSource: string;
  className: string;
  issue: string;
  line: number;
}

export function parseIdentityRows(value: unknown, mode: IdentityImportMode): IdentityImportRow[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw new Error("文件须包含 1–500 行身份数据，请分批导入。");
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const record = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const cell = (keys: string[]) => String(keys.map((key) => record[key]).find((entry) => entry !== undefined && entry !== null) ?? "").trim();
    const type = cell(["kind", "身份类型", "类型"]);
    const kind: IdentityKind = type === "teacher" || type === "教师" ? "teacher" : type === "student" || type === "学生" ? "student" : mode === "teachers" ? "teacher" : "student";
    const number = cell(["number", "学号", "工号", "编号"]);
    const name = cell(["name", "姓名"]);
    const genderSource = cell(["gender", "性别"]);
    const gender = importGender(genderSource);
    const className = cell(["className", "class", "班级", "班级名称", "负责班级"]);
    const key = `${kind}:${number}`;
    const wrongHeading = mode === "teachers" && "学号" in record && !("工号" in record || "number" in record || "编号" in record)
      ? "当前为教师身份导入，请使用工号列"
      : mode === "students" && "工号" in record && !("学号" in record || "number" in record || "编号" in record)
        ? "当前为学生导入，请使用学号列"
        : "";
    const issue = wrongHeading || !number ? wrongHeading || "编号不能为空" : !name ? "姓名不能为空" : type && !["student", "学生", "teacher", "教师"].includes(type)
      ? "身份类型须为 student 或 teacher"
      : (mode === "teachers" ? kind !== "teacher" : kind !== "student")
        ? `当前仅导入${mode === "teachers" ? "教师" : "学生"}身份，请切换导入类型`
        : gender === undefined ? "性别须为男、女、其他或不愿透露" : seen.has(key) ? "文件中编号重复" : number.length > 100 || name.length > 100 ? "编号或姓名过长" : "";
    seen.add(key);
    return { kind, number, name, gender: gender ?? null, genderSource, className, issue, line: index + 2 };
  });
}

export function identityCsvTemplate(mode: IdentityImportMode, isTeacherWorkspace = false): string {
  const header = mode === "teachers" ? "工号,姓名,性别,负责班级" : isTeacherWorkspace ? "学号,姓名,性别" : "学号,姓名,性别,班级";
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${header}\n`)}`;
}
