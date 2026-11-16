"use client";

import { Loading } from "@/components/admin/common";
import { PreparationRouter } from "@/components/written-papers/preparation-router";
import { useWorkspaceData } from "@/components/workspace-data";
import type { School } from "@/components/schools/school-ui";
import type { CampusRole } from "@/lib/production-api";

export function LegacyExamPreparation({ role }: { role: CampusRole }) {
  const schools = useWorkspaceData<{ items: School[] }>("schools");
  const school = schools.data?.items.find(item => item.legacy);
  const availability = useWorkspaceData<{ enabled: boolean }>(
    school ? `schools/${school.id}/acsl${role === "student" ? "" : "/manage"}?view=availability` : "",
  );

  const directory = school ? <PreparationRouter schoolId={school.id} rootHref={`/${role}/exam-preparation`} staff={role !== "student"}
    paper4Href={role === "admin" ? undefined : `/${role}/paper4`}
    acslHref={availability.data?.enabled ? `/${role}/acsl` : undefined}/> : null;
  return <Loading resource={schools}>
    {<>
      {directory}
      <Loading resource={availability}>{null}</Loading>
    </>}
  </Loading>;
}
