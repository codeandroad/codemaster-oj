"use client";

import { useLocale } from "@/components/locale-context";
import { ApiError } from "@/lib/production-api";

export type SchoolRole = "school_admin" | "teacher" | "student";
export type School = {
  id: string;
  slug: string;
  name: string;
  nameZh?: string | null;
  nameEn?: string | null;
  roles: SchoolRole[];
  legacy: boolean;
};
export function schoolDisplayName(
  school: Pick<School, "name" | "nameZh" | "nameEn">,
  locale: string,
) {
  return (
    (locale === "en"
      ? school.nameEn || school.nameZh
      : school.nameZh || school.nameEn) || school.name
  );
}

export function useSchoolText() {
  const { locale } = useLocale();
  return (en: string, zh: string) => (locale === "en" ? en : zh);
}

export function useSchoolError() {
  const text = useSchoolText();
  return (error: unknown) => {
    if (error instanceof ApiError) {
      const messages: Record<string, string> = {
        INVALID_INVITATION: text(
          "This invitation is invalid, expired, or already used. Ask the school administrator for a new code.",
          "邀请无效、已过期或已使用，请向学校管理员获取新的邀请码。",
        ),
        ALREADY_MEMBER: text(
          "You already belong to this school.",
          "你已加入这所学校。",
        ),
        CONFLICT: text(
          "A record or link with these details already exists. Refresh the list before trying again.",
          "档案或关联已存在，请刷新列表后重试。",
        ),
        CLASS_ARCHIVED: text(
          "Restore this archived class before making changes.",
          "请先恢复已归档的班级，再进行修改。",
        ),
        TEACHER_IDENTITY_REQUIRED: text(
          "Ask your school administrator to link your teacher identity first.",
          "请先联系学校管理员关联你的教师身份档案。",
        ),
        VALIDATION: text(
          "Check the details and select a member with the matching role.",
          "请核对填写内容，并选择角色匹配的成员。",
        ),
        EXIT_STATE_CHANGED: text(
          "The request or student record changed. Refresh the list and try again.",
          "退校申请或学生档案已变更，请刷新后重试。",
        ),
        FORBIDDEN: text(
          "You do not have permission to manage this school.",
          "你没有管理这所学校的权限。",
        ),
        NOT_FOUND: text(
          "This school or record is no longer available. Refresh the list.",
          "学校或记录已不可用，请刷新列表。",
        ),
        INVITATION_LIMIT: text(
          "This school has reached its pending invitation limit. Use an existing invitation or wait for it to expire.",
          "这所学校的待领取邀请已达上限，请使用现有邀请或等待过期。",
        ),
        UNAUTHENTICATED: text(
          "Your session has expired. Sign in again.",
          "登录已过期，请重新登录。",
        ),
      };
      if (messages[error.code]) return new Error(messages[error.code]);
    }
    return new Error(
      text(
        "The request could not be completed. Check your connection and refresh before retrying.",
        "操作未能完成，请检查网络并刷新后重试。",
      ),
    );
  };
}

export function RoleLabel({ role }: { role: SchoolRole }) {
  const text = useSchoolText();
  return role === "school_admin"
    ? text("School administrator", "学校管理员")
    : role === "teacher"
      ? text("Teacher", "教师")
      : text("Student", "学生");
}
