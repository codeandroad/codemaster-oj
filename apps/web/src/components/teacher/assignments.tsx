"use client";

import { AppLink as Link } from "@/components/navigation";
import { useEffect, useState } from "react";
import {activityDate,validateActivity,activeParticipants} from "./activity-validation";
import {useActivityDraft} from "./use-activity-draft";
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
import {
  productionApi,
  apiMessage,
  ApiError,
  type Assignment,
  type Person,
  type ProductionProblem,
  type SchoolClass,
  type Submission,
} from "@/lib/production-api";
import { TeacherAssignment } from "./dashboard-classes";
import { ProblemPicker } from "./problem-banks";
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

export function TeacherAssignments() {
  const assignments = useData<{ items: TeacherAssignment[] }>("assignments"),
    classes = useData<{ items: SchoolClass[] }>("classes");
  return (
    <>
      <PageHeader
        eyebrow="作业管理"
        title="Assignment Management"
        description="跨班级管理作业，维护明确的适用名单，并查看学生进度。"
        action={
          <Link href="/teacher/assignments/new/edit" className={buttonVariants()}>
            <Plus size={15} />
            New assignment
          </Link>
        }
      />
      <State resource={assignments} />
      <section className={`${panel} mt-5`}>
        <Table
          headers={[
            "Assignment",
            "Classes",
            "已布置 / 全班",
            "未布置 / 豁免",
            "Average / Status",
            "Actions",
          ]}
        >
          {assignments.data?.items.map((item) => {
            const assigned = item.applicableCount ?? item.participants?.length ??
              item.participantDetails?.filter((person) => !person.exempt).length ?? 0;
            const exempt = item.exemptCount ??
              item.participantDetails?.filter((person) => person.exempt).length ?? 0;
            const schoolClass = classes.data?.items.find((schoolClass) =>
              schoolClass.id === item.classId,
            );
            const historicalCount = item.participantDetails?.filter((person) =>
              !schoolClass?.studentIds.includes(person.identityId),
            ).length ?? 0;
            const rosterSize = schoolClass
              ? schoolClass.studentIds.length + historicalCount
              : assigned + exempt;
            return <tr key={item.id}>
              <td>
                <Link
                  href={`/teacher/assignments/${item.id}/edit`}
                  className={`${link} font-semibold`}
                >
                  {item.title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  Due {date(item.dueAt)}
                </p>
              </td>
              <td className="text-muted-foreground">
                {item.className ??
                  classes.data?.items.find((x) => x.id === item.classId)?.name}
              </td>
              <td>
                <b>
                  {assigned} / {rosterSize}
                </b>
              </td>
              <td>
                {Math.max(0, rosterSize - assigned - exempt)} / {exempt}
              </td>
              <td>
                <StatusPill
                  status={
                    item.state === "Draft"
                      ? "Draft"
                      : item.averagePercent === null ||
                          item.averagePercent === undefined
                        ? "Not started"
                        : `${item.averagePercent.toFixed(1)}%`
                  }
                />
              </td>
              <td>
                <div className="flex gap-3">
                  <Link
                    href={`/teacher/assignments/${item.id}/edit`}
                    className={link}
                  >
                    {item.state === "Draft" ? "编辑" : "查看 / 编辑"}
                  </Link>
                  <Link
                    href={`/teacher/assignments/${item.id}/progress`}
                    className={link}
                  >
                    Matrix →
                  </Link>
                </div>
              </td>
            </tr>;
          })}
          {!assignments.loading && !assignments.data?.items.length && (
            <Empty columns={6}>暂无作业。点击 New assignment 开始布置。</Empty>
          )}
        </Table>
      </section>
    </>
  );
}
interface SelectedProblem {
  problemId: string;
  title: string;
  points: number;
  firstAcPoints: number;
  rewardPoints: number;
  mode?: string;
  versionId?: string;
}
interface LatestProblemVersion {
  versionId: string;
  title: string;
}
const assignmentTabs = [
  "Basic information",
  "Problems",
  "Applicable list",
  "Rules",
  "Preview",
];
export function TeacherAssignmentEditor({ id,userId }: { id: string;userId:string }) {
  const resource = useData<TeacherAssignment>(
    id === "new" ? null : `assignments/${id}`,
  );
  return (
    <>
      <State resource={resource} />
      {(id === "new" || (!resource.loading && resource.data?.id === id)) && (
        <AssignmentEditorForm
          userId={userId}
          key={`${id}:${resource.data?.editRevision ?? 0}`}
          initial={id === "new" ? null : resource.data}
          onReload={resource.reload}
        />
      )}
    </>
  );
}
function AssignmentEditorForm({
  initial,userId,onReload,
}: {
  userId:string;
  initial: TeacherAssignment | null;
  onReload: () => void;
}) {
  const router = useRouter(),
    searchParams = useSearchParams(),
    classes = useData<{ items: SchoolClass[] }>("classes"),
    people = useData<{ items: Person[] }>("people"),
    [tab, setTab] = useState(searchParams.get("tab") === "problems" ? "Problems" : assignmentTabs[0]!),
    [saved, setSaved] = useState(initial),
    [title, setTitle] = useState(initial?.title ?? ""),
    [description, setDescription] = useState(initial?.description ?? ""),
    [course, setCourse] = useState(initial?.course ?? "Python"),
    [classId, setClassId] = useState(initial?.classId ?? ""),
    [due, setDue] = useState(localInput(initial?.dueAt)),
    [selected, setSelected] = useState<SelectedProblem[]>(
      initial?.problems.map((x) => ({
        ...x,
        title: x.title ?? "题目",
        firstAcPoints: x.firstAcPoints ?? 10,
        rewardPoints: x.rewardPoints ?? 0,
      })) ?? [],
    ),
    [participants, setParticipants] = useState(
      initial?.participantDetails
        ?.filter((x) => !x.exempt)
        .map((x) => x.identityId) ??
        initial?.participants ??
        [],
    ),
    [query, setQuery] = useState(""),
    [picker, setPicker] = useState(false),
    [publish, setPublish] = useState(false),
    [confirmUpdate, setConfirmUpdate] = useState(false),
    [latestVersions, setLatestVersions] = useState<Record<string, LatestProblemVersion | null>>({}),
    [checkingVersion, setCheckingVersion] = useState<string | null>(null),
    [versionError, setVersionError] = useState(""),
    [stale, setStale] = useState(false),
    action = useAction();
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
    canEditProblems = !published || !hasSubmissions,
    classroom = classes.data?.items.find((x) => x.id === classId),
    students =
      people.data?.items.filter(
        (x) => x.kind === "student" && classroom?.studentIds.includes(x.id),
      ) ?? [],
    historicalParticipants = classroom
      ? saved?.participantDetails?.filter((person) =>
          !classroom.studentIds.includes(person.identityId),
        ) ?? []
      : [],
    rosterTotal = classroom
      ? students.length + historicalParticipants.length
      : Math.max(students.length, participants.length + exemptStudentIds.size),
    historicalStudentIds = new Set(
      historicalParticipants.map((person) => person.identityId),
    ),
    shown = students.filter((x) =>
      `${x.name} ${x.number}`.toLowerCase().includes(query.toLowerCase()),
    );
  const total = selected.reduce((sum, x) => sum + x.points, 0);
  const rewardTotal = selected.reduce((sum, x) => sum + x.rewardPoints, 0);
  const checkLatestVersion = async (problemId: string) => {
    setCheckingVersion(problemId);
    setVersionError("");
    try {
      const problem = await productionApi<ProductionProblem>(`problems/${problemId}`);
      const published = problem.publishedVersionId
        ? await productionApi<ProductionProblem>(
            `problems/${problemId}?versionId=${encodeURIComponent(problem.publishedVersionId)}`,
          )
        : null;
      setLatestVersions((current) => ({
        ...current,
        [problemId]: published && problem.publishedVersionId
          ? {
              versionId: problem.publishedVersionId,
              title: published.title,
            }
          : null,
      }));
    } catch (error) {
      setVersionError(apiMessage(error));
    } finally {
      setCheckingVersion(null);
    }
  };
  const problemEditorHref = (problem: SelectedProblem) => {
    const query = new URLSearchParams({
      returnTo: saved
        ? `/teacher/assignments/${saved.id}/edit`
        : "/teacher/assignments/new/edit",
    });
    if (problem.versionId) query.set("versionId", problem.versionId);
    return `/teacher/problems/${problem.problemId}/edit?${query.toString()}`;
  };
  const draft=useActivityDraft({storageKey:`campus-judge:activity-draft:v1:${userId}:assignment:${initial?.id??"new"}`,editable:true,noticeText:published?"改动已临时保存在当前浏览器；点击“保存修改”后才会更新已发布作业。":undefined,snapshot:{title,description,course,classId,due,problems:selected,participants},onRestore:v=>{setTitle(v.title);setDescription(v.description);setCourse(v.course);setClassId(v.classId);setDue(v.due);setSelected(v.problems.map(problem=>({...problem,firstAcPoints:initial?.problems.find(item=>item.problemId===problem.problemId)?.firstAcPoints??problem.firstAcPoints??10,rewardPoints:problem.rewardPoints??initial?.problems.find(item=>item.problemId===problem.problemId)?.rewardPoints??0})));setParticipants(v.participants);}});
  const changedProblems = JSON.stringify(
    selected.map((x) => ({ problemId: x.problemId, points: x.points, versionId: x.versionId, rewardPoints: x.rewardPoints })),
  ) !== JSON.stringify(
    (saved?.problems ?? []).map((x) => ({
      problemId: x.problemId,
      points: x.points,
      versionId: x.versionId,
      rewardPoints: x.rewardPoints ?? 0,
    })),
  );
  const changedParticipants = JSON.stringify([...participants].sort()) !==
    JSON.stringify(activeParticipants(saved?.participantDetails,saved?.participants ?? []).sort());
  const changedTitle = title !== (saved?.title ?? "");
  const changedDescription = description !== (saved?.description ?? "");
  const changedCourse = course !== (saved?.course ?? "Python");
  const changedClass = classId !== (saved?.classId ?? "");
  const changedDue = due !== localInput(saved?.dueAt);
  const changedPinnedVersions = selected.some((problem) => {
    const original = saved?.problems.find((item) => item.problemId === problem.problemId);
    return original && original.versionId !== problem.versionId;
  });
  const hasChanges = changedTitle || changedDescription || changedCourse ||
    changedClass || changedDue || changedProblems || changedParticipants;
  useDirty(hasChanges);
  const save = async () => {
    if (published && !hasChanges)
      throw new Error("没有需要保存的修改。");
    validateActivity({title,classId,problems:selected,participants});
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
    if (published && classId !== saved?.classId)
      throw new Error("已发布作业不能更换班级。请在原班级内选择适用学生。");
    if (published && hasSubmissions && changedProblems)
      throw new Error("已有正式提交，题目、分值、顺序和奖励积分不能修改。可修改说明、截止时间或适用学生。");
    if (published && hasActivity && changedPinnedVersions)
      throw new Error("已有运行或提交记录，不能切换作业题目的固定版本。");
    const dueAt=activityDate(due,'截止时间');
    if (published && changedParticipants && Date.parse(dueAt) <= Date.now())
      throw new Error("作业已截止。调整学生名单前，请先将截止时间延至未来。");
    if (published && changedDue) {
      if (Date.parse(dueAt) <= Date.parse(saved!.dueAt))
        throw new Error("已发布作业只能延长截止时间，不能提前截止。");
      if (Date.parse(dueAt) <= Date.now())
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
          ...(changedDue ? { dueAt } : {}),
          ...(changedProblems ? { problems: problemPayload } : {}),
          ...(changedParticipants ? { participants } : {}),
        }
      : {
          state: "Draft",
          ...(saved?.editRevision !== undefined
            ? { expectedRevision: saved.editRevision }
            : {}),
          title,
          classId,
          dueAt,
          description,
          course,
          problems: problemPayload,
          participants,
        };
    let result: TeacherAssignment;
    try {
      result = await productionApi<TeacherAssignment>(
        saved ? `assignments/${saved.id}` : "assignments",
        {
          method: saved ? "PATCH" : "POST",
          body,
        },
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "ASSIGNMENT_REVISION_CONFLICT")
        setStale(true);
      throw error;
    }
    draft.clear();
    setSaved(result);
    setSelected(result.problems.map((problem) => ({
      ...problem,
      title: problem.title ?? selected.find((item) => item.problemId === problem.problemId)?.title ?? "题目",
      firstAcPoints: problem.firstAcPoints ?? selected.find((item) => item.problemId === problem.problemId)?.firstAcPoints ?? 10,
      rewardPoints: problem.rewardPoints ?? selected.find((item) => item.problemId === problem.problemId)?.rewardPoints ?? 0,
      mode: selected.find((item) => item.problemId === problem.problemId)?.mode,
    })));
    if (!saved) router.replace(`/teacher/assignments/${result.id}/edit`);
    return result;
  };
  return (
    <>
      <Link
        className={`${link} mb-4 inline-block text-sm`}
        href="/teacher/assignments"
      >
        ← Assignment list
      </Link>
      <PageHeader
        eyebrow="作业编辑"
        title={saved?.title ?? "New assignment"}
        description="基本信息、题目与分值、指定学生名单、规则与学生预览。"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={action.busy || (published && !hasChanges)}
              onClick={() => {
                if (published) {
                  setConfirmUpdate(true);
                  return;
                }
                void action.run(async () => {
                  await save();
                  return "作业草稿已保存。";
                });
              }}
            >
              {published ? "保存修改" : "保存草稿"}
            </Button>
            {published ? (
              <Link
                href={`/teacher/assignments/${saved?.id}/progress`}
                className={buttonVariants({ variant: "secondary" })}
              >
                查看进度
              </Link>
            ) : (
              <Button
                disabled={action.busy}
                onClick={() => setPublish(true)}
              >
                <Send size={15} />
                发布作业
              </Button>
            )}
          </div>
        }
      />
      <Feedback action={action} />
      {draft.notice}
      {published && (
        <p className="mt-3 border border-info-soft bg-info-soft p-3 text-sm">
          作业已发布。可以修改标题、说明、截止时间和指定学生；截止时间只能延后。
          {hasSubmissions
            ? "已有正式提交，题目、分值、顺序和奖励积分已固定。"
            : "尚无正式提交，可以调整题目、分值、顺序和奖励积分。"}
          {hasActivity
            ? "已有运行或提交记录，题目固定版本不可替换；有记录的学生不能从名单中移除。"
            : "尚无运行记录，可在检查后明确选择题库的新发布版本。"}
          <Link
            className={`${link} ml-2`}
            href={`/teacher/assignments/${saved?.id}/progress`}
          >
            管理单人延期与豁免
          </Link>
        </p>
      )}
      <section className={`${panel} mt-5 overflow-hidden`}>
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-surface-subtle px-3 pt-3">
          {assignmentTabs.map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`h-10 shrink-0 rounded-t-md border-x border-t px-4 text-sm font-semibold ${tab === item ? "border-border bg-surface text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="min-h-[520px] p-5">
          {tab === "Basic information" && (
            <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
              <Field label="Title">
                <input
                  required
                  value={title}
                  disabled={action.busy}
                  onChange={(e) => setTitle(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label="Course">
                <input
                  value={course}
                  disabled={action.busy}
                  onChange={(e) => setCourse(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label="Classes">
                <select
                  required
                  value={classId}
                  disabled={published || action.busy}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setParticipants(
                      classes.data?.items.find((x) => x.id === e.target.value)
                        ?.studentIds ?? [],
                    );
                  }}
                  className={input}
                >
                  <option value="">请选择班级</option>
                  {classes.data?.items.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Due time">
                <input
                  required
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
              <Field label="Teacher note">
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
                  <b className="text-sm">Selected problems</b>
                  <p className="text-xs text-muted-foreground">
                    {selected.length} 道题 · 作业总分 {total} 分 · 本作业额外奖励 {rewardTotal} / 100 积分。
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    每题首次正式 AC 默认奖励 10 积分（管理员可调整）；本作业额外奖励在此逐题设置，只有首次通过该作业题目时追加。
                  </p>
                  {rewardTotal > 100 && (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      本作业额外奖励合计最多 100 积分，请减少逐题奖励。
                    </p>
                  )}
                  {published && hasSubmissions && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      已有正式提交，不能调整本作业的题目、分值、顺序或奖励积分。
                    </p>
                  )}
                  {published && hasActivity && !hasSubmissions && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      已有运行记录，可调整题目、分值和奖励积分，但不能替换已固定的题目版本。
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button disabled={!canEditProblems || action.busy} onClick={() => setPicker(true)}>
                    <Plus size={15} />
                    从题库与分组选择
                  </Button>
                  <Link
                    href="/teacher/imports"
                    className={buttonVariants({ variant: "secondary" })}
                  >
                    <Upload size={15} />
                    导入题目
                  </Link>
                </div>
              </div>
              {versionError && (
                <p role="alert" className="mb-3 text-sm text-destructive">
                  {versionError}
                </p>
              )}
              <Table headers={["顺序", "题目", "接口", "作业分值", "首次 AC 积分", "本作业额外奖励", "操作"]}>
                {selected.map((p, i) => (
                  <tr key={p.problemId}>
                    <td>{i + 1}</td>
                    <td>
                      <Link
                        className={`${link} font-semibold`}
                        href={problemEditorHref(p)}
                      >
                        {p.title}
                      </Link>
                      {published && (
                        <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                          <p>本作业固定版本：{p.versionId?.slice(0, 8) ?? "未知"}</p>
                          <button
                            type="button"
                            className={link}
                            disabled={checkingVersion !== null}
                            onClick={() => void checkLatestVersion(p.problemId)}
                          >
                            {checkingVersion === p.problemId ? "正在检查…" : "检查题库最新版"}
                          </button>
                          {latestVersions[p.problemId] === null && (
                            <p>题库中没有可用的已发布版本。</p>
                          )}
                          {latestVersions[p.problemId] && (
                            <div className="flex flex-wrap items-center gap-2">
                              <span>
                                题库最新发布：{latestVersions[p.problemId]!.title} ·
                                {" "}{latestVersions[p.problemId]!.versionId.slice(0, 8)}
                              </span>
                              {latestVersions[p.problemId]!.versionId !== p.versionId ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={hasActivity || action.busy}
                                  onClick={() => setSelected((current) => current.map((item) =>
                                    item.problemId === p.problemId
                                      ? {
                                          ...item,
                                          versionId: latestVersions[p.problemId]!.versionId,
                                          title: latestVersions[p.problemId]!.title,
                                        }
                                      : item,
                                  ))}
                                >
                                  使用最新发布版本
                                </Button>
                              ) : (
                                <span>
                                  {saved?.problems.find((item) => item.problemId === p.problemId)?.versionId === p.versionId
                                    ? "已是最新版本"
                                    : "已选最新版，保存修改后生效"}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      {p.mode === "function"
                        ? "Function"
                        : p.mode === "stdio"
                          ? "Standard I/O"
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
                    <td>
                      <input
                        aria-label={`${p.title} 本作业额外奖励积分`}
                        type="number"
                        step={1}
                        min={0}
                        max={20}
                        disabled={!canEditProblems || action.busy}
                        className={`${input} w-24`}
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
                          onClick={() => setSelected(move(selected, i, -1))}
                        >
                          <ArrowUp size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="下移"
                          disabled={!canEditProblems || action.busy || i === selected.length - 1}
                          onClick={() => setSelected(move(selected, i, 1))}
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
                  <Empty columns={7}>从题库与分组选择已发布题目。</Empty>
                )}
              </Table>
            </>
          )}
          {tab === "Applicable list" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <b>作业发布对象</b>
                  <p className="text-xs text-muted-foreground">
                    已布置 {participants.length} 人 · 未布置{" "}
                    {Math.max(0, rosterTotal - participants.length - exemptStudentIds.size)} 人
                    {exemptStudentIds.size > 0 && ` · 已豁免 ${exemptStudentIds.size} 人`}
                    {" "}· 名单共 {rosterTotal} 人
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    仅勾选的学生会看到作业；未勾选的学生不会收到本次作业。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={action.busy || !students.length || (published && !saved?.protectedParticipantIds)}
                    onClick={() => setParticipants((current) => [...new Set([
                      ...current.filter((id) => protectedStudentIds.has(id) || historicalStudentIds.has(id)),
                      ...students.filter((student) => !exemptStudentIds.has(student.id)).map((student) => student.id),
                    ])])}
                  >
                    {exemptStudentIds.size ? "布置给全部可选学生" : "布置给全班"}
                  </Button>
                  {query.trim() && (
                    <Button
                      variant="secondary"
                      disabled={action.busy || (published && !saved?.protectedParticipantIds) || !shown.some((student) => !exemptStudentIds.has(student.id))}
                      onClick={() => setParticipants((current) => [...new Set([
                        ...current.filter((id) => protectedStudentIds.has(id) || historicalStudentIds.has(id)),
                        ...shown.filter((student) => !exemptStudentIds.has(student.id)).map((student) => student.id),
                      ])])}
                    >
                      仅布置给搜索结果
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    disabled={action.busy || (published && !saved?.protectedParticipantIds) || !participants.some((id) => !protectedStudentIds.has(id))}
                    onClick={() => setParticipants((current) => current.filter((id) => protectedStudentIds.has(id)))}
                  >
                    {protectedStudentIds.size ? "仅保留已有记录学生" : "清空名单"}
                  </Button>
                </div>
              </div>
              <input
                className={`${input} mt-4`}
                aria-label="搜索适用学生"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索学号或姓名"
              />
              <State resource={people} />
              <div className="mt-4 grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
                {shown.map((student) => (
                  <label
                    key={student.id}
                    className={`flex items-start gap-3 border p-3 text-sm ${participants.includes(student.id) ? "border-primary/40 bg-accent" : "border-border"}`}
                  >
                    <input
                      className="mt-1"
                      type="checkbox"
                      disabled={action.busy || exemptStudentIds.has(student.id) || (published && participants.includes(student.id) && (!saved?.protectedParticipantIds || protectedStudentIds.has(student.id)))}
                      checked={participants.includes(student.id)}
                      onChange={(e) =>
                        setParticipants((x) =>
                          e.target.checked
                            ? [...x, student.id]
                            : x.filter((id) => id !== student.id),
                        )
                      }
                    />
                    <span>
                      <b>{student.name}</b>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {student.number} · {classroom?.name}
                      </p>
                      {protectedStudentIds.has(student.id) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          已有运行或提交记录，不能从名单中移除
                        </p>
                      )}
                      {exemptStudentIds.has(student.id) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          已豁免，请在进度页恢复
                        </p>
                      )}
                      <span className="mt-2 inline-block">
                        <StatusPill
                          status={
                            exemptStudentIds.has(student.id)
                              ? "已豁免"
                              : participants.includes(student.id)
                              ? "已布置"
                              : "未布置"
                          }
                        />
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {historicalParticipants.length > 0 && (
                <section className="mt-5 border-t border-border pt-4">
                  <b className="text-sm">历史名单成员</b>
                  <p className="mt-1 text-xs text-muted-foreground">
                    这些学生已不在当前班级名单中。批量选择会保留其原有分配；如需移除无记录的学生，可逐个取消。
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
                    {historicalParticipants
                      .filter((person) => `${person.name} ${person.identityId}`.toLowerCase().includes(query.toLowerCase()))
                      .map((person) => (
                        <label key={person.identityId} className="flex items-start gap-3 border border-border p-3 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={participants.includes(person.identityId)}
                            disabled={action.busy || person.exempt || protectedStudentIds.has(person.identityId)}
                            onChange={(event) => setParticipants((current) =>
                              event.target.checked
                                ? [...current, person.identityId]
                                : current.filter((id) => id !== person.identityId),
                            )}
                          />
                          <span>
                            <b>{person.name}</b>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {person.exempt
                                ? "已豁免，请在进度页恢复"
                                : protectedStudentIds.has(person.identityId)
                                  ? "已有运行或提交记录，不能移出"
                                  : "不在当前班级名单"}
                            </p>
                          </span>
                        </label>
                      ))}
                  </div>
                </section>
              )}
              {!classId && (
                <p className="mt-4 text-sm text-muted-foreground">
                  先在 Basic information 中选择班级。
                </p>
              )}
              {classId && !participants.length && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  请至少勾选一名学生后再发布或保存修改。
                </p>
              )}
            </>
          )}
          {tab === "Rules" && <p className="mb-4 text-sm text-muted-foreground">以下为服务端固定规则，用于说明计分与提交策略，无需手动修改。</p>}
          {tab === "Rules" && (
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              {[
                ["Formal scoring", "Best score per assigned problem"],
                ["Corrections", "Shown separately"],
                ["Samples", "Do not affect score"],
                ["Hidden tests", "No raw input or answer shown"],
                ["System Error", "Not counted as zero"],
                ["Deadline", "以服务端正式接收时间为准"],
              ].map(([label, value]) => (
                <Metric key={label} label={label!} value={value} />
              ))}
            </div>
          )}
          {tab === "Preview" && (
            <div className="border border-border bg-surface-subtle p-5">
              <p className="text-xs font-semibold text-primary">
                Student preview
              </p>
              <h2 className="mt-1 text-xl font-bold">
                {title || "未命名作业"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {classroom?.name} · 向 {participants.length} 名学生布置 ·
                Due {due || "尚未设置"}
              </p>
              <p className="mt-4 whitespace-pre-wrap text-sm">{description}</p>
              <Table headers={["题目", "作业分值", "首次 AC 积分", "本作业额外奖励"]} min={400}>
                {selected.map((p) => (
                  <tr key={p.problemId}>
                    <td>
                      <Link href={problemEditorHref(p)} className={link}>
                        {p.title}
                      </Link>
                    </td>
                    <td>{p.points}</td>
                    <td>+{p.firstAcPoints}</td>
                    <td>+{p.rewardPoints}</td>
                  </tr>
                ))}
              </Table>
              <p className="mt-4 text-xs text-muted-foreground">
                只有已勾选的学生看到作业、截止时间和进度；公开样例运行不会改变作业成绩。
              </p>
            </div>
          )}
        </div>
      </section>
      {picker && (
        <ProblemPicker
          selected={selected.map((x) => x.problemId)}
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
                mode: p.mode,
                versionId: p.publishedVersionId ?? undefined,
              })),
            ]);
            setPicker(false);
          }}
        />
      )}
      {publish && (
        <Modal title="确认发布作业" onClose={() => setPublish(false)}>
          <p className="text-sm leading-6">
            向 {classroom?.name ?? "未选择班级"} 的 {participants.length}{" "}
            名适用学生发布 {selected.length} 道题，总分 {total} 分、额外奖励上限 {rewardTotal} 积分。
            发布时固定题目版本；未勾选的学生不会看到该作业。
          </p>
          <Feedback action={action} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPublish(false)}>
              取消
            </Button>
            <Button
              disabled={
                action.busy ||
                !participants.length ||
                !selected.length ||
                !title.trim() ||
                !due ||
                !classId
              }
              onClick={() =>
                void action.run(async () => {
                  validateActivity({title,classId,problems:selected,participants,publish:true});
                  if(Date.parse(activityDate(due,"截止时间"))<=Date.now())throw new Error("发布前请设置晚于当前时间的截止时间。");
                  const result = await save();
                  await productionApi(`assignments/${result.id}/publish`, {
                    method: "POST",
                    body: { expectedRevision: result.editRevision },
                  });
                  setPublish(false);
                  router.push(`/teacher/assignments/${result.id}/progress`);
                  return "作业已发布。";
                })
              }
            >
              确认发布
            </Button>
          </div>
        </Modal>
      )}
      {confirmUpdate && published && (
        <Modal title="确认修改已发布作业" onClose={() => setConfirmUpdate(false)}>
          <p className="text-sm leading-6">
            修改将立即影响已布置给 {participants.length} 名学生的作业。
            {changedProblems && "题目、分值、顺序或奖励积分有变更。"}
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
export function TeacherAssignmentProgress({ id }: { id: string }) {
  const [now,setNow] = useState(() => Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const resource = useData<TeacherAssignment>(`assignments/${id}`),
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
      x.problems.every((p) => p.status === "AC"),
    ).length,
    started = grades.filter((x) =>
      x.problems.some((p) => p.submissionId),
    ).length,
    exempt =
      assignment?.participantDetails?.filter((x) => x.exempt).length ?? 0;
  return (
    <>
      <Link
        href="/teacher/assignments"
        className={`${link} mb-4 inline-block text-sm`}
      >
        ← Assignment list
      </Link>
      <PageHeader
        eyebrow="作业进度"
        title={`${assignment?.title ?? "作业"} · Progress Matrix`}
        description={
          assignment
            ? `${grades.length} applicable students · Due ${date(assignment.dueAt)}. 订正记录不会覆盖作业原成绩。`
            : "正在读取学生进度。"
        }
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setManage(true)}>
              延期 / 豁免
            </Button>
            <Link
              href={`/teacher/assignments/${id}/edit`}
              className={buttonVariants({ variant: "secondary" })}
            >
              Edit assignment
            </Link>
          </div>
        }
      />
      <State resource={resource} />
      {assignment && (
        <>
          <div className="mt-5 grid grid-cols-6 gap-3 max-lg:grid-cols-3 max-sm:grid-cols-2">
            {[
              ["Complete", complete],
              ["In progress", started - complete],
              ["Not started", grades.length - started],
              ["Applicable", grades.length],
              ["Exempt", exempt],
              ["Problems", assignment.problems.length],
            ].map(([label, value]) => (
              <Metric key={label} label={String(label)} value={value} />
            ))}
          </div>
          <section className={`${panel} mt-5 overflow-hidden`}>
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-bold">Student progress matrix</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                固定学生列，横向滚动题目。成绩取截止前正式提交最高分；系统错误不记为学生答错。
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
                      Student
                    </th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Score</th>
                    {assignment.problems.map((p) => (
                      <th
                        key={p.problemId}
                        className="min-w-36 px-3 py-3 text-center"
                      >
                        <Link
                          className={link}
                          href={`/teacher/problems/${p.problemId}/edit?${new URLSearchParams({
                            returnTo: `/teacher/assignments/${id}/progress`,
                            ...(p.versionId ? { versionId: p.versionId } : {}),
                          }).toString()}`}
                        >
                          {p.title ?? p.problemId.slice(0, 8)}
                        </Link>
                        <p className="mt-1 font-normal">{p.points} pts</p>
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
                            student.problems.every((p) => p.status === "AC")
                              ? "Complete"
                              : student.problems.some((p) => p.submissionId)
                                ? "In progress"
                                : "Not started"
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
                        return (
                          <td
                            key={p.problemId}
                            className="border-l border-border text-center"
                          >
                            <button
                              onClick={() =>
                                setSelected({
                                  student,
                                  problemId: p.problemId,
                                  submissionId: cell?.submissionId ?? null,
                                })
                              }
                              className="min-h-16 w-full px-2 py-2 hover:bg-info-soft"
                            >
                              <b>{cell?.status ?? "—"}</b>
                              <p className="text-xs text-muted-foreground">
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
      {selected && (
        <TeacherSubmissionDrawer
          id={selected.submissionId}
          title={`${selected.student.name} · ${assignment?.problems.find((x) => x.problemId === selected.problemId)?.title ?? "题目"}`}
          studentId={selected.student.identityId}
          problemId={selected.problemId}
          onClose={() => setSelected(null)}
        />
      )}
      {manage && assignment && (
        <Modal title="作业延期与适用名单" onClose={() => setManage(false)} wide>
          <form
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void action.run(async () => {
                await productionApi(`assignments/${id}/extend`, {
                  method: "POST",
                  body: {
                    dueAt: new Date(String(d.get("dueAt"))).toISOString(),
                    reason: d.get("reason"),
                  },
                });
                resource.reload();
                return "截止时间已延后。";
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
              确认延期
            </Button>
          </form>
          <div className="mt-5 divide-y divide-border">
            {assignment.participantDetails?.map((p) => (
              <form
                key={p.identityId}
                className="flex flex-wrap items-center gap-3 py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  void action.run(async () => {
                    await productionApi(
                      `assignments/${id}/participants/${p.identityId}`,
                      {
                        method: "PATCH",
                        body: { exempt: !p.exempt, reason: d.get("reason") },
                      },
                    );
                    resource.reload();
                    return "参与状态已更新。";
                  });
                }}
              >
                <b className="text-sm">
                  {p.name} · {p.exempt ? "已豁免" : "参与中"}
                </b>
                <input
                  name="reason"
                  aria-label={`${p.name} 变更原因`}
                  placeholder="变更原因"
                  required
                  className={`${input} min-w-40 flex-1`}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    action.busy || new Date(assignment.dueAt).getTime() <= now
                  }
                >
                  {p.exempt ? "恢复参与" : "豁免本次作业"}
                </Button>
              </form>
            ))}
          </div>
          <Feedback action={action} />
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
        Code, correction & feedback
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
          <h3 className="mt-5 font-bold">Student note / Teacher feedback</h3>
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
                await productionApi("review-notebook", {
                  method: "POST",
                  body: { submissionId: id, note: d.get("note") },
                });
                form.reset();
                submission.reload();
                return "教师反馈已保存。";
              });
            }}
          >
            <Field label="Teacher feedback">
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
          <h3 className="mt-5 font-bold">Formal code</h3>
          <pre className="mt-3 max-h-96 overflow-auto rounded bg-code p-4 font-mono text-sm leading-6 text-code-foreground">
            {original.code}
          </pre>
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          该学生尚无这道题的正式提交。
        </p>
      )}
      <h3 className="mt-5 font-bold">Corrections</h3>
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
