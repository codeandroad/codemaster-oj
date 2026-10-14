"use client";

import { AppLink as Link } from "@/components/navigation";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-chrome";
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
  if (path === "/teacher/learning") return <TeacherLearning />;
  match = path.match(/^\/teacher\/learning\/([^/]+)$/);
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
  if (path === "/teacher/imports") return <TeacherImports />;
  return null;
}
function TeacherImports() {
  const search = useSearchParams();
  return search.get("kind") === "members" ? (
    <>
      <PageHeader
        eyebrow="Import Center"
        title="导入中心"
        description="名单建档、预览去重、确认入班与导入结果分步进行。"
      />
      <div className="mt-5 flex gap-2">
        <Link
          className={buttonVariants({ variant: "secondary" })}
          href="/teacher/imports?kind=problems"
        >
          题目 / 测试
        </Link>
        <Link className={buttonVariants()} href="/teacher/imports?kind=members">
          班级成员
        </Link>
      </div>
      <IdentityImportWizard teacher showHeader={false} />
    </>
  ) : (
    <TeacherProblemImports />
  );
}
