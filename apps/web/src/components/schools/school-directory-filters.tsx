"use client";

import { inputClass, useData } from "@/components/admin/common";
import { useSchoolText } from "./school-ui";

export function useSchoolDirectoryOptions(schoolId: string, archived = false) {
  return useData<{classes:{id:string;name:string}[]; counts:Record<string,number>}>(
    `schools/${schoolId}/identities?view=filters&archived=${archived}`);
}

export function SchoolClassFilter({classes,value,onChange}: {
  classes: {id:string;name:string}[]; value: string; onChange: (id: string) => void;
}) {
  const t=useSchoolText();
  return <select aria-label={t("Filter by class","班级筛选")} className={inputClass + " !w-auto max-w-full"}
    value={value} onChange={e=>onChange(e.target.value)}>
    <option value="">{t("All classes","全部班级")}</option>
    {classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
  </select>;
}
