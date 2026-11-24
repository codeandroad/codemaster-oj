"use client";

import { useState, type FormEvent } from "react";
import { Feedback, Loading, inputClass, useData, useMutation } from "@/components/admin/common";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SchoolClassPicker } from "./school-class-picker";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";
import { useCourseError, type CourseDetail, type SchoolAccessSettings } from "./school-courses-model";

export function SchoolAdmissionFields({schoolId, courseId, value, onChange}: {
  schoolId: string; courseId?: string; value: SchoolAccessSettings; onChange: (change: Partial<SchoolAccessSettings>) => void;
}) {
  const text = useSchoolText();
  const options = useData<{items: {id: string; title: string}[]}>(`schools/${schoolId}/courses?view=prerequisites`);
  const selected = value.prerequisiteCourseIds ?? [];
  return <fieldset className="space-y-3 rounded-md border border-border p-3">
    <legend className="px-1 text-sm font-semibold">{text("Course access", "课程准入")}</legend>
    <label className="grid gap-1 text-sm font-medium">{text("Audience", "学习对象")}
      <select className={inputClass} value={value.accessScope} onChange={event => onChange({accessScope: event.target.value as SchoolAccessSettings["accessScope"]})}>
        <option value="school">{text("All students in this school", "本校所有学生")}</option>
        <option value="classes">{text("Selected classes", "指定班级")}</option>
      </select>
    </label>
    {value.accessScope === "classes" && <SchoolClassPicker maxSelected={50} schoolId={schoolId} selected={value.classIds} onChange={classIds => onChange({classIds})}/>}
    <label className="grid gap-1 text-sm font-medium">{text("Minimum platform points", "最低平台积分")}
      <input className={inputClass} type="number" name="minimumPoints" min={0} max={1000000000} step={1}
        value={value.minimumPoints ?? 0} onChange={event => onChange({minimumPoints: Number(event.target.value)})}/>
    </label>
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{text("Prerequisite courses", "前置课程")}</legend>
      <p className="text-xs text-muted-foreground">{text("Students must finish all selected courses and reach the minimum points. No points are spent.", "学生须完成勾选课程的章节阅读和配套练习，并达到最低积分。积分只校验，不扣除。")}</p>
      <Loading resource={options}>{options.data && <div className="max-h-48 overflow-y-auto">
        {options.data.items.filter(item => item.id !== courseId).map(item => <label key={item.id} className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(item.id)} disabled={!selected.includes(item.id) && selected.length >= 20}
            onChange={event => onChange({prerequisiteCourseIds: event.target.checked ? [...selected,item.id] : selected.filter(id => id !== item.id)})}/>{item.title}
        </label>)}
        {selected.filter(id => !options.data?.items.some(item => item.id === id)).map(id => <label key={id} className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked onChange={() => onChange({prerequisiteCourseIds:selected.filter(item => item !== id)})}/>
          {text("Unavailable prerequisite", "已失效的前置课程")} · {id}
        </label>)}
        {!options.data.items.some(item => item.id !== courseId) && <p className="text-xs text-muted-foreground">{text("No other published courses in this school.", "本校暂无其他已发布课程。")}</p>}
      </div>}</Loading>
    </fieldset>
  </fieldset>;
}

export function SchoolAdmissionSettings({schoolId, courseId, onClose, onSaved}: {
  schoolId: string; courseId: string; onClose: () => void; onSaved: () => void;
}) {
  const text=useSchoolText();
  const course=useData<CourseDetail>(`schools/${schoolId}/courses/${courseId}`);
  const action=useMutation(), errorMessage=useCourseError(true);
  const [changes,setChanges]=useState<Partial<SchoolAccessSettings>>({});
  async function save(event: FormEvent) {
    event.preventDefault();
    if(!course.data || action.busy)return;
    const {accessScope,classIds,minimumPoints,prerequisiteCourseIds}={...course.data,...changes};
    await action.run(async () => {
      if(accessScope==="classes" && !classIds.length)throw new Error(text("Select at least one class.", "请至少选择一个班级。"));
      try {
        await productionApi(`schools/${schoolId}/courses/${courseId}/admission-settings`,{method:"PATCH",
          body:{expectedRevision:course.data!.revision,accessScope,classIds:accessScope==="classes"?classIds:[],minimumPoints,prerequisiteCourseIds}});
      } catch(error){throw errorMessage(error);}
      onSaved();
    });
  }
  return <Dialog open onOpenChange={open=>{if(!open && !action.busy)onClose();}}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogTitle>{text("Course access", "课程准入")}</DialogTitle>
      <DialogDescription>{course.data?.title} · {text("Settings take effect when you publish the draft.", "发布草稿后，准入设置对学生生效。")}</DialogDescription>
      <Feedback action={action}/><Loading resource={course}>{course.data && <form className="space-y-4" onSubmit={save}>
        <fieldset disabled={action.busy}><SchoolAdmissionFields schoolId={schoolId} courseId={courseId} value={{...course.data,...changes}}
          onChange={change=>setChanges(previous=>({...previous,...change}))}/></fieldset>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={action.busy} onClick={onClose}>{text("Cancel","取消")}</Button>
          <Button type="submit" disabled={action.busy}>{text("Save draft","保存草稿")}</Button></div>
      </form>}</Loading>
    </DialogContent>
  </Dialog>;
}
