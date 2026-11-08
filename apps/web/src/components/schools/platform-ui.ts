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
        "This account is no longer available or the username does not match an active account. Choose or check the account and try again.",
        "该账号已不可用，或用户名未匹配到有效账号。请重新选择或核对后重试。",
      ),
      CONFLICT: text(
        "This create request conflicts with an existing school. Check the school list before starting a new request.",
        "此次建校请求与已有学校冲突，请先检查学校列表，再重新发起。",
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
        "Check the fields and try again.",
        "请检查填写内容后重试。",
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
