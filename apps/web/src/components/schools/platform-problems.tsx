"use client";

import type { CampusUser } from "@/lib/production-api";
import { TeacherProblemEditor } from "@/components/teacher/problem-editor";
import type { ProblemEditorNavigation } from "@/components/teacher/problem-editor-navigation";
import { State, useData } from "@/components/teacher/shared";

/** Platform sources use the same complete editor as school problem authors. */
export function PlatformProblemEditor({ id, user, onClose, navigation }: {
  id: string; user?: CampusUser; onClose: () => void; navigation?: ProblemEditorNavigation;
}) {
  const auth = useData<{ user: CampusUser }>(user ? null : "auth/me");
  const currentUser = user ?? auth.data?.user;
  return <>
    {!user && <State resource={auth} />}
    {currentUser && <TeacherProblemEditor id={id} user={currentUser} scope="platform" onClose={onClose} navigation={navigation} />}
  </>;
}
