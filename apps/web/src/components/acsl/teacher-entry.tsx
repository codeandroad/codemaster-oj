"use client";

import { Loading } from "@/components/admin/common";
import { useData } from "@/components/student/shared";
import type { School } from "@/components/schools/school-ui";
import type { CampusUser } from "@/lib/production-api";
import { AcslTeacherPage } from "./teacher-page";

export function LegacyAcslTeacherPage({
  user,
  baseHref = "/teacher/acsl",
}: {
  user: CampusUser;
  baseHref?: string;
}) {
  const schools = useData<{ items: School[] }>("schools");
  const school = schools.data?.items.find((item) => item.legacy);
  return (
    <Loading resource={schools}>
      {school && (
        <AcslTeacherPage
          key={`${school.id}:${user.id}`}
          schoolId={school.id}
          user={user}
          baseHref={baseHref}
        />
      )}
    </Loading>
  );
}
