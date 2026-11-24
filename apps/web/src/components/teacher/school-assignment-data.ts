import type { SubmissionLanguage } from "@/lib/production-api";
import { schoolWorkspaceHref } from "../schools/school-workspace-location";
import type {
  ActivityOptions,
  ActivityReport,
  SchoolActivity,
} from "../schools/school-activities-model";
import type { TeacherAssignment } from "./dashboard-classes";

export type SchoolAssignmentOptions = ActivityOptions & {
  firstAcPoints: number;
  courses: {
    id: string;
    title: string;
    requiredLanguage: SubmissionLanguage | null;
    scope: "platform" | "school";
    problemIds: string[];
  }[];
};
export type ManagedActivity = SchoolActivity & {
  hasProblemRuns?: boolean;
  completedStudents?: number;
  subjectLabel: string;
  problemOrder: "course" | "custom";
  exemptCount: number;
  participantDetails?: TeacherAssignment["participantDetails"];
  protectedParticipantIds?: string[];
  requiredLanguage?: SubmissionLanguage | null;
};
export function teacherAssignment(a: ManagedActivity): TeacherAssignment {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    classId: a.classIds?.[0] ?? null,
    classIds: a.classIds,
    classNames: a.classNames,
    course: a.subjectLabel,
    coursePathId: a.courseId,
    courseTitle: a.courseTitle,
    courseAvailable: true,
    requiredLanguage: a.requiredLanguage,
    problemOrder: a.problemOrder,
    dueAt: a.endsAt ?? "",
    startsAt: a.startsAt,
    participants: a.identityIds ?? [],
    problems: a.problems.map((p) => ({
      ...p,
      problemId: p.id,
      rewardPoints: p.rewardPoints ?? 0,
    })),
    participantDetails: a.participantDetails,
    protectedParticipantIds: a.protectedParticipantIds,
    hasActivity: !!a.protectedParticipantIds?.length,
    hasSubmissions: a.hasProblemRuns,
    completedStudents: a.completedStudents,
    applicableCount: a.participantCount - a.exemptCount,
    exemptCount: a.exemptCount,
    canManage: a.canManage,
    cancelledAt: a.cancelledAt,
    editRevision: a.revision,
    state: a.state,
    archived: a.state === "Archived",
    published: !!a.publishedAt,
    publishedAt: a.publishedAt,
    phase: a.phase,
  };
}

export function assignmentHref(
  schoolId: string | undefined,
  id: string,
  view: "edit" | "progress" | "preview",
) {
  if (!schoolId) return `/teacher/assignments/${id}/${view}`;
  const base = schoolWorkspaceHref(schoolId, "assignments", "teacher");
  if (id === "new") return base + "&activityEdit=new";
  const key = {
    edit: "activityEdit",
    progress: "activityReport",
    preview: "activityPreview",
  }[view];
  return `${base}&activityId=${encodeURIComponent(id)}&${key}=1`;
}

export type AssignmentReport = Omit<ActivityReport, "activity"> & {
  activity: ManagedActivity;
};
export function teacherAssignmentReport(
  report: AssignmentReport,
): TeacherAssignment {
  return {
    ...teacherAssignment(report.activity),
    participantDetails: report.items.map((person) => ({
      identityId: person.id,
      name: person.name,
      number: person.number,
      exempt: person.exempt,
      dueAt: person.dueAt ?? "",
    })),
    grades: report.items
      .filter((person) => !person.exempt)
      .map(({ id, name, grade }) => ({
        identityId: id,
        name,
        score:
          grade.items.some((p) => p.awaitingScore) &&
          !grade.items.some(
            (p) => p.solved || (p.activityAttempts && !p.awaitingScore),
          )
            ? null
            : grade.score,
        maxScore: grade.total,
        problems: grade.items.map((cell) => ({
          problemId: cell.id,
          status: cell.matrixStatus ?? cell.status,
          submissionId: null,
          assignmentAttempts: cell.activityAttempts,
          completionSource: cell.inherited ? "other_entry" : null,
          score:
            !cell.awaitingScore && (cell.activityAttempts || cell.solved)
              ? (cell.score * 100) / cell.points
              : null,
        })),
      })),
  };
}
