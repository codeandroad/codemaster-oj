"use client";

import type { CampusUser } from "@/lib/production-api";
import { TeacherProblemEditor } from "@/components/teacher/problem-editor";
import type { ProblemEditorNavigation, ProblemEditorTab } from "@/components/teacher/problem-editor-navigation";
import { State, useData } from "@/components/teacher/shared";

/** Platform sources use the same complete editor as school problem authors. */
export function PlatformProblemEditor({ id, editorKey, user, onClose, closeLabel, navigation, initialTab, delegatedReview }: {
  id: string; editorKey?: string; user?: CampusUser; onClose: () => void; closeLabel?: string;
  navigation?: ProblemEditorNavigation; initialTab?: ProblemEditorTab; delegatedReview?: boolean;
}) {
  const auth = useData<{ user: CampusUser }>(user ? null : "auth/me");
  const currentUser = user ?? auth.data?.user;
  return <>
    {!user && <State resource={auth} />}
    {currentUser && <TeacherProblemEditor key={editorKey} id={id} user={currentUser} scope="platform" onClose={onClose} closeLabel={closeLabel} navigation={navigation} initialTab={initialTab} delegatedReview={delegatedReview} />}
  </>;
}
