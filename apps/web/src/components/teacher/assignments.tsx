"use client";

import { RowActionButton, rowActionClassName } from "@/components/ui/row-action";

import { AppLink as Link } from "@/components/navigation";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import {activityDate,validateActivity,activeParticipants} from "./activity-validation";
import {useActivityDraft} from "./use-activity-draft";
import { courseProblemOrder, savedProblemOrder } from "./assignment-problem-order";
import { StudentAudienceSelector } from "./student-audience-selector";
import { activityAudienceClassIds, type AudienceDirectory, type AudienceStudent } from "./student-audience";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { ScholarshipIcon } from "@/components/scholarship/scholarship-icon";
import { ActivityRewardFields, type RewardRule, type RuleResponse } from "@/components/scholarship/teaching-page";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { languageInfo, requiredLanguageText } from "@/components/student/languages";
import {
  productionApi,
  ApiError,
  type Assignment,
  type ProductionProblem,
  type SchoolClass,
  type Submission,
  type SubmissionLanguage,
} from "@/lib/production-api";
import { assignmentHref, teacherAssignment, teacherAssignmentReport, type AssignmentReport, type ManagedActivity, type SchoolAssignmentOptions } from "./school-assignment-data";
import { schoolClassApiPath, schoolWorkspaceHref } from "../schools/school-workspace-location";
import { ActivityAssistanceFields, defaultActivityAssistance, type ActivityRule } from "../schools/school-scholarship";
import { TeacherAssignment } from "./dashboard-classes";
import { ProblemPicker } from "./problem-banks";
import { AssignmentParticipantForm, CancelAssignment } from "./assignment-changes";
import { SchoolAssignmentProblemImport } from "../schools/platform-problem-import";
import { SchoolAssignmentSubmissions } from "./school-assignment-submissions";
import { AssignmentPreviewLink } from "./assignment-preview";
import {
  area,
  date,
  Drawer,
  Empty,
  Feedback,
  Field,
  input,
  link,
  localInput,
  Metric,
  Modal,
  move,
  panel,
  State,
  Table,
  useAction,
  useData,
  useDirty,
} from "./shared";

const ui = (locale: AppLocale, zh: string, en: string) => locale === "zh" ? zh : en;
const completionRewardInputId = "assignment-completion-scholarship";

function ScholarshipAmountInput({ ref, ...props }: ComponentProps<"input">) {
  return (
    <span className="relative inline-flex w-28">
      <ScholarshipIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
      <input ref={ref} type="number" min={0} step={1} className={`${input} pl-9 tabular-nums disabled:opacity-60`} {...props} />
    </span>
  );
}

const assignmentTabLabel: Record<string, [string, string]> = {
  "Basic information": ["基本信息", "Basic information"],
  Problems: ["题目与分值", "Problems"],
  "Applicable list": ["布置名单", "Recipients"],
  Rules: ["规则", "Rules"],
  Preview: ["学生预览", "Preview"],
};

export function SchoolTeacherAssignments({schoolId,userId,id,report}: {schoolId:string;userId:string;id:string|null;report:boolean}) {
  if (!id) return <TeacherAssignments schoolId={schoolId}/>;
  if (report && id !== "new") return <TeacherAssignmentProgress id={id} schoolId={schoolId}/>;
  return <TeacherAssignmentEditor id={id} schoolId={schoolId} userId={userId}/>;
}

export function TeacherAssignments({schoolId}: {schoolId?: string} = {}) {
  const { locale } = useLocale();
  const search=useSearchParams(), router=useRouter();
  const [legacyArchived,setLegacyArchived]=useState(false);
  const showArchived=schoolId ? search.get("activityArchived")==="1" : legacyArchived;
  const requestedPage=Number(search.get("activityPage") ?? 1);
  const page=schoolId && Number.isInteger(requestedPage) && requestedPage>=1 && requestedPage<=100000 ? requestedPage : 1;
  const showPage=(archived:boolean,next=1)=>{
    if (!schoolId) { setLegacyArchived(archived); return; }
    router.push(schoolWorkspaceHref(schoolId,"assignments","teacher")+(archived?"&activityArchived=1":"")+(next>1?`&activityPage=${next}`:""),{scroll:false});
  };
  const [confirm,setConfirm]=useState<TeacherAssignment|null>(null);
  const action=useAction();
  const schoolList = useData<{ items: ManagedActivity[]; hasMore:boolean }>(schoolId ? `schools/${schoolId}/activities?kind=assignment&view=assignment&archived=${showArchived}&page=${page}` : null);
  const legacy = useData<{ items: TeacherAssignment[] }>(schoolId ? null : showArchived?"assignments?archived=true":"assignments"),
    classes = useData<{ items: SchoolClass[] }>(schoolId ? null : "classes");
  const assignments = schoolId ? {...schoolList, data:schoolList.data && {items:schoolList.data.items.map(teacherAssignment)}} : legacy;
  const activityPath = (id: string) => schoolId ? `schools/${schoolId}/activities/${id}` : `assignments/${id}`;
  return (
    <>
      <PageHeader
        eyebrow={ui(locale, "作业管理", "Assignments")}
        title={ui(locale, "作业管理", "Assignment Management")}
        description={ui(locale, "跨班级管理作业，维护适用学生名单，并查看学习进度。", "Manage assignments across classes, select students, and view progress.")}
        action={
          <Link href={assignmentHref(schoolId,"new","edit")} className={buttonVariants()}>
            <Plus size={15} />
            {ui(locale, "新建作业", "New assignment")}
          </Link>
        }
      />
      <div className="mt-5 flex gap-2"><Button variant={showArchived?"secondary":"default"} aria-pressed={!showArchived} onClick={()=>showPage(false)}>{ui(locale,"使用中","Active")}</Button><Button variant={showArchived?"default":"secondary"} aria-pressed={showArchived} onClick={()=>showPage(true)}>{ui(locale,"已归档","Archived")}</Button></div>
      <State resource={assignments} />
      <Feedback action={action}/>
      <section className={`${panel} mt-4`}>
        <Table
          headers={[
            ui(locale, "作业", "Assignment"),
            ui(locale, "班级", "Class"),
            ui(locale, "已布置学生", "Assigned students"),
            ui(locale, "已豁免", "Exempt"),
            ui(locale, "状态", "Status"),
            ui(locale, "操作", "Actions"),
          ]}
        >
          {assignments.data?.items.map((item) => {
            const assigned = item.applicableCount ?? item.participants?.length ??
              item.participantDetails?.filter((person) => !person.exempt).length ?? 0;
            const exempt = item.exemptCount ??
              item.participantDetails?.filter((person) => person.exempt).length ?? 0;
            const allCompleted = assigned > 0 && (item.completedStudents ?? 0) >= assigned;
            const classSummary = item.classes?.map(group => group.name).join(" / ") || item.classNames?.join(" / ") || item.className || classes.data?.items.find(group => group.id === item.classId)?.name || ui(locale, "按学生名单", "Selected students");
            return <tr key={item.id}>
              <td>
                <Link
                  href={assignmentHref(schoolId,item.id,"edit")}
                  className={`${link} font-semibold`}
                >
                  {item.title}
                </Link>
                {allCompleted && <span className="ml-2 inline-flex rounded-full border border-success/25 bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">{ui(locale, "全部完成", "All completed")}</span>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {ui(locale, "截止", "Due")} {date(item.dueAt)}
                </p>
                {item.courseTitle && <p className="mt-1 text-xs text-muted-foreground">{ui(locale, "关联课程", "Course")}: {item.courseTitle}{!item.courseAvailable && ui(locale, "（已归档）", " (archived)")}</p>}
              </td>
              <td className="text-muted-foreground">
                {classSummary}
              </td>
              <td>
                <b>
                  {assigned}
                </b>
              </td>
              <td>
                {exempt}
              </td>
              <td>
                <StatusPill
                  status={
                    item.phase && schoolId ? ({Open:ui(locale,"进行中","Open"),Ended:ui(locale,"已截止","Ended"),Upcoming:ui(locale,"未开始","Upcoming"),Draft:ui(locale,"草稿","Draft"),Archived:ui(locale,"已归档","Archived"),Cancelled:ui(locale,"已取消","Cancelled")}[item.phase] ?? item.phase) : item.cancelledAt ? ui(locale, "已取消", "Cancelled") : item.state === "Draft"
                      ? ui(locale, "草稿", "Draft")
                      : allCompleted
                        ? ui(locale, "全部完成", "All completed")
                        : item.averagePercent === null || item.averagePercent === undefined
                          ? ui(locale, "未开始", "Not started")
                          : ui(locale, "进行中", "In progress")
                  }
                  tone={allCompleted ? "success" : item.averagePercent === null || item.averagePercent === undefined || item.cancelledAt || item.state === "Draft" ? undefined : "info"}
                />
              </td>
              <td>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={assignmentHref(schoolId,item.id,"edit")}
                    className={rowActionClassName}
                  >
                    {item.state === "Draft" ? ui(locale, "编辑", "Edit") : ui(locale, "查看 / 编辑", "View / edit")}
                  </Link>
                  <Link
                    href={assignmentHref(schoolId,item.id,"progress")}
                    className={rowActionClassName}
                  >
                    {ui(locale, "进度", "Progress")} →
                  </Link>
                  {!item.cancelledAt && <RowActionButton disabled={action.busy} onClick={()=>setConfirm(item)}>{showArchived?ui(locale,"恢复","Restore"):ui(locale,"归档","Archive")}</RowActionButton>}
                  {item.canManage && item.published && !item.archived && !allCompleted && <CancelAssignment path={activityPath(item.id)} title={item.title} onSaved={assignments.reload}/>}
                </div>
              </td>
            </tr>;
          })}
          {!assignments.loading && !assignments.data?.items.length && (
            <Empty columns={6}>{showArchived?ui(locale,"暂无已归档作业。","No archived assignments."):ui(locale, "暂无作业。点击“新建作业”开始布置。", "No assignments yet. Select New assignment to begin.")}</Empty>
          )}
        </Table>
      </section>
      {schoolId && (page > 1 || schoolList.data?.hasMore) && <nav className="mt-4 flex items-center justify-end gap-2" aria-label={ui(locale,"作业分页","Assignment pages")}>
        <Button variant="secondary" disabled={page === 1 || schoolList.loading} onClick={() => showPage(showArchived,page - 1)}>{ui(locale,"上一页","Previous")}</Button>
        <span>{page}</span>
        <Button variant="secondary" disabled={!schoolList.data?.hasMore || schoolList.loading} onClick={() => showPage(showArchived,page + 1)}>{ui(locale,"下一页","Next")}</Button>
      </nav>}
      {confirm&&<Modal title={showArchived?ui(locale,"恢复作业","Restore assignment"):ui(locale,"归档作业","Archive assignment")} onClose={()=>setConfirm(null)}>
        <p className="text-sm text-muted-foreground">{showArchived?ui(locale,`恢复「${confirm.title}」后，它会回到使用中列表。`,`Restore “${confirm.title}” to the active list.`):ui(locale,`归档「${confirm.title}」后，学生无法继续正式提交；已有成绩和提交记录保留。进行中的作业须等截止且判题完成。`,`Archive “${confirm.title}”? Existing grades and submissions remain available.`)}</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={()=>setConfirm(null)}>{ui(locale,"取消","Cancel")}</Button><Button disabled={action.busy} onClick={()=>void action.run(async()=>{await productionApi(`${activityPath(confirm.id)}/${showArchived?"restore":"archive"}`,{method:"POST",body:{}});setConfirm(null);assignments.reload();return showArchived?ui(locale,"作业已恢复。","Assignment restored."):ui(locale,"作业已归档。","Assignment archived.");})}>{showArchived?ui(locale,"恢复","Restore"):ui(locale,"归档","Archive")}</Button></div>
      </Modal>}
    </>
  );
}
interface SelectedProblem {
  problemId: string;
  title: string;
  points: number;
  firstAcPoints: number;
  rewardPoints: number;
  difficulty?: string | null;
  mode?: string;
  versionId?: string;
}
const getProblemVersion = (problemId: string, versionId: string) =>
  productionApi<ProductionProblem>(`problems/${encodeURIComponent(problemId)}?versionId=${encodeURIComponent(versionId)}`);

const assignmentTabs = [
  "Basic information",
  "Problems",
  "Applicable list",
  "Rules",
  "Preview",
];
export function TeacherAssignmentEditor({ id,userId,schoolId }: { id: string;userId:string;schoolId?:string }) {
  const original = useData<TeacherAssignment>(schoolId || id==="new" ? null : `assignments/${id}`);
  const current = useData<ManagedActivity>(schoolId && id!=="new" ? `schools/${schoolId}/activities/${id}?view=assignment` : null);
  const resource = schoolId ? {...current,data:current.data && teacherAssignment(current.data)} : original;
  return (
    <>
      <State resource={resource} />
      {(id === "new" || (!resource.loading && resource.data?.id === id)) && (
        <AssignmentEditorForm
          userId={userId} schoolId={schoolId}
          key={`${id}:${resource.data?.editRevision ?? 0}`}
          initial={id === "new" ? null : resource.data}
          onReload={resource.reload}
        />
      )}
    </>
  );
}
function AssignmentEditorForm({
  initial,userId,onReload,schoolId,
}: {
  userId:string; schoolId?:string;
  initial: TeacherAssignment | null;
  onReload: () => void;
}) {
  const { locale } = useLocale();
  const schoolBase = schoolId ? `schools/${schoolId}/activities` : "";
  const options = useData<SchoolAssignmentOptions>(schoolId ? schoolClassApiPath(schoolBase+"/options?view=assignment") : null);
  const requestId = useRef(crypto.randomUUID());
  const [startsAt,setStartsAt] = useState(localInput(initial?.startsAt ?? ""));
  const [rewardEdit, setRewardEdit] = useState<RewardRule | null>(null);
  const [assistanceEdit, setAssistanceEdit] = useState<ActivityRule["assistance"] | null>(null);
  const [rewardConflict, setRewardConflict] = useState(false);
  const rewardInput = useRef<HTMLInputElement>(null);
  const focusReward = useRef(false);
  const router = useRouter(),
    searchParams = useSearchParams(),
    legacyClasses = useData<{ items: SchoolClass[] }>(schoolId ? null : "classes"),
    legacyCourses = useData<{ items: { id: string; title: string; published: boolean; requiredLanguage?: SubmissionLanguage | null }[] }>(schoolId ? null : "learning-paths?purpose=assignment"),
    legacyAudience = useData<AudienceDirectory>(schoolId ? null : "teaching/audience"),
    [tab, setTab] = useState(searchParams.get("tab") === "problems" ? "Problems" : assignmentTabs[0]!),
    [saved, setSaved] = useState(initial),
    [title, setTitle] = useState(initial?.title ?? ""),
    [description, setDescription] = useState(initial?.description ?? ""),
    [course, setCourse] = useState(initial?.course ?? "Python"),
    [coursePathId, setCoursePathId] = useState(initial?.coursePathId ?? ""),
    [problemOrder, setProblemOrder] = useState<"course" | "custom">(initial?.problemOrder ?? "course"),
    [due, setDue] = useState(localInput(initial?.dueAt)),
    [selected, setSelected] = useState<SelectedProblem[]>(
      savedProblemOrder(initial?.problems ?? []).map((x) => ({
        ...x,
        title: x.title ?? "题目",
        firstAcPoints: x.firstAcPoints ?? 10,
        rewardPoints: x.rewardPoints ?? 0,
        difficulty: x.difficulty ?? null,
      })),
    ),
    [participants, setParticipants] = useState(
      initial?.participantDetails
        ?.filter((x) => !x.exempt)
        .map((x) => x.identityId) ??
        initial?.participants ??
        [],
    ),
    [picker, setPicker] = useState(false),
    [importing, setImporting] = useState(false),
    [publish, setPublish] = useState(false),
    [confirmUpdate, setConfirmUpdate] = useState(false),
    [stale, setStale] = useState(false),
    action = useAction();
  const classes = schoolId ? {...options,data:options.data && {items:options.data.classes}} : legacyClasses;
  const courses = schoolId ? {...options,data:options.data && {items:options.data.courses.map(c=>({...c,published:true}))}} : legacyCourses;
  const audience = schoolId ? {...options,data:options.data && {items:options.data.students,classes:options.data.classes.map(c=>({...c,canAssociate:true}))}} : legacyAudience;
  const schoolRule = useData<ActivityRule>(schoolId && saved ? `schools/${schoolId}/scholarship/activity-rule?activityId=${saved.id}` : null);
  const legacyRule = useData<RuleResponse>(schoolId ? null : `scholarship/reward-rules?activityType=assignment${saved ? `&activityId=${encodeURIComponent(saved.id)}` : ""}`);
  const rewardResource = schoolId ? { ...schoolRule,loading:schoolRule.loading||options.loading,error:schoolRule.error||options.error,
    data:options.data && (!saved || schoolRule.data) ? {cap:options.data.activityRewardCap,canManage:true,frozen:!!saved?.published,
      rule:{amount:schoolRule.data?.amount??0,minimumAc:schoolRule.data?.minimumAc??1,minimumScore:schoolRule.data?.minimumScore??0,
        requireAll:schoolRule.data?.requireAll??true,taskKind:(schoolRule.data?.taskKind??"challenge") as RewardRule["taskKind"],
        allowSolutionAssisted:schoolRule.data?.allowSolutionAssisted??false,version:schoolRule.data?.revision??0}} : null,
    reload:()=>{schoolRule.reload();options.reload();},
  } : legacyRule;
  const legacyOutline = useData<{ id: string; requiredLanguage?: SubmissionLanguage | null; chapters: { problems: { problemId: string }[] }[] }>(!schoolId && coursePathId ? `learning-paths/${coursePathId}?purpose=assignment` : null);
  const linked = options.data?.courses.find(c=>c.id===coursePathId);
  const linkedPlatformIds = new Set(linked?.scope === "platform" ? linked.problemIds : []);
  const pickerProblems = options.data && [
    ...options.data.problems,
    ...(options.data.platformProblems ?? []).filter(p => linkedPlatformIds.has(p.problemId)),
  ];
  const courseOutline = schoolId ? {...options,data:linked && {...linked, chapters:[{problems:linked.problemIds.map(problemId=>({problemId}))}]}} : legacyOutline;
  const needsCourseOrder = problemOrder === "course" && Boolean(coursePathId) && (!schoolId || !!linked || options.loading);
  const matchingCourseOutline = courseOutline.data?.id === coursePathId;
  const courseOrderReady = !needsCourseOrder ||
    (matchingCourseOutline && !courseOutline.loading && !courseOutline.error);
  const courseOrderState = {
    ...courseOutline,
    loading: courseOutline.loading || (!matchingCourseOutline && !courseOutline.error),
  };
  const courseProblemIds = matchingCourseOutline
    ? courseOutline.data!.chapters.flatMap(chapter => chapter.problems.map(problem => problem.problemId)) : [];
  const orderedSelected = !courseOrderReady ? [] : needsCourseOrder
    ? courseProblemOrder(selected, courseProblemIds, item => item.problemId) : selected;
  const published = saved?.state !== "Draft" && Boolean(saved),
    hasActivity = Boolean(saved?.hasActivity || saved?.hasSubmissions),
    hasSubmissions = Boolean(saved?.hasSubmissions || saved?.grades?.some(
      (grade) => grade.problems.some((problem) => problem.submissionId),
    )),
    protectedStudentIds = new Set(
      saved?.protectedParticipantIds ??
        saved?.participantDetails?.filter((person) => person.hasActivity)
          .map((person) => person.identityId) ??
          saved?.grades?.filter((grade) =>
          grade.problems.some((problem) => problem.submissionId),
        ).map((grade) => grade.identityId) ?? [],
    ),
    exemptStudentIds = new Set(
      saved?.participantDetails?.filter((person) => person.exempt)
        .map((person) => person.identityId) ?? [],
    ),
    canEditProblems = !published || !hasSubmissions;
  const requiredLanguage = published ? saved?.requiredLanguage
    : matchingCourseOutline ? courseOutline.data?.requiredLanguage
    : courses.data?.items.find(item => item.id === coursePathId)?.requiredLanguage;
  const languageRequirement = requiredLanguage ? published ? requiredLanguageText(locale, requiredLanguage, "assignment")
    : ui(locale, `发布后，本作业只接受 ${languageInfo[requiredLanguage].name}。`, `This assignment will require ${languageInfo[requiredLanguage].name} once published.`) : null;
  const directory = audience.data?.items ?? [];
  const students: AudienceStudent[] = [...directory, ...(saved?.participantDetails ?? []).filter(person => !directory.some(student => student.id === person.identityId)).map(person => ({ id: person.identityId, name: person.name, number: "", historical: true }))];
  const audienceClasses = audience.data?.classes ?? classes.data?.items ?? [];
  const classIds = audience.data ? activityAudienceClassIds(directory, participants, audience.data.classes.filter(item => item.canAssociate).map(item => item.id), saved ? saved.classIds ?? (saved.classId ? [saved.classId] : []) : undefined, activeParticipants(saved?.participantDetails, saved?.participants ?? [])) : saved?.classIds ?? (saved?.classId ? [saved.classId] : []);
  const classId = classIds[0] ?? "";
  const classSummary = classIds.map(id => (audienceClasses.find(item => item.id === id)?.name ?? saved?.classes?.find(item => item.id === id)?.name)).filter(Boolean).join(" / ") || ui(locale, "按学生名单布置", "Selected students");
  const lockedIds = published && !saved?.protectedParticipantIds ? new Set(activeParticipants(saved?.participantDetails, saved?.participants ?? [])) : protectedStudentIds;

  const total = selected.reduce((sum, x) => sum + x.points, 0);
  const rewardTotal = selected.reduce((sum, x) => sum + x.rewardPoints, 0);
  const rewardReady = Boolean(rewardResource.data && !rewardResource.loading && !rewardResource.error);
  const storedReward = rewardResource.data?.rule;
  const baseReward = storedReward && !published && storedReward.version === 0
    ? { ...storedReward, requireAll: true }
    : storedReward;
  const completionReward = published ? baseReward : rewardEdit ?? baseReward;
  const completionLabel = ui(locale, "按时完成奖学金", "On-time completion scholarship");
  const perProblemLabel = ui(locale, "单题奖学金", "Per-problem scholarship");
  const rewardUnit = ui(locale, "奖学金", "Scholarship");
  const setRewardLabel = ui(locale, "设置按时完成奖学金", "Set on-time completion scholarship");
  const rewardCap = rewardResource.data?.cap;
  const rewardChanged = (value: RewardRule | null) =>
    !published && value !== null && JSON.stringify(value) !== JSON.stringify(baseReward);
  const originalAssistance = schoolRule.data?.assistance ?? defaultActivityAssistance;
  const assistanceChanged = (value: ActivityRule["assistance"] | null) => !!schoolId && !published && value!==null && JSON.stringify(value)!==JSON.stringify(originalAssistance);
  const changedAssistance = assistanceChanged(assistanceEdit);
  const changedReward = rewardEdit !== null && rewardChanged(rewardEdit);
  const rewardAmountInvalid = changedReward && rewardCap !== undefined &&
    (!Number.isInteger(rewardEdit.amount) || rewardEdit.amount < 0 || rewardEdit.amount > rewardCap);
  const rewardAmountError = ui(locale, `请输入 0–${rewardCap} 的整数。`, `Enter a whole number from 0 to ${rewardCap}.`);
  const rewardCondition = completionReward && (completionReward.requireAll
    ? ui(locale, "通过本作业全部题目，以截止前收到的正式提交为准。", "Pass every problem using formal submissions received in this assignment by the deadline.")
    : ui(locale, `在截止前至少通过 ${completionReward.minimumAc} 题，且得分达到 ${completionReward.minimumScore}%。`,
      `Pass at least ${completionReward.minimumAc} problems and score ${completionReward.minimumScore}% or more by the deadline.`));
  const rewardLocked = published || Boolean(rewardResource.data?.frozen || rewardResource.data?.canManage === false);
  const showCompletionReward = () => {
    focusReward.current = true;
    setTab("Basic information");
  };
  useEffect(() => {
    if (tab === "Basic information" && focusReward.current && rewardInput.current && !rewardInput.current.disabled) {
      rewardInput.current.focus();
      focusReward.current = false;
    }
  }, [tab, rewardReady]);
  const problemEditorHref = (problem: SelectedProblem) => {
    if (schoolId) return schoolWorkspaceHref(schoolId,"problems","teacher")+`&problemId=${encodeURIComponent(problem.problemId)}&problemEdit=1`;

    const query = new URLSearchParams({
      returnTo: saved
        ? `/teacher/assignments/${saved.id}/edit`
        : "/teacher/assignments/new/edit",
    });
    return `/teacher/problems/${problem.problemId}/edit?${query.toString()}`;
  };
  const snapshot = { title, startsAt, description, course, coursePathId, problemOrder, due, problems: selected, participants, rewardEdit, assistanceEdit };
  const savedProblems = savedProblemOrder(saved?.problems ?? []);
  const savedParticipants = activeParticipants(saved?.participantDetails, saved?.participants ?? []);
  const problemEdits = (problems: typeof savedProblems) => JSON.stringify(
    problems.map(({ problemId, points, rewardPoints }) => ({
      problemId, points, rewardPoints: rewardPoints ?? 0,
    })),
  );
  const changesFor = (value: typeof snapshot) => ({
    changedStart: !!schoolId && value.startsAt!==localInput(saved?.startsAt??""),
    changedTitle: value.title.trim() !== (saved?.title ?? "").trim(),
    changedDescription: value.description.trim() !== (saved?.description ?? "").trim(),
    changedCourse: value.course.trim() !== (saved?.course ?? "Python").trim(),
    changedCoursePath: value.coursePathId !== (saved?.coursePathId ?? ""),
    changedProblemOrder: value.problemOrder !== (saved?.problemOrder ?? "course"),
    changedDue: value.due !== localInput(saved?.dueAt),
    changedProblems: problemEdits(value.problems) !== problemEdits(savedProblems),
    changedParticipants: JSON.stringify([...value.participants].sort()) !== JSON.stringify([...savedParticipants].sort()),
    changedReward: rewardChanged(value.rewardEdit),
    changedAssistance:assistanceChanged(value.assistanceEdit),
  });
  const changes = changesFor(snapshot);
  const {
    changedTitle, changedDescription, changedCourse, changedCoursePath, changedProblemOrder,
    changedDue, changedProblems, changedParticipants,
  } = changes;
  const draft = useActivityDraft({
    storageKey: `campus-judge:activity-draft:v1:${userId}:${schoolId ? schoolId+":" : ""}assignment:${initial?.id ?? "new"}`,
    editable: !saved?.archived,
    published,
    snapshot,
    hasChanges: value => Object.values(changesFor(value)).some(Boolean),
    recoveryDefaults: { startsAt:localInput(saved?.startsAt??""),coursePathId: "", problemOrder: "course", rewardEdit: null, assistanceEdit:null },
    onRestore: (value) => {
      setTitle(value.title);
      setStartsAt(value.startsAt??"");
      setDescription(value.description);
      setCourse(value.course);
      setCoursePathId(value.coursePathId ?? "");
      setProblemOrder(value.problemOrder === "custom" ? "custom" : "course");
      setDue(value.due);
      const restored = value.problems.map((problem) => {
        const original = initial?.problems.find((item) => item.problemId === problem.problemId);
        const recoveredDifficulty = typeof problem.difficulty === "string" || problem.difficulty === null
          ? problem.difficulty
          : undefined;
        return {
          ...problem,
          firstAcPoints: original?.firstAcPoints ?? problem.firstAcPoints ?? 10,
          rewardPoints: problem.rewardPoints ?? original?.rewardPoints ?? 0,
          difficulty: original && original.versionId === problem.versionId
            ? original.difficulty ?? null
            : recoveredDifficulty,
        };
      });
      setSelected(restored);
      // Browser drafts saved before this column have a version ID but no difficulty.
      for (const { problemId, versionId, difficulty } of restored) {
        if (schoolId || difficulty !== undefined || typeof versionId !== "string" || !versionId) continue;
        void getProblemVersion(problemId, versionId).then(
          (version) => setSelected((current) => current.map((item) =>
            item.problemId === problemId && item.versionId === versionId && item.difficulty === undefined
              ? { ...item, difficulty: version.difficulty ?? null }
              : item,
          )),
          () => {},
        );
      }
      setParticipants(value.participants);
      if (!published) { setRewardEdit(value.rewardEdit); setAssistanceEdit(value.assistanceEdit); }
    },
  });
  const changedClass = JSON.stringify([...classIds].sort()) !== JSON.stringify([...(saved?.classIds ?? (saved?.classId ? [saved.classId] : []))].sort());
  const hasChanges = changedClass || Object.values(changes).some(Boolean);
  useDirty(hasChanges);
  const save = async (assign = false) => {
    if (saved?.archived) throw new Error(ui(locale,"作业已归档。","Assignment archived."));
    if (published && !hasChanges)
      throw new Error("没有需要保存的修改。");
    validateActivity({title,classId,problems:selected,participants,publish:assign,...(schoolId && {problemLimit:100,studentLimit:2000})});
    if ((assign || changedReward) && (!rewardReady || !baseReward || rewardConflict))
      throw new Error(ui(locale, "请先重新加载完成奖学金规则。", "Reload the completion scholarship rule before continuing."));
    if (rewardAmountInvalid) throw new Error(rewardAmountError);
    if (published && !selected.length)
      throw new Error("已发布作业须保留至少一道题目。");
    if (published && !participants.length && (saved?.participants?.length ?? 0) > 0)
      throw new Error("已发布作业须保留至少一名适用学生；需豁免时请到进度页操作。");
    const previouslyAssigned = new Set(activeParticipants(
      saved?.participantDetails,
      saved?.participants ?? [],
    ));
    if (published && changedParticipants && [...protectedStudentIds].some((identityId) =>
      previouslyAssigned.has(identityId) && !participants.includes(identityId),
    ))
      throw new Error("有运行或提交记录的学生不能移出作业，请在进度页使用豁免操作。");
    if (published && participants.some((identityId) => exemptStudentIds.has(identityId)))
      throw new Error("恢复已豁免学生请在作业进度页操作。");
    if (published && hasSubmissions && changedProblems)
      throw new Error("已有正式提交，题目、分值、顺序和单题奖学金不能修改。可修改说明、截止时间或适用学生。");
    const dueAt=schoolId && !due ? null : activityDate(due,'截止时间');
    if (assign && Date.parse(dueAt ?? "") <= Date.now())
      throw new Error(ui(locale, "发布前请设置晚于当前时间的截止时间。", "Choose a future deadline before assigning."));
    if (published && changedParticipants && Date.parse(dueAt ?? "") <= Date.now())
      throw new Error("作业已截止。调整学生名单前，请先将截止时间延至未来。");
    if (published && changedDue) {
      if (Date.parse(dueAt ?? "") <= Date.parse(saved!.dueAt))
        throw new Error("已发布作业只能延长截止时间，不能提前截止。");
      if (Date.parse(dueAt ?? "") <= Date.now())
        throw new Error("新的截止时间须晚于当前时间。");
    }
    if (published && saved?.editRevision === undefined)
      throw new Error("作业版本信息缺失，请重新加载后再修改。");
    const problemPayload = selected.map((problem) => ({
      problemId: problem.problemId,
      points: problem.points,
      rewardPoints: problem.rewardPoints,
      ...(published && problem.versionId ? { versionId: problem.versionId } : {}),
    }));
    const body = published
      ? {
          expectedRevision: saved?.editRevision,
          ...(changedTitle ? { title } : {}),
          ...(changedDescription ? { description } : {}),
          ...(changedCourse ? { course } : {}),
          ...(changedCoursePath ? { coursePathId: coursePathId || null } : {}),
          ...(changedProblemOrder ? { problemOrder } : {}),
          ...(changedDue ? { dueAt } : {}),
          ...(changedProblems ? { problems: problemPayload } : {}),
          ...(changedParticipants ? { participants } : {}),
          ...(changedClass ? { classIds, classId: classIds[0] ?? null } : {}),
        }
      : {
          state: "Draft",
          ...(saved?.editRevision !== undefined
            ? { expectedRevision: saved.editRevision }
            : {}),
          title,
          classIds,
          classId: classIds[0] ?? null,
          dueAt,
          description,
          course,
          coursePathId: coursePathId || null,
          problemOrder,
          problems: problemPayload,
          participants,
          ...(changedReward
            ? { completionReward: { ...rewardEdit, expectedVersion: rewardEdit.version } }
            : assign ? { expectedCompletionRewardVersion: baseReward?.version } : {}),
        };
    const endpoint = saved ? `assignments/${saved.id}${assign ? "/publish" : ""}` : "assignments";
    let result: TeacherAssignment & { completionReward?: RuleResponse };
    try {
      if (schoolId) {
        const problems=selected.map(p=>({problemId:p.problemId,versionId:p.versionId,points:p.points,rewardPoints:p.rewardPoints}));
        const metadata={ subjectLabel:course,courseId:coursePathId || null,problemOrder };
        const payload=published ? {expectedRevision:saved?.editRevision,title,description,...metadata,
          ...(changedDue && {endsAt:dueAt}),...(changedProblems && {problems}),...(changedParticipants && {identityIds:participants,classIds})}
          : {kind:"assignment",title,description,...metadata,problems,identityIds:participants,classIds,audienceMode:"selected",
            startsAt:startsAt ? activityDate(startsAt,"开放时间") : null,endsAt:dueAt,requestId:requestId.current,expectedRevision:saved?.editRevision,
            ...((changedReward || changedAssistance) && completionReward && {scholarshipRule:{...completionReward,expectedRevision:completionReward.version,...(changedAssistance && {assistance:assistanceEdit})}})};
        const path=saved ? `${schoolBase}/${saved.id}${published?"/manage":""}` : schoolBase;
        let value=await productionApi<ManagedActivity>(schoolClassApiPath(path),{method:saved?"PATCH":"POST",body:payload});
        result=teacherAssignment(value);
        setSaved(result);
        draft.clear();
        if (assign) {
          try {
            value=await productionApi<ManagedActivity>(schoolClassApiPath(`${schoolBase}/${value.id}/publish`),{method:"POST",body:{
              expectedRevision:value.revision,expectedRuleRevision:(baseReward?.version??0)+((changedReward || changedAssistance)?1:0)}});
          } catch (error) {
            setRewardEdit(null); setAssistanceEdit(null); schoolRule.reload(); setPublish(false);
            if (!initial) router.replace(assignmentHref(schoolId,value.id,"edit"));
            throw error;
          }
          result=teacherAssignment(value);
        }
        schoolRule.reload();
        if (initial && !assign) onReload();
      } else {
      result = await productionApi<typeof result>(endpoint, {
        method: saved && !assign ? "PATCH" : "POST",
        body,
      });
      if (assign && !saved) {
        // Keep the new draft ID so a publication failure can be retried on the same assignment.
        draft.clear();
        setSaved(result);
        setRewardEdit(null);
        if (result.completionReward) legacyRule.setData(result.completionReward);
        result = await productionApi<typeof result>(`assignments/${result.id}/publish`, {
          method: "POST",
          body: {
            expectedRevision: result.editRevision,
            expectedCompletionRewardVersion: result.completionReward?.rule.version,
          },
        });
      }
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "REVISION_CONFLICT" || error.code === "ASSIGNMENT_REVISION_CONFLICT" || error.code === "PUBLISHED_ASSIGNMENT") {
          setStale(true);
          setPublish(false);
        }
        if (error.code === "RULE_FROZEN" || error.code === "LUQ_RULE_CONFLICT" || error.code === "LUQ_RULE_FROZEN") {
          setRewardConflict(true);
          setPublish(false);
          showCompletionReward();
        }
      }
      throw error;
    }
    draft.clear();
    setSaved(result);
    if (result.completionReward) legacyRule.setData(result.completionReward);
    setRewardEdit(null);
    setAssistanceEdit(null);
    setProblemOrder(result.problemOrder ?? "course");
    setSelected(savedProblemOrder(result.problems).map((problem) => ({
      ...problem,
      title: problem.title ?? selected.find((item) => item.problemId === problem.problemId)?.title ?? "题目",
      firstAcPoints: problem.firstAcPoints ?? selected.find((item) => item.problemId === problem.problemId)?.firstAcPoints ?? 10,
      rewardPoints: problem.rewardPoints ?? selected.find((item) => item.problemId === problem.problemId)?.rewardPoints ?? 0,
      difficulty: problem.difficulty ?? null,
      mode: selected.find((item) => item.problemId === problem.problemId)?.mode,
    })));
    if (!initial && !assign) router.replace(assignmentHref(schoolId,result.id,"edit"));
    return result;
  };
  const rewardSummary = (
    <dl className="mt-3 space-y-1 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <dt>{ui(locale, "单题奖学金合计", "Total per-problem scholarships")}</dt>
        <dd className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
          <ScholarshipIcon size={16} />
          {rewardTotal}
          <span className="sr-only">{rewardUnit}</span>
        </dd>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <dt>{completionLabel}</dt>
        <dd className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
          <ScholarshipIcon size={16} />
          {rewardReady ? completionReward?.amount : "—"}
          <span className="sr-only">{rewardUnit}</span>
        </dd>
      </div>
    </dl>
  );
  return (
    <>
      <PageHeader
        eyebrow="作业编辑"
        title={saved?.title ?? ui(locale, "新建作业", "New assignment")}
        description={ui(locale, "基本信息、题目与分值、指定学生名单、规则与学生预览。", "Basic information, problems and scores, selected students, rules, and student preview.")}
        action={
          <div className="flex flex-wrap gap-2">
            {schoolId && <Link className={buttonVariants({variant:"secondary"})} href={schoolWorkspaceHref(schoolId,"assignments","teacher")}>{ui(locale,"返回作业列表","Back to assignments")}</Link>}
            {saved?.canManage && !saved.archived && saved.problems.length > 0 && <AssignmentPreviewLink id={saved.id} from="edit" schoolId={schoolId}/>}
            <Button
              variant="secondary"
              disabled={saved?.archived || action.busy || (schoolId && (!options.data || !rewardReady || !courseOrderReady)) || (published ? !hasChanges : stale)}
              onClick={() => {
                if (published) {
                  setConfirmUpdate(true);
                  return;
                }
                void action.run(async () => {
                  await save();
                  return ui(locale, "作业草稿已保存。", "Assignment draft saved.");
                });
              }}
            >
              {published ? ui(locale, "保存修改", "Save changes") : ui(locale, "保存草稿", "Save draft")}
            </Button>
            {published ? (
              <Link
                href={assignmentHref(schoolId,saved!.id,"progress")}
                className={buttonVariants({ variant: "secondary" })}
              >
                {ui(locale, "查看进度", "View progress")}
              </Link>
            ) : (
              <Button
                disabled={action.busy || stale || !courseOrderReady || !rewardReady}
                onClick={() => setPublish(true)}
              >
                <Send size={15} />
                {ui(locale, "布置作业", "Assign work")}
              </Button>
            )}
          </div>
        }
      />
      <Feedback action={action} />
      {draft.notice}
      {!published && stale && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <p>{ui(locale, "作业已更新。请重新加载后核对。", "The assignment changed. Reload it to review the current version.")}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => {
            if (!initial && saved) router.replace(assignmentHref(schoolId,saved.id,"edit"));
            else onReload();
          }}>{ui(locale, "重新加载作业", "Reload assignment")}</Button>
        </div>
      )}
      {saved?.archived && <p className="mt-3 text-sm">{ui(locale,"这份作业已归档，可查看原有设置和成绩。","This archived assignment is read-only.")}</p>}
      {published && !saved?.archived && (
        <p className="mt-3 border border-info-soft bg-info-soft p-3 text-sm">
          {ui(locale, "作业已布置。可以修改标题、说明、截止时间和指定学生；截止时间只能延后。", "This work is assigned. You can update the title, description, selected students, and extend the deadline.")}
          {hasSubmissions
            ? ui(locale, "已有判题记录，题目、分值、顺序和单题奖学金已固定。", "Recorded runs lock the problems, marks, order, and per-problem scholarships.")
            : ui(locale, "尚无判题记录，可以调整题目、分值、顺序和单题奖学金。", "Before the first recorded run, you can edit the problems, marks, order, and per-problem scholarships.")}
          {ui(locale, "题目内容与题解跟随题库更新，审核发布后自动同步；历史提交和成绩保留。", "Problem content and solutions follow the problem bank after publication and review. Historical submissions and grades are retained.")}
          {hasActivity && ui(locale, "有记录的学生不能从名单中移除。", "Students with activity records cannot be removed.")}
          <Link
            className={`${link} ml-2`}
            href={assignmentHref(schoolId,saved!.id,"progress")}
          >
            管理单人延期与豁免
          </Link>
        </p>
      )}
      <section className={`${panel} mt-5 overflow-hidden`}>
        <div role="tablist" aria-label={ui(locale,"作业编辑","Assignment editor")} className="flex gap-1 overflow-x-auto border-b border-border bg-surface-subtle px-3 pt-3">
          {assignmentTabs.map((item) => (
            <button
              key={item} type="button" role="tab" aria-selected={tab===item}
              onClick={() => setTab(item)}
              className={`h-10 shrink-0 rounded-t-md border-x border-t px-4 text-sm font-semibold ${tab === item ? "border-border bg-surface text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`}
            >
              {assignmentTabLabel[item] ? ui(locale, ...assignmentTabLabel[item]!) : item}
            </button>
          ))}
        </div>
        <fieldset disabled={saved?.archived} className="min-h-[520px] min-w-0 p-5">
          {tab === "Basic information" && (
            <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
              <Field label={ui(locale, "标题", "Title")}>
                <input
                  required
                  value={title}
                  disabled={action.busy}
                  onChange={(e) => setTitle(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label={ui(locale, "学科标签", "Subject label")}>
                <input
                  value={course}
                  disabled={action.busy}
                  onChange={(e) => setCourse(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label={ui(locale, "关联课程（可选）", "Linked course (optional)")}>
                <select value={coursePathId} disabled={action.busy || courses.loading} onChange={(e) => setCoursePathId(e.target.value)} className={input} aria-describedby="assignment-course-policy">
                  <option value="">{ui(locale, "不关联课程", "No linked course")}</option>
                  {initial?.coursePathId && !courses.data?.items.some((item) => item.id === initial.coursePathId && item.published) && <option value={initial.coursePathId} disabled>{initial.courseTitle ?? ui(locale, "原关联课程", "Previous course")}{ui(locale, "（当前不可用）", " (unavailable)")}</option>}
                  {courses.data?.items.filter((item) => item.published).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
                <p id="assignment-course-policy" className="mt-1 text-xs text-muted-foreground">{ui(locale, "可关联已发布的校内课程和获授权的平台课程。有课程访问权限的学生可从作业打开课程。", "Link a published school course or a platform course you are authorized to use. Students with course access can open it from the assignment.")}</p>
                {courses.error && <p role="alert" className="mt-1 text-xs text-destructive">{courses.error}</p>}
                {languageRequirement && <p className="mt-1 text-xs font-semibold">{languageRequirement}</p>}
              </Field>
              <Field label={ui(locale, "布置学生", "Recipients")}>
                <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-input bg-surface-subtle px-3 text-sm"><span>{ui(locale, `已选择 ${participants.length} 名学生`, `${participants.length} students selected`)}</span><Button type="button" size="sm" variant="ghost" onClick={() => setTab("Applicable list")}>{ui(locale, "选择学生", "Choose students")}</Button></div>
              </Field>
              <Field label={ui(locale, "截止时间", "Due time")}>
                <input
                  required={!schoolId}
                  type="datetime-local"
                  min={published ? localInput(saved?.dueAt) : undefined}
                  disabled={action.busy}
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className={input}
                />
                {published && (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    已发布作业仅可延期；原截止时间 {date(saved?.dueAt)}。
                  </span>
                )}
              </Field>
              <div>
                <Field label={completionLabel}>
                  <ScholarshipAmountInput
                    id={completionRewardInputId}
                    ref={rewardInput}
                    max={rewardCap}
                    value={rewardReady ? completionReward?.amount ?? "" : ""}
                    disabled={!rewardReady || rewardLocked || action.busy || rewardConflict}
                    aria-describedby="assignment-completion-scholarship-help"
                    aria-invalid={rewardAmountInvalid || undefined}
                    onChange={(event) => {
                      if (completionReward) setRewardEdit({ ...completionReward, amount: Number(event.target.value) });
                    }}
                  />
                </Field>
                <p id="assignment-completion-scholarship-help" className={`mt-2 text-xs ${rewardAmountInvalid ? "text-destructive" : "text-muted-foreground"}`}>
                  {rewardReady && (rewardAmountInvalid ? rewardAmountError : <>
                    {(!rewardLocked || Boolean(completionReward?.amount)) && <>{rewardCondition}{" "}</>}
                    {rewardLocked
                      ? ui(locale, "布置后，此奖学金规则已锁定。", "This scholarship rule is locked after assignment.")
                      : ui(locale, `每名学生自动发放一次。金额为 0–${rewardCap}，设为 0 则不发放。`, `Awarded automatically once per student. Enter 0–${rewardCap}, with 0 turning it off.`)}
                  </>)}
                </p>
                <State resource={rewardResource} />
                {rewardConflict && (
                  <div className="mt-2 text-sm">
                    <p>{ui(locale, "奖学金规则已变更或锁定。请刷新规则后核对。", "The scholarship rule changed or was locked. Reload it to review the current rule.")}</p>
                    <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => {
                      setRewardEdit(null);
                      setRewardConflict(false);
                      setAssistanceEdit(null);
                      rewardResource.reload();
                    }}>
                      {ui(locale, "放弃奖学金改动并刷新", "Discard scholarship edits and reload")}
                    </Button>
                  </div>
                )}
              </div>
              {schoolId && <Field label={ui(locale,"开放时间（可选）","Opens at (optional)")}>
                <input className={input} type="datetime-local" value={startsAt} disabled={published||action.busy} onChange={e=>setStartsAt(e.target.value)}/>
              </Field>}
              <Field label={ui(locale, "教师说明", "Teacher note")}>
                <textarea
                  disabled={action.busy}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className={area}
                />
              </Field>
              <State resource={classes} />
            </div>
          )}
          {tab === "Problems" && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b className="text-sm">{ui(locale, "已选题目", "Selected problems")}</b>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{ui(locale, `${selected.length} 道题 · 作业总分 ${total} 分`, `${selected.length} problems · ${total} total marks`)}</span>
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <ScholarshipIcon size={15} />
                      {ui(locale, `单题奖学金合计 ${rewardTotal} / 100`, `Per-problem scholarships ${rewardTotal} / 100`)}
                    </span>
                  </div>
                  <p id="assignment-per-problem-scholarship-help" className="mt-1 text-xs text-muted-foreground">
                    {ui(locale, "在本作业中首次通过该题时发放，每题 0–20。首次 AC 积分单独计入排行。", "Awarded for the first pass on that problem in this assignment. Set 0–20 per problem. First-AC points count separately toward the leaderboard.")}
                  </p>
                  {rewardTotal > 100 && (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      {ui(locale, "单题奖学金合计最多 100，请减少单题金额。", "Per-problem scholarships total at most 100. Reduce the amounts.")}
                    </p>
                  )}
                  {published && hasSubmissions && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      已有正式提交，题目、分值和保存的手动顺序已锁定；仍可切换显示顺序。
                    </p>
                  )}
                  {published && hasActivity && !hasSubmissions && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ui(locale, "已有运行记录，可调整选题、分值和单题奖学金；题目内容在题库统一维护。", "You can still adjust the selected problems, marks, and per-problem scholarships. Maintain problem content in the problem bank.")}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!canEditProblems || action.busy || !courseOrderReady} onClick={() => setPicker(true)}>
                    <Plus size={15} />
                    从题库与分组选择
                  </Button>
                  {schoolId
                    ? <Button type="button" variant="secondary" disabled={!canEditProblems || action.busy} onClick={()=>setImporting(true)}><Upload size={15}/>{ui(locale,"导入题目","Import problems")}</Button>
                    : <Link href="/teacher/imports" className={buttonVariants({variant:"secondary"})}><Upload size={15}/>导入题目</Link>}
                </div>
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-border py-2 text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <ScholarshipIcon size={16} />
                  {completionLabel}
                  <span className="tabular-nums">{rewardReady ? completionReward?.amount : "—"}</span>
                </span>
                {!rewardLocked && (
                  <Button type="button" variant="link" size="sm" onClick={showCompletionReward} className="px-0">
                    {setRewardLabel}
                  </Button>
                )}
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <label htmlFor="assignment-problem-order" className="font-medium">{ui(locale, "题目顺序", "Problem order")}</label>
                <select id="assignment-problem-order" className={`${input} w-auto`} value={problemOrder} disabled={action.busy} onChange={event => setProblemOrder(event.target.value as "course" | "custom")}>
                  <option value="course">{ui(locale, "课程章节顺序", "Course chapter order")}</option>
                  <option value="custom">{ui(locale, "保存的手动顺序", "Saved custom order")}</option>
                </select>
                <span className="text-muted-foreground">{problemOrder === "course" && coursePathId
                  ? ui(locale, "按章节及章内题目排序，其他题目排在末尾。", "Chapter order, then problem order; other problems follow.")
                  : ui(locale, "按保存的题目顺序显示。", "Uses the saved problem order.")}</span>
              </div>
              {!courseOrderReady && <State resource={courseOrderState} />}
              {courseOrderReady && <Table headers={[
                ui(locale, "顺序", "Order"), ui(locale, "题目", "Problem"), ui(locale, "接口", "Interface"),
                ui(locale, "作业分值", "Assignment marks"), ui(locale, "首次 AC 积分", "First-AC points"),
                ui(locale, "题目难度", "Difficulty"), perProblemLabel, ui(locale, "操作", "Actions"),
              ]} min={930}>
                {orderedSelected.map((p, i) => (
                  <tr key={p.problemId}>
                    <td>{i + 1}</td>
                    <td>
                      <Link
                        className={`${link} font-semibold`}
                        href={problemEditorHref(p)}
                      >
                        {p.title}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">{ui(locale, "题目与题解自动同步题库", "Problem and solutions follow the problem bank")}</p>
                    </td>
                    <td>
                      {p.mode === "function"
                        ? ui(locale, "函数题", "Function")
                        : p.mode === "stdio"
                          ? ui(locale, "标准输入输出", "Standard I/O")
                          : "—"}
                    </td>
                    <td>
                      <input
                        aria-label={`${p.title} 分值`}
                        type="number"
                        step="0.01"
                        min={0.01}
                        max={1000}
                        disabled={!canEditProblems || action.busy}
                        className={`${input} w-24`}
                        value={p.points}
                        onChange={(e) =>
                          setSelected((x) =>
                            x.map((item) =>
                              item.problemId === p.problemId
                                ? { ...item, points: Number(e.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <span className="font-medium">+{p.firstAcPoints}</span>
                    </td>
                    <td className="relative text-muted-foreground">
                      {p.difficulty?.trim() ? (
                        <span className="block max-w-32 truncate" title={p.difficulty}>{p.difficulty}</span>
                      ) : (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">{p.difficulty === undefined
                            ? ui(locale, "难度不可用", "Difficulty unavailable")
                            : ui(locale, "未标注难度", "Difficulty not set")}</span>
                        </>
                      )}
                    </td>
                    <td>
                      <ScholarshipAmountInput
                        aria-label={`${p.title} · ${perProblemLabel}`}
                        aria-describedby="assignment-per-problem-scholarship-help"
                        max={20}
                        disabled={!canEditProblems || action.busy}
                        value={p.rewardPoints}
                        onChange={(event) => setSelected((current) =>
                          current.map((item) => item.problemId === p.problemId
                            ? { ...item, rewardPoints: Number(event.target.value) }
                            : item),
                        )}
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="上移"
                          disabled={!canEditProblems || action.busy || i === 0}
                          onClick={() => { setSelected(move(orderedSelected, i, -1)); setProblemOrder("custom"); }}
                        >
                          <ArrowUp size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="下移"
                          disabled={!canEditProblems || action.busy || i === selected.length - 1}
                          onClick={() => { setSelected(move(orderedSelected, i, 1)); setProblemOrder("custom"); }}
                        >
                          <ArrowDown size={15} />
                        </Button>
                        <Link
                          className={`${link} mx-2`}
                          href={problemEditorHref(p)}
                        >
                          <Pencil size={15} />
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="移除引用"
                          disabled={!canEditProblems || action.busy}
                          onClick={() =>
                            setSelected((x) =>
                              x.filter(
                                (item) => item.problemId !== p.problemId,
                              ),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!selected.length && (
                  <Empty columns={8}>从题库与分组选择已发布题目。</Empty>
                )}
              </Table>}
            </>
          )}
          {tab === "Applicable list" && <StudentAudienceSelector limit={schoolId ? 2000 : 500} students={students} classes={audienceClasses} selectedIds={participants} onChange={setParticipants} loading={audience.loading} error={audience.error} onReload={audience.reload} disabled={action.busy} lockedIds={lockedIds} exemptIds={exemptStudentIds}/>}
          {tab === "Rules" && (
            <section className={`${panel} mb-4 space-y-3 p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="inline-flex items-center gap-2 text-sm font-semibold"><ScholarshipIcon size={16} />{completionLabel}</h2>
                {!rewardLocked && (
                  <Button type="button" variant="link" size="sm" className="px-0" onClick={showCompletionReward}>
                    {setRewardLabel}
                  </Button>
                )}
              </div>
              <State resource={rewardResource} />
              {rewardReady && completionReward && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {rewardCondition}{" "}
                    {rewardLocked
                      ? ui(locale, "布置后规则锁定。", "The rule is locked after assignment.")
                      : ui(locale, "默认通过全部作业题目。规则随作业保存，布置后锁定。", "The default is to pass every assigned problem. The rule saves with the assignment and locks on publication.")}
                  </p>
                  <fieldset
                    aria-label={ui(locale, "完成奖学金发放条件", "Completion scholarship eligibility")}
                    disabled={rewardLocked || action.busy || rewardConflict}
                    className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                  >
                    <ActivityRewardFields activityType="assignment" rule={completionReward} onChange={setRewardEdit} />
                  </fieldset>
                </>
              )}
            </section>
          )}
          {schoolId && tab === "Rules" && rewardReady && <fieldset disabled={rewardLocked || action.busy} className="mb-5">
            <ActivityAssistanceFields assistance={assistanceEdit ?? originalAssistance} onChange={setAssistanceEdit}/>
          </fieldset>}
          {tab === "Rules" && (
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              {[
                [ui(locale, "正式计分", "Formal scoring"), ui(locale, "每道作业题取最佳成绩", "Best score per assigned problem")],
                [ui(locale, "订正", "Corrections"), ui(locale, "单独显示", "Shown separately")],
                [ui(locale, "样例运行", "Samples"), ui(locale, "不影响成绩", "Do not affect score")],
                [ui(locale, "隐藏测试", "Hidden tests"), ui(locale, "不显示原始输入或答案", "No raw input or answer shown")],
                [ui(locale, "系统错误", "System Error"), ui(locale, "不计为零分", "Not counted as zero")],
                [ui(locale, "截止时间", "Deadline"), ui(locale, "以服务端正式接收时间为准", "Based on server receipt time")],
              ].map(([label, value]) => (
                <Metric key={label} label={label!} value={value} />
              ))}
            </div>
          )}
          {tab === "Preview" && (
            <div className="border border-border bg-surface-subtle p-5">
              <p className="text-xs font-semibold text-primary">
                {ui(locale, "学生预览", "Student preview")}
              </p>
              <h2 className="mt-1 text-xl font-bold">
                {title || "未命名作业"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {classSummary} · {ui(locale, `向 ${participants.length} 名学生布置`, `Assigned to ${participants.length} students`)} ·
                {ui(locale, "截止", "Due")} {due || ui(locale, "尚未设置", "Not set")}
              </p>
              {coursePathId && <p className="mt-2 text-sm text-primary">{ui(locale, "关联课程：", "Linked course: ")}{courses.data?.items.find(item => item.id === coursePathId)?.title ?? initial?.courseTitle ?? ui(locale, "课程不可用", "Course unavailable")}</p>}
              {languageRequirement && <p className="mt-2 text-sm">{languageRequirement}</p>}
              <p className="mt-4 whitespace-pre-wrap text-sm">{description}</p>
              {!courseOrderReady && <State resource={courseOrderState} />}
              {courseOrderReady && <Table headers={[
                ui(locale, "题目", "Problem"), ui(locale, "作业分值", "Assignment marks"),
                ui(locale, "首次 AC 积分", "First-AC points"), perProblemLabel,
              ]} min={400}>
                {orderedSelected.map((p) => (
                  <tr key={p.problemId}>
                    <td>
                      <Link href={problemEditorHref(p)} className={link}>
                        {p.title}
                      </Link>
                    </td>
                    <td>{p.points}</td>
                    <td>+{p.firstAcPoints}</td>
                    <td><span className="inline-flex items-center gap-1.5 tabular-nums"><ScholarshipIcon size={15} />{p.rewardPoints}</span></td>
                  </tr>
                ))}
              </Table>}
              <div className="border-t border-border">
                {rewardSummary}
                {rewardReady && Boolean(completionReward?.amount) && <p className="mt-1 text-xs text-muted-foreground">{rewardCondition}</p>}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                只有已勾选的学生看到作业、截止时间和进度；公开样例运行不会改变作业成绩。
              </p>
            </div>
          )}
        </fieldset>
      </section>
      {importing && schoolId && <SchoolAssignmentProblemImport schoolId={schoolId} onClose={()=>setImporting(false)}/>}
      {picker && courseOrderReady && (
        <ProblemPicker
          forAssignment schoolId={schoolId} schoolProblems={schoolId ? pickerProblems?.map(p=>({
            id:p.problemId,title:p.title,mode:p.mode,published:true,publishedVersionId:p.versionId,bankId:p.bankId,bankName:p.bankName,
            firstAcPoints:options.data?.firstAcPoints,publishedDifficulty:p.difficulty,
          })) : undefined}
          selected={selected.map((x) => x.problemId)}
          orderedProblemIds={problemOrder === "course" ? courseProblemIds : undefined}
          onClose={() => setPicker(false)}
          onAdd={(items) => {
            setSelected((x) => [
              ...x,
              ...items.map((p) => ({
                problemId: p.id,
                title: p.publishedTitle ?? p.title,
                points: 100,
                firstAcPoints: p.firstAcPoints ?? 10,
                rewardPoints: 0,
                difficulty: p.publishedDifficulty !== undefined
                  ? p.publishedDifficulty
                  : p.versionId === p.publishedVersionId ? p.difficulty : undefined,
                mode: p.mode,
                versionId: p.publishedVersionId ?? undefined,
              })),
            ]);
            setPicker(false);
          }}
        />
      )}
      {publish && (
        <Modal title={ui(locale, "确认布置作业", "Assign this work")} onClose={() => { if (!action.busy) setPublish(false); }}>
          <p className="text-sm leading-6">
            {ui(locale, `向已选择的 ${participants.length} 名学生布置 ${selected.length} 道题，总分 ${total} 分。`, `Assign ${selected.length} problems worth ${total} marks to ${participants.length} selected students.`)}
          </p>
          {languageRequirement && <p className="mt-2 text-sm">{languageRequirement}</p>}
          {rewardSummary}
          {rewardReady && Boolean(completionReward?.amount) && <p className="mt-2 text-xs text-muted-foreground">{rewardCondition}</p>}
          <State resource={rewardResource} />
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" disabled={action.busy} onClick={() => setPublish(false)}>
              {ui(locale, "取消", "Cancel")}
            </Button>
            <Button
              disabled={
                action.busy ||
                !rewardReady ||
                rewardConflict ||
                !participants.length ||
                !selected.length ||
                !title.trim() ||
                (!schoolId && !due)
              }
              onClick={() =>
                void action.run(async () => {
                  const result = await save(true);
                  setPublish(false);
                  router.push(assignmentHref(schoolId,result.id,"progress"));
                  return ui(locale, "作业已布置。", "Assignment created for the selected students.");
                })
              }
            >
              {ui(locale, "确认布置", "Assign")}
            </Button>
          </div>
        </Modal>
      )}
      {confirmUpdate && published && (
        <Modal title={ui(locale, "确认修改已布置作业", "Save changes to assigned work")} onClose={() => setConfirmUpdate(false)}>
          <p className="text-sm leading-6">
            修改将立即影响已布置给 {participants.length} 名学生的作业。
            {changedProblems && "题目、分值、顺序或单题奖学金有变更。"}
            {changedParticipants && "学生名单有变更，未勾选学生将看不到作业。"}
            {due !== localInput(saved?.dueAt) && "截止时间将延后。"}
            已有提交和历史成绩会保留。
          </p>
          <Feedback action={action} />
          {stale && (
            <div className="mt-4 border border-warning/30 bg-warning/5 p-3 text-sm">
              作业已被其他教师更新。重新加载后核对最新内容，再保存修改。
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  draft.clear();
                  setConfirmUpdate(false);
                  onReload();
                }}
              >
                重新加载最新作业
              </Button>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmUpdate(false)}>
              取消
            </Button>
            <Button
              disabled={action.busy || stale}
              onClick={() => void action.run(async () => {
                await save();
                setConfirmUpdate(false);
                return "已发布作业已更新。";
              })}
            >
              确认保存修改
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

type Grade = NonNullable<Assignment["grades"]>[number];
export function TeacherAssignmentProgress({ id, schoolId }: { id: string; schoolId?: string }) {
  const { locale } = useLocale();
  const base = schoolId ? `schools/${schoolId}/activities/${id}` : `assignments/${id}`;
  const current = useData<AssignmentReport>(schoolId ? base+"/report?view=assignment" : null);
  const legacy = useData<TeacherAssignment>(schoolId ? null : base);
  const resource = schoolId ? {...current, data:current.data && teacherAssignmentReport(current.data)} : legacy,
    [selected, setSelected] = useState<{
      student: Grade;
      problemId: string;
      submissionId: string | null;
    } | null>(null),
    [manage, setManage] = useState(false),
    action = useAction();
  const assignment = resource.data,
    grades = assignment?.grades ?? [],
    complete = grades.filter((x) =>
      x.problems.length > 0 && x.problems.every((p) => p.status === "AC"),
    ).length,
    started = grades.filter((x) =>
      x.problems.some((p) => p.submissionId || p.assignmentAttempts || p.completionSource === "other_entry"),
    ).length,
    exempt =
      assignment?.participantDetails?.filter((x) => x.exempt).length ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="作业进度"
        title={`${assignment?.title ?? ui(locale, "作业", "Assignment")} · ${ui(locale, "进度", "Progress Matrix")}`}
        description={
          assignment
            ? ui(locale, `${grades.length} 名适用学生 · 截止 ${date(assignment.dueAt)}。订正记录不会覆盖作业原成绩。`, `${grades.length} applicable students · Due ${date(assignment.dueAt)}. Corrections do not overwrite the original grade.`)
            : ui(locale, "正在读取学生进度。", "Loading student progress.")
        }
        action={
          <div className="flex flex-wrap gap-2">
            {schoolId && <>
              <Link href={schoolWorkspaceHref(schoolId,"assignments","teacher")} className={buttonVariants({variant:"secondary"})}>{ui(locale,"返回作业列表","Back to assignments")}</Link>
              <Link href={schoolWorkspaceHref(schoolId,"reports","teacher")+`&activityId=${id}`} className={buttonVariants({variant:"secondary"})}>{ui(locale,"教学报告与导出","Report and export")}</Link>
            </>}
            {assignment?.canManage && !assignment.archived && assignment.problems.length > 0 && <AssignmentPreviewLink id={id} from="progress" schoolId={schoolId}/>}
            {assignment?.canManage && assignment.published && !assignment.archived && <>
              <Button variant="secondary" onClick={() => setManage(true)}>{ui(locale, "延期 / 豁免", "Extend / exempt")}</Button>
              <CancelAssignment path={base} title={assignment.title} onSaved={resource.reload}/>
            </>}
            <Link
              href={assignmentHref(schoolId,id,"edit")}
              className={buttonVariants({ variant: "secondary" })}
            >
              {ui(locale, "编辑作业", "Edit assignment")}
            </Link>
          </div>
        }
      />
      <State resource={resource} />
      {assignment && (
        <>
          {assignment.cancelledAt && <p className="my-3 text-sm font-medium">{ui(locale, "作业已取消", "Assignment cancelled")}</p>}
          <div className="mt-5 grid grid-cols-6 gap-3 max-lg:grid-cols-3 max-sm:grid-cols-2">
            {[
              [ui(locale, "已完成", "Complete"), complete],
              [ui(locale, "进行中", "In progress"), started - complete],
              [ui(locale, "未开始", "Not started"), grades.length - started],
              [ui(locale, "适用学生", "Applicable"), grades.length],
              [ui(locale, "已豁免", "Exempt"), exempt],
              [ui(locale, "题目", "Problems"), assignment.problems.length],
            ].map(([label, value]) => (
              <Metric key={label} label={String(label)} value={value} />
            ))}
          </div>
          <section className={`${panel} mt-5 overflow-hidden`}>
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-bold">{ui(locale, "学生进度矩阵", "Student progress matrix")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {schoolId ? ui(locale, "进度包含补交。截止成绩取截止前最高有效分，符合条件的其他入口通过也可计分。", "Progress includes late work. Deadline scores use the best eligible result before the cutoff, including eligible passes elsewhere.") : ui(locale, "成绩取截止前最高有效分；同题在其他入口符合计分规则的正式 AC 可直接计满分，标注来源且不新增提交或奖励。", "Grades use the best valid score before the deadline. An eligible formal AC on the same problem elsewhere earns full credit, with its source marked and no new submission or reward.")}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table
                className="w-full text-left text-sm"
                style={{ minWidth: 500 + assignment.problems.length * 150 }}
              >
                <thead className="bg-surface-subtle text-xs text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 z-10 min-w-52 border-r border-border bg-surface-subtle px-4 py-3">
                      {ui(locale, "学生", "Student")}
                    </th>
                    <th className="px-3 py-3">{ui(locale, "状态", "Status")}</th>
                    <th className="px-3 py-3">{schoolId ? ui(locale, "截止成绩", "Deadline score") : ui(locale, "分数", "Score")}</th>
                    {assignment.problems.map((p) => (
                      <th
                        key={p.problemId}
                        className="min-w-36 px-3 py-3 text-center"
                      >
                        <Link
                          className={link}
                          href={schoolId ? schoolWorkspaceHref(schoolId,"problems","teacher")+`&problemId=${p.problemId}&problemEdit=1` : `/teacher/problems/${p.problemId}/edit?${new URLSearchParams({
                            returnTo: `/teacher/assignments/${id}/progress`,
                            ...(p.versionId ? { versionId: p.versionId } : {}),
                          }).toString()}`}
                        >
                          {p.title ?? p.problemId.slice(0, 8)}
                        </Link>
                        <p className="mt-1 font-normal">{p.points} {ui(locale, "分", "pts")}</p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grades.map((student) => (
                    <tr
                      key={student.identityId}
                      className="border-t border-border"
                    >
                      <th className="sticky left-0 z-10 border-r border-border bg-surface px-4 py-3">
                        <div>{student.name}</div>
                        <p className="mt-1 text-xs font-normal text-muted-foreground">
                          {student.identityId.slice(0, 8)}
                        </p>
                      </th>
                      <td className="px-3 py-3">
                        <StatusPill
                          status={
                            student.problems.length > 0 && student.problems.every((p) => p.status === "AC")
                              ? ui(locale, "完成", "Complete")
                              : student.problems.some((p) => p.submissionId || p.assignmentAttempts || p.completionSource === "other_entry")
                                ? ui(locale, "进行中", "In progress")
                                : ui(locale, "未开始", "Not started")
                          }
                        />
                      </td>
                      <td className="px-3 py-3 font-semibold">
                        {student.score === null
                          ? "待评测"
                          : `${student.score} / ${student.maxScore}`}
                      </td>
                      {assignment.problems.map((p) => {
                        const cell = student.problems.find(
                          (x) => x.problemId === p.problemId,
                        );
                        const lateWork = cell?.includesLateWork;
                        return (
                          <td
                            key={p.problemId}
                            className="border-l border-border text-center"
                          >
                            <button
                              disabled={cell?.completionSource === "other_entry" && !(schoolId && cell.assignmentAttempts)}
                              onClick={() =>
                                setSelected({
                                  student,
                                  problemId: p.problemId,
                                  submissionId: cell?.submissionId ?? null,
                                })
                              }
                              className="min-h-16 w-full px-2 py-2 hover:bg-info-soft"
                            >
                              <b className={lateWork ? "text-warning" : undefined}>{cell?.status ?? "—"}</b>
                              {lateWork && <span className="block text-xs font-medium text-warning">{ui(locale, "含截止后记录", "Includes late work")}</span>}
                              {cell?.completionSource === "other_entry" && <span className="block text-xs text-muted-foreground">{ui(locale, "已在其他入口通过", "Passed elsewhere")}</span>}
                              <p className={`text-xs ${lateWork ? "text-warning" : "text-muted-foreground"}`}>
                                {cell?.score === null ||
                                cell?.score === undefined
                                  ? "—"
                                  : `${((cell.score * p.points) / 100).toFixed(2)} / ${p.points}`}
                              </p>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!grades.length && (
                <p className="p-5 text-sm text-muted-foreground">
                  暂无适用学生。
                </p>
              )}
            </div>
          </section>
        </>
      )}
      {selected && schoolId && <SchoolAssignmentSubmissions path={`${base}/report/${selected.student.identityId}?problemId=${selected.problemId}`} title={`${selected.student.name} · ${assignment?.problems.find(p=>p.problemId===selected.problemId)?.title ?? ""}`} onClose={()=>setSelected(null)}/>}
      {selected && !schoolId && (
        <TeacherSubmissionDrawer
          id={selected.submissionId}
          title={`${selected.student.name} · ${assignment?.problems.find((x) => x.problemId === selected.problemId)?.title ?? "题目"}`}
          studentId={selected.student.identityId}
          problemId={selected.problemId}
          onClose={() => setSelected(null)}
        />
      )}
      {manage && assignment && (
        <Modal title={ui(locale, "作业延期与适用名单", "Assignment deadlines and exemptions")} onClose={() => setManage(false)} wide>
          {(!schoolId || assignment.dueAt) && <><h3 className="mb-3 text-sm font-semibold">{ui(locale, "整份作业延期", "Extend assignment for everyone")}</h3>
          <form
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void action.run(async () => {
                await productionApi(base+(schoolId?"/manage":"/extend"), {
                  method: schoolId?"PATCH":"POST",
                  body: {
                    [schoolId?"endsAt":"dueAt"]: new Date(String(d.get("dueAt"))).toISOString(),
                    ...(schoolId && {expectedRevision:assignment.editRevision}),
                    reason: d.get("reason"),
                  },
                });
                resource.reload();
                return ui(locale, "截止时间已延后，受影响的学生已收到通知。", "Deadline extended and affected students notified.");
              });
            }}
          >
            <Field label="新的截止时间">
              <input
                name="dueAt"
                type="datetime-local"
                required
                className={input}
              />
            </Field>
            <Field label="延期原因">
              <input name="reason" required className={input} />
            </Field>
            <Button variant="secondary" disabled={action.busy}>
              {ui(locale, "延期并通知学生", "Extend and notify students")}
            </Button>
          </form></>}
          <Feedback action={action} />
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-semibold">{ui(locale, "个人延期或豁免", "Individual deadline or exemption")}</h3>
            <AssignmentParticipantForm path={base} participants={assignment.participantDetails ?? []}
              toDeadline={value => activityDate(value, ui(locale, "新的截止时间", "new deadline"))} onSaved={resource.reload}/>
          </div>
        </Modal>
      )}
    </>
  );
}
interface SubmissionDetail extends Submission {
  identityId?: string;
  reviews?: {
    id: string;
    note: string;
    authorName?: string;
    createdAt?: string;
  }[];
  pendingRejudge?: {
    runId: string;
    status?: string;
    score?: number | null;
    reason?: string;
  } | null;
}
export function TeacherSubmissionDrawer({
  id,
  title,
  studentId,
  problemId,
  onClose,
}: {
  id: string | null;
  title: string;
  studentId?: string | undefined;
  problemId?: string | undefined;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const submission = useData<SubmissionDetail>(id ? `submissions/${id}` : null),
    resolvedStudent = studentId ?? submission.data?.identityId,
    history = useData<{ items: Submission[] }>(
      resolvedStudent ? `submissions?identityId=${resolvedStudent}` : null,
    ),
    action = useAction();
  const original = submission.data,
    corrections =
      history.data?.items.filter(
        (x) =>
          x.kind === "correction" && (!problemId || x.problemId === problemId),
      ) ?? [];
  useEffect(() => {
    if (!original || !["Waiting", "Judging"].includes(original.status)) return;
    const timer = setTimeout(submission.reload, 2000);
    return () => clearTimeout(timer);
  }, [original, submission.reload]);
  return (
    <Drawer title={title} onClose={onClose}>
      <p className="text-xs font-semibold text-primary">
        {ui(locale, "代码、订正与反馈", "Code, correction & feedback")}
      </p>
      <State resource={submission} />
      {original ? (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Metric
              label="原成绩"
              value={
                original.score === null ? "待评测" : `${original.score} / 100`
              }
            />
            <Metric label="正式结果" value={original.status} />
            <Metric
              label="测试通过"
              value={
                original.passed === null
                  ? "—"
                  : `${original.passed} / ${original.total}`
              }
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            {original.id} · {date(original.createdAt)} · {original.kind}
          </p>
          <h3 className="mt-5 font-bold">{ui(locale, "学生笔记 / 教师反馈", "Student note / Teacher feedback")}</h3>
          <div className="mt-3 space-y-3">
            {original.reviews?.map((review) => (
              <article
                key={review.id}
                className="border border-border p-3 text-sm"
              >
                <b>{review.authorName ?? "学习记录"}</b>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {review.note}
                </p>
              </article>
            ))}
            {!original.reviews?.length && (
              <p className="text-sm text-muted-foreground">尚无笔记或反馈。</p>
            )}
          </div>
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const d = new FormData(form);
              void action.run(async () => {
                const result = await productionApi<{ teacherFeedback: boolean; feedbackPending: boolean }>("review-notebook", {
                  method: "POST",
                  body: { submissionId: id, note: d.get("note") },
                });
                form.reset();
                submission.reload();
                if (!result.teacherFeedback) return ui(locale, "笔记已保存。", "Note saved.");
                return result.feedbackPending
                  ? ui(locale, "反馈已保存，成绩发布后会通知学生。", "Feedback saved. The student will be notified when results are published.")
                  : ui(locale, "反馈已保存，已通知学生。", "Feedback saved and the student has been notified.");
              });
            }}
          >
            <Field label={ui(locale, "教师反馈", "Teacher feedback")}>
              <textarea
                name="note"
                required
                rows={3}
                maxLength={10000}
                className={area}
              />
            </Field>
            <Button className="mt-3" disabled={action.busy}>
              保存反馈
            </Button>
            <Feedback action={action} />
          </form>
          {original.pendingRejudge && (
            <section className="mt-5 border border-warning/30 bg-warning-soft p-4">
              <h3 className="font-bold">重判候选结果</h3>
              <p className="mt-2 text-sm">
                {original.pendingRejudge.status ?? "等待重判"} ·{" "}
                {original.pendingRejudge.score === null ||
                original.pendingRejudge.score === undefined
                  ? "尚无有效分数"
                  : `${original.pendingRejudge.score} / 100`}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                原结果仍保留。确认候选结果后，计时训练已发布成绩还需明确发布成绩修订。
              </p>
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  void action.run(async () => {
                    await productionApi(`submissions/${id}/rejudge-confirm`, {
                      method: "POST",
                      body: {
                        runId: original.pendingRejudge?.runId,
                        reason: d.get("reason"),
                      },
                    });
                    submission.reload();
                    return "重判候选已确认，活动成绩发布状态保持。";
                  });
                }}
              >
                <input
                  aria-label="重判确认原因"
                  name="reason"
                  required
                  placeholder="确认原因"
                  className={input}
                />
                <div className="flex gap-2">
                  <Button
                    disabled={
                      action.busy ||
                      !["AC", "WA", "TLE", "MLE", "RE", "CE"].includes(
                        original.pendingRejudge.status ?? "",
                      )
                    }
                  >
                    确认候选结果
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={action.busy}
                    onClick={() => {
                      const reason = window.prompt("不发布候选的原因");
                      if (reason?.trim())
                        void action.run(async () => {
                          await productionApi(
                            `submissions/${id}/rejudge-dismiss`,
                            {
                              method: "POST",
                              body: {
                                runId: original.pendingRejudge?.runId,
                                reason,
                              },
                            },
                          );
                          submission.reload();
                          return "候选已放弃，原结果保留。";
                        });
                    }}
                  >
                    放弃候选
                  </Button>
                </div>
              </form>
              <Feedback action={action} />
            </section>
          )}
          <h3 className="mt-5 font-bold">{ui(locale, "正式提交代码", "Formal code")}</h3>
          <pre className="mt-3 max-h-96 overflow-auto rounded bg-code p-4 font-mono text-sm leading-6 text-code-foreground">
            {original.code}
          </pre>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          该学生尚无这道题的正式提交。
        </p>
      )}
      <h3 className="mt-5 font-bold">{ui(locale, "订正记录", "Corrections")}</h3>
      {corrections.map((item) => (
        <details key={item.id} className="mt-3 border border-border p-3">
          <summary className="cursor-pointer text-sm">
            <b>{item.id}</b>
            <span className="ml-3">
              {item.status} ·{" "}
              {item.score === null ? "待评测" : `${item.score}/100`}
            </span>
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            原提交 {item.originalSubmissionId} · {date(item.createdAt)}
          </p>
          <pre className="mt-3 max-h-72 overflow-auto rounded bg-code p-3 font-mono text-xs text-code-foreground">
            {item.code}
          </pre>
        </details>
      ))}
      {!corrections.length && (
        <p className="mt-3 text-sm text-muted-foreground">暂无订正记录。</p>
      )}
      <p className="mt-5 text-xs text-muted-foreground">
        订正与原正式提交分别记录。隐藏测试输入、期望答案和内部判题日志不会在此展示。
      </p>
    </Drawer>
  );
}
