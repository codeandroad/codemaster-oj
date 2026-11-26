"use client";

import { GuestbookSettings } from "../student/guestbook-settings";
import { PersonalAppearanceSettings } from "@/components/personal-appearance-settings";
import type { CampusUser } from "@/lib/production-api";
import { JoinedSchoolSettings } from "./joined-school-settings";
import { PersonalAccountSecurity } from "./personal-account-security";

export function PersonalWorkspaceSettings({
  user,
  onUserSaved,
  onSchoolsChanged,
}: {
  user: CampusUser;
  onUserSaved: (user: CampusUser) => void;
  onSchoolsChanged?: () => void;
}) {
  return (
    <div className="space-y-4">
      <PersonalAccountSecurity user={user} onSaved={onUserSaved} />
      <GuestbookSettings accountId={user.id}/>
      <PersonalAppearanceSettings />
      <JoinedSchoolSettings user={user} onSchoolsChanged={onSchoolsChanged} />
    </div>
  );
}
