"use client";

import { ProfileEditor } from "@/components/profile-editor";
import type { CampusUser } from "@/lib/production-api";
import { RoleLabel, type SchoolRole } from "./school-ui";

export function PersonalWorkspaceProfile({
  user,
  onUserSaved,
  schoolRoles,
  publicLeaderboard,
}: {
  user: CampusUser;
  onUserSaved: (user: CampusUser) => void;
  schoolRoles?: SchoolRole[];
  publicLeaderboard?: boolean;
}) {
  return (
    <ProfileEditor
      user={user}
      personal
      publicLeaderboard={publicLeaderboard}
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
  );
}
