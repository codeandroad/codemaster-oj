"use client";

import { AppLink as Link } from "@/components/navigation";
import { useEffect, useState } from "react";
import {activityDate,validateActivity,activeParticipants} from "./activity-validation";
import {useActivityDraft} from "./use-activity-draft";
import { useRouter } from "next/navigation";
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
  type Assignment,
  type Person,
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
            "Applicable",
            "Exempt",
            "Average / Status",
            "Actions",
          ]}
        >
          {assignments.data?.items.map((item) => (
            <tr key={item.id}>
              <td>
                <b>{item.title}</b>
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
                  {item.applicableCount ??
                    item.participantDetails?.filter((x) => !x.exempt).length ??
                    item.participants?.length ??
                    "—"}
                  /
                  {item.participantDetails?.length ??
                    (item.participants?.length ?? 0) + (item.exemptCount ?? 0)}
                </b>
              </td>
              <td>
                {item.exemptCount ??
                  item.participantDetails?.filter((x) => x.exempt).length ??
                  0}
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
                    {item.state === "Draft" ? "编辑" : "查看"}
                  </Link>
                  <Link
                    href={`/teacher/assignments/${item.id}/progress`}
                    className={link}
                  >
                    Matrix →
                  </Link>
                </div>
              </td>
            </tr>
          ))}
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
  mode?: string;
  versionId?: string;
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
          key={id}
          initial={id === "new" ? null : resource.data}
        />
      )}
    </>
  );
}
function AssignmentEditorForm({
  initial,userId,
}: {
  userId:string;
  initial: TeacherAssignment | null;
}) {
  const router = useRouter(),
    classes = useData<{ items: SchoolClass[] }>("classes"),
    people = useData<{ items: Person[] }>("people"),
    [tab, setTab] = useState(assignmentTabs[0]!),
    [saved, setSaved] = useState(initial),
    [title, setTitle] = useState(initial?.title ?? ""),
    [description, setDescription] = useState(initial?.description ?? ""),
    [course, setCourse] = useState(initial?.course ?? "Python"),
    [classId, setClassId] = useState(initial?.classId ?? ""),
    [due, setDue] = useState(localInput(initial?.dueAt)),
    [selected, setSelected] = useState<SelectedProblem[]>(
      initial?.problems.map((x) => ({ ...x, title: x.title ?? "题目" })) ?? [],
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
    action = useAction();
  const published = saved?.state !== "Draft" && Boolean(saved),
    classroom = classes.data?.items.find((x) => x.id === classId),
    students =
      people.data?.items.filter(
        (x) => x.kind === "student" && classroom?.studentIds.includes(x.id),
      ) ?? [],
    shown = students.filter((x) =>
      `${x.name} ${x.number}`.toLowerCase().includes(query.toLowerCase()),
    );
  const total = selected.reduce((sum, x) => sum + x.points, 0);
  const draft=useActivityDraft({storageKey:`campus-judge:activity-draft:v1:${userId}:assignment:${initial?.id??"new"}`,editable:!published,snapshot:{title,description,course,classId,due,problems:selected,participants},onRestore:v=>{setTitle(v.title);setDescription(v.description);setCourse(v.course);setClassId(v.classId);setDue(v.due);setSelected(v.problems);setParticipants(v.participants);}});
  useDirty(
    !published &&
      (title !== (saved?.title ?? "") ||
        course !== (saved?.course ?? "Python") ||
        description !== (saved?.description ?? "") ||
        classId !== (saved?.classId ?? "") ||
        due !== localInput(saved?.dueAt) ||
        JSON.stringify(
          selected.map((x) => ({ problemId: x.problemId, points: x.points })),
        ) !==
          JSON.stringify(
            (saved?.problems ?? []).map((x) => ({
              problemId: x.problemId,
              points: x.points,
            })),
          ) ||
        JSON.stringify([...participants].sort()) !==
          JSON.stringify(activeParticipants(saved?.participantDetails,saved?.participants ?? []).sort())),
  );
  const save = async () => {
    if (published)
      throw new Error(
        "已发布作业题目与分值已固定，请新建草稿。延期和豁免在进度页处理。",
      );
    validateActivity({title,classId,problems:selected,participants});
    const dueAt=activityDate(due,'截止时间');
    const result = await productionApi<TeacherAssignment>(
      saved ? `assignments/${saved.id}` : "assignments",
      {
        method: saved ? "PATCH" : "POST",
        body: {
          state: "Draft",
          title,
          classId,
          dueAt,
          description,
          course,
          problems: selected.map((x) => ({
            problemId: x.problemId,
            points: x.points,
          })),
          participants,
        },
      },
    );
    draft.clear();
    setSaved(result);
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
        description="基本信息、题目与分值、明确适用名单、规则与学生预览。"
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={action.busy || published}
              onClick={() =>
                void action.run(async () => {
                  await save();
                  return "作业草稿已保存。";
                })
              }
            >
              保存草稿
            </Button>
            <Button
              disabled={action.busy || published}
              onClick={() => setPublish(true)}
            >
              <Send size={15} />
              {published ? "已发布" : "发布作业"}
            </Button>
          </div>
        }
      />
      <Feedback action={action} />
      {draft.notice}
      {published && (
        <p className="mt-3 border border-info-soft bg-info-soft p-3 text-sm">
          作业已发布，题目版本与分值固定。
          <Link
            className={`${link} ml-2`}
            href={`/teacher/assignments/${saved?.id}/progress`}
          >
            维护延期与学生豁免
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
                  disabled={published || action.busy}
                  onChange={(e) => setTitle(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label="Course">
                <input
                  value={course}
                  disabled={published || action.busy}
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
                  disabled={published || action.busy}
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className={input}
                />
              </Field>
              <Field label="Teacher note">
                <textarea
                  disabled={published || action.busy}
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
                    {selected.length} problems · {total} pts total. Reorder,
                    edit points, or open the unified editor.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button disabled={published || action.busy} onClick={() => setPicker(true)}>
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
              <Table headers={["顺序", "题目", "接口", "分值", "操作"]}>
                {selected.map((p, i) => (
                  <tr key={p.problemId}>
                    <td>{i + 1}</td>
                    <td className="font-semibold">{p.title}</td>
                    <td>
                      {p.mode === "function" ? "Function" : "Standard I/O"}
                    </td>
                    <td>
                      <input
                        aria-label={`${p.title} 分值`}
                        type="number"
                        step="0.01"
                        min={0.01}
                        max={1000}
                        disabled={published || action.busy}
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
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="上移"
                          disabled={published || action.busy || i === 0}
                          onClick={() => setSelected(move(selected, i, -1))}
                        >
                          <ArrowUp size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="下移"
                          disabled={published || action.busy || i === selected.length - 1}
                          onClick={() => setSelected(move(selected, i, 1))}
                        >
                          <ArrowDown size={15} />
                        </Button>
                        <Link
                          className={`${link} mx-2`}
                          href={`/teacher/problems/${p.problemId}/edit?returnTo=${encodeURIComponent(saved ? `/teacher/assignments/${saved.id}/edit` : "/teacher/assignments/new/edit")}`}
                        >
                          <Pencil size={15} />
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="移除引用"
                          disabled={published || action.busy}
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
                  <Empty columns={5}>从题库与分组选择已发布题目。</Empty>
                )}
              </Table>
            </>
          )}
          {tab === "Applicable list" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <b>Applicable students</b>
                  <p className="text-xs text-muted-foreground">
                    Applicable {participants.length} · Exempt{" "}
                    {students.length - participants.length} · Total{" "}
                    {students.length}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={published || action.busy}
                    onClick={() => setParticipants(students.map((x) => x.id))}
                  >
                    选择全部
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={published || action.busy}
                    onClick={() => setParticipants([])}
                  >
                    清空选择
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
                      disabled={published || action.busy}
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
                      <span className="mt-2 inline-block">
                        <StatusPill
                          status={
                            participants.includes(student.id)
                              ? "Applicable"
                              : "Exempt"
                          }
                        />
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {!classId && (
                <p className="mt-4 text-sm text-muted-foreground">
                  先在 Basic information 中选择班级。
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
                {classroom?.name} · {participants.length} applicable students ·
                Due {due || "尚未设置"}
              </p>
              <p className="mt-4 whitespace-pre-wrap text-sm">{description}</p>
              <Table headers={["题目", "分值"]} min={400}>
                {selected.map((p) => (
                  <tr key={p.problemId}>
                    <td>{p.title}</td>
                    <td>{p.points}</td>
                  </tr>
                ))}
              </Table>
              <p className="mt-4 text-xs text-muted-foreground">
                学生看到自己的适用作业、截止时间和进度；公开样例运行不会改变作业成绩。
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
                mode: p.mode,
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
            名适用学生发布 {selected.length} 道题，总分 {total}
            。发布时固定题目版本，豁免学生看不到该作业。
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
                        {p.title ?? p.problemId.slice(0, 8)}
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
