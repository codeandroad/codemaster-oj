"use client";

import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import { ProblemTutorialEditor } from "@/components/teacher/problem-tutorial-editor";
import { Button } from "@/components/ui/button";
import { ProblemEditorForm, type EditorProblem } from "@/components/teacher/problem-editor";
import type { ProblemEditorNavigation, ProblemEditorTab } from "@/components/teacher/problem-editor-navigation";
import { State, useData } from "@/components/teacher/shared";
import type { CampusUser } from "@/lib/production-api";
import type { Problem } from "./school-practice-types";
import { schoolEditorProblem } from "./school-problem-source";

export function SchoolProblemEditor({ id, schoolId, admin, bankId, close, closeLabel, navigation, initialTab, onCreated }: {
  id: string; schoolId: string; admin: boolean; bankId?: string; close: () => void; closeLabel?: string;
  navigation?: ProblemEditorNavigation; initialTab?: string | null; onCreated?: (id: string, tab?: ProblemEditorTab) => void;
}) {
  const { locale } = useLocale();
  const [tutorial, setTutorial] = useState({dirty:false,busy:false});
  const auth = useData<{user: CampusUser}>("auth/me");
  const resource = useData<Problem>(id === "new" ? null : `schools/${schoolId}/problems/${encodeURIComponent(id)}`);
  const initial: EditorProblem | null = resource.data?.canManage ? schoolEditorProblem(resource.data, admin) : null;
  if (!auth.data || (id !== "new" && !initial)) return <>
    <Button type="button" variant="ghost" disabled={tutorial.busy} onClick={() => {
      if (!tutorial.dirty || window.confirm(locale === "zh" ? "放弃未保存的教程修改并返回？" : "Discard tutorial changes and return?")) close();
    }}>{closeLabel ?? (locale === "zh" ? "返回题目列表" : "Back to problems")}</Button>
    <State resource={auth}/><State resource={resource}/>
    {resource.data?.canManageTutorial && initialTab === "tutorial" ? <ProblemTutorialEditor inline onEditStateChange={setTutorial} endpoint={`schools/${schoolId}/problems/${id}/tutorial`} problemTitle={resource.data.title}/> : resource.data && !resource.data.canManage && <p role="status">{locale === "zh" ? "此题目前不可编辑。" : "This problem is currently read-only."}</p>}
  </>;
  return <ProblemEditorForm key={id} initial={initial} user={auth.data.user} platform={false}
    school={{id:schoolId,admin,bankId,onCreated}} initialTab={initialTab ?? null} onClose={close} closeLabel={closeLabel} navigation={navigation}/>;
}
