"use client";

import { ApiError } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

export type PlatformSchool = {
  id: string;
  slug: string;
  name: string;
  legacy: boolean;
  createdAt: string;
  counts: {
    members: number;
    identities: number;
    classes: number;
    banks: number;
    courses: number;
    assignments: number;
    papers: number;
  };
  administrators: {
    accountId: string;
    name: string;
    username: string;
    source: "membership" | "grant" | "legacy";
  }[];
};

export type PlatformSchoolAction =
  | { mode: "create" }
  | { mode: "rename" | "administrator"; school: PlatformSchool };

export function usePlatformError() {
  const text = useSchoolText();
  return (error: unknown) => {
    const messages: Record<string, string> = {
      PLATFORM_ADMIN_REQUIRED: text(
        "Platform administrator access is required. Your access may have changed; refresh this page.",
        "需要平台管理员权限。你的权限可能已变更，请刷新页面。",
      ),
      ACCOUNT_NOT_FOUND: text(
        "No active account matches this username. Check it with the intended administrator.",
        "未找到此用户名对应的有效账号，请向拟任命的管理员核对。",
      ),
      CONFLICT: text(
        "This school code is already in use. Refresh the list before trying again.",
        "学校标识已被使用，请先刷新列表再试。",
      ),
      STALE_SCHOOL: text(
        "The school name changed while this form was open. Close this form and refresh before renaming it.",
        "学校名称已被其他操作修改，请关闭此窗口、刷新列表后再修改。",
      ),
      LEGACY_ADMIN_MANAGEMENT: text(
        "This school's existing administrator roles are maintained in its original workspace.",
        "这所学校的既有管理员角色在原工作区维护。",
      ),
      VALIDATION: text(
        "Check the school name, school code and username. Use 3–50 lowercase letters, digits or hyphens for the school code.",
        "请检查学校名称、学校标识和用户名。学校标识须为 3–50 位小写字母、数字或连字符。",
      ),
      UNAUTHENTICATED: text(
        "Your session has expired. Sign in again.",
        "登录已过期，请重新登录。",
      ),
      CSRF: text("Refresh this page and try again.", "请刷新页面后重试。"),
      NOT_FOUND: text(
        "This school is no longer available. Refresh the list.",
        "学校已不可用，请刷新列表。",
      ),
    };
    return new Error(
      error instanceof ApiError && messages[error.code]
        ? messages[error.code]
        : text(
            "The request could not be completed. Check your connection and retry.",
            "操作未能完成，请检查网络后重试。",
          ),
    );
  };
}
