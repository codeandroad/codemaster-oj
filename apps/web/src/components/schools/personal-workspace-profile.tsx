"use client";

import { ProfileEditor } from "@/components/profile-editor";
import { PublicPracticeProfileSharing } from "@/components/student/public-profile-sharing";
import type { CampusUser } from "@/lib/production-api";
import { RoleLabel, type SchoolRole } from "./school-ui";

export function PersonalWorkspaceProfile({
  user,
  onUserSaved,
  schoolRoles,
  publicPractice = false,
}: {
  user: CampusUser;
  onUserSaved: (user: CampusUser) => void;
  schoolRoles?: SchoolRole[];
  publicPractice?: boolean;
}) {
  return (<>
    <ProfileEditor
      user={user}
      personal
      publicLeaderboard={publicPractice}
      presenceEndpoint={publicPractice ? "practice/presence" : undefined}
      onSaved={onUserSaved}
      roleLabel={
        schoolRoles?.length
          ? schoolRoles.map((role, index) => (
              <span key={role}>
                {index > 0 && " · "}
                <RoleLabel role={role} />
              </span>
            ))
          : undefined
      }
    />
    {!publicPractice && schoolRoles?.includes("student") && <PublicPracticeProfileSharing key={user.id} accountId={user.id}/>}
  </>);
}
