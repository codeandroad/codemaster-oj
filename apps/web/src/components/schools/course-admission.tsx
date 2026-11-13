"use client";

import { useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Feedback, useMutation } from "@/components/admin/data-state";
import { courseSourceName } from "@/components/course-access";
import type { CourseLocalizations } from "@/components/course-localization";
import type { CourseSection } from "@/components/course-sections";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import { PlatformCourseAdmissionGate } from "./platform-course-admission-gate";
import type { LearnerAdmissionRule } from "./platform-course-admission-model";
import { useSchoolText } from "./school-ui";

export type PublicCourseEntry = {
  id: string;
  title: string;
  description: string;
  localizations?: CourseLocalizations;
  sections?: CourseSection[];
  chapterCount: number;
  completedChapters?: number;
  totalExercises?: number;
  completedExercises?: number;
  category?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  coverKey?: string;
  ownerScope?: "school" | "platform";
  sourceSchool?: string;
  revision: number;
  accessScope?: "school" | "classes";
  admission: "direct" | "apply" | "pending" | "rejected" | "invite" | "requirements" | "denied";
  admissionRules?: LearnerAdmissionRule[];
};

export function courseAdmissionLabel(admission: PublicCourseEntry["admission"], text: ReturnType<typeof useSchoolText>, chapterCount?: number) {
  const labels: Record<PublicCourseEntry["admission"], [string, string]> = {
    pending: ["Awaiting review", "待审核"],
    rejected: ["Application declined", "申请未通过"],
    apply: ["Application required", "需申请"],
    invite: ["Invitation required", "需邀请码"],
    requirements: ["Learning requirements not met", "尚未达到学习门槛"],
    denied: ["Not eligible", "不符合开放范围"],
    direct: ["Open for study", "可直接学习"],
  };
  const label = text(...labels[admission]);
  return chapterCount === undefined ? label : `${label} · ${text(`${chapterCount} chapters`, `${chapterCount} 章`)}`;
}

export function useCourseAdmissionDialog(detailHref: (id: string) => string, reload: () => void) {
  const router = useRouter();
  const action = useMutation();
  const [selected, setSelected] = useState<PublicCourseEntry | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const opening = useRef(false);

  async function openCourse(event: MouseEvent<HTMLButtonElement>, id: string) {
    if (opening.current) return;
    opening.current = true;
    trigger.current = event.currentTarget;
    await action.run(async () => {
      const entry = await productionApi<PublicCourseEntry>(`practice/courses/${encodeURIComponent(id)}/entry`);
      if (entry.admission === "direct") router.push(detailHref(id));
      else setSelected(entry);
    });
    opening.current = false;
  }

  return { busy: action.busy, openCourse, feedback: <Feedback action={action}/>,
    dialog: selected && <CourseAdmissionDialog entry={selected} onUpdated={entry => {
      if (entry.admission === "direct") {
        setSelected(null);
        router.push(detailHref(entry.id));
      } else setSelected(entry);
      reload();
    }} onClose={() => setSelected(null)} returnFocus={() => trigger.current?.focus()}/> };
}

type AdmissionDialogProps = {
  entry: PublicCourseEntry;
  onUpdated: (entry: PublicCourseEntry) => void;
  onClose: () => void;
  returnFocus?: () => void;
};
export function CourseAdmissionDialog(props: AdmissionDialogProps) {
  return props.entry.ownerScope === "platform" ? <PlatformCourseAdmissionGate {...props}/> : <SchoolCourseAdmissionDialog {...props}/>;
}

function SchoolCourseAdmissionDialog({ entry, onUpdated, onClose, returnFocus }: AdmissionDialogProps) {
  const text = useSchoolText();
  const action = useMutation();
  const submitting = useRef(false);
  const source = courseSourceName(entry);
  const description = entry.admission === "pending"
    ? text("The school is reviewing your application.", "学校正在审核你的申请。")
    : entry.admission === "rejected"
      ? text("The school declined your application for this course.", "学校未批准你加入这门课程。")
      : entry.accessScope === "classes"
        ? text("Students in the eligible classes can enter directly. You can apply to study this course.", "指定班级的学生可以直接进入。你可以申请加入这门课程。")
        : text("Students with school access can enter directly. You can apply to study this course.", "具备校内权限的学生可以直接进入。你可以申请加入这门课程。");

  async function apply() {
    if (submitting.current) return;
    submitting.current = true;
    await action.run(async () => {
      const updated = await productionApi<PublicCourseEntry>(`practice/courses/${encodeURIComponent(entry.id)}/applications`, {
        method: "POST",
        body: { expectedRevision: entry.revision },
      });
      onUpdated(updated);
    });
    submitting.current = false;
  }

  return <Dialog open onOpenChange={open => { if (!open && !action.busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => {
      if (!returnFocus) return;
      event.preventDefault();
      returnFocus();
    }}>
      <DialogTitle className="pr-7">{entry.title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      {entry.description && <p className="whitespace-pre-wrap break-words text-sm">{entry.description}</p>}
      {source && <p className="text-xs text-muted-foreground">{source}</p>}
      <Feedback action={action}/>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={action.busy}>{text("Close", "关闭")}</Button>
        {entry.admission === "apply" && <Button disabled={action.busy} onClick={() => void apply()}>{action.busy ? text("Submitting…", "正在提交…") : text("Apply to join", "申请加入")}</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
