"use client";

import { AppLink as Link } from "@/components/navigation";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-chrome";
import { useLocale } from "@/components/locale-context";
import { buttonVariants } from "@/components/ui/button";
import { IdentityImportWizard } from "@/components/admin/import-page";
import type { CampusUser } from "@/lib/production-api";
import { TeacherDashboard, TeacherClasses } from "./dashboard-classes";
import { TeacherBankDetail } from "./bank-detail";
import { TeacherBanks } from "./problem-banks";
import { TeacherProblemEditor } from "./problem-editor";
import {
  TeacherAssignments,
  TeacherAssignmentEditor,
  TeacherAssignmentProgress,
} from "./assignments";
import { TeacherLearning, TeacherLearningEditor } from "./learning";
import {
  TeacherTimedList,
  TeacherTimedEditor,
  TeacherTimedProgress,
} from "./timed";
import { TeacherReports } from "./reports";
import { TeacherProblemImports } from "./imports";

export function TeacherPages({
  pathname,
  user,
}: {
  pathname: string;
  user: CampusUser;
}) {
  const path = pathname.replace(/\/$/, "");
  if (path === "/teacher") return <TeacherDashboard />;
  if (path === "/teacher/classes") return <TeacherClasses user={user} />;
  if (path === "/teacher/problems") return <TeacherBanks user={user} />;
  let match = path.match(/^\/teacher\/problems\/banks\/([^/]+)$/);
  if (match) return <TeacherBankDetail id={match[1]!} />;
  match = path.match(/^\/teacher\/problems\/([^/]+)\/edit$/);
  if (match) return <TeacherProblemEditor id={match[1]!} user={user} />;
  if (path === "/teacher/assignments") return <TeacherAssignments />;
  match = path.match(/^\/teacher\/assignments\/([^/]+)\/(edit|progress)$/);
  if (match)
    return match[2] === "edit" ? (
      <TeacherAssignmentEditor id={match[1]!} userId={user.id} />
    ) : (
      <TeacherAssignmentProgress id={match[1]!} />
    );
  if (path === "/teacher/courses" || path === "/teacher/learning") return <TeacherLearning />;
  match = path.match(/^\/teacher\/(?:courses|learning)\/([^/]+)$/);
  if (match) return <TeacherLearningEditor id={match[1]!} />;
  if (path === "/teacher/timed-practice") return <TeacherTimedList />;
  match = path.match(
    /^\/teacher\/timed-practice\/([^/]+)(?:\/(edit|progress))?$/,
  );
  if (match)
    return match[2] === "edit" ? (
      <TeacherTimedEditor id={match[1]!} userId={user.id} />
    ) : (
      <TeacherTimedProgress id={match[1]!} />
    );
  if (path === "/teacher/reports") return <TeacherReports />;
  if (path === "/teacher/imports") return <TeacherImports user={user} />;
  return null;
}
function TeacherImports({ user }: { user: CampusUser }) {
  const search = useSearchParams();
  const { t } = useLocale();
  const classId = search.get("classId") ?? "";
  // Old member-import bookmarks remain valid; students and members now share one flow.
  return ["students", "members"].includes(search.get("kind") ?? "") ? (
    <>
      <PageHeader
        eyebrow={t("学生名单")}
        title={t("学生名单导入")}
        description={t("只可导入自己负责班级的学生。导入会建立或关联身份；学生凭激活码认领后才创建登录账号。")}
        action={<Link className={buttonVariants({ variant: "secondary" })} href="/teacher/classes">{t("返回班级与学生")}</Link>}
      />
      <IdentityImportWizard key={classId} teacher teacherIdentityId={user.identityId} initialClassId={classId} showHeader={false} />
    </>
  ) : (
    <TeacherProblemImports />
  );
}
