"use client";

import { AppLink as Link } from "@/components/navigation";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CircleAlert, ClipboardList, UserRound } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { useLocale } from "@/components/locale-context";
import { genderLabel } from "@/lib/gender";
import {
  productionApi,
  type Assignment,
  type CampusUser,
  type Person,
  type SchoolClass,
} from "@/lib/production-api";
import {
  date,
  Empty,
  Feedback,
  Field,
  Drawer,
  input,
  link,
  Metric,
  Modal,
  panel,
  State,
  Table,
  useAction,
  useData,
} from "./shared";

export type TeacherAssignment = Assignment & {
  archived?: boolean;
  state?: string;
  description?: string;
  course?: string;
  applicableCount?: number;
  exemptCount?: number;
  averagePercent?: number | null;
  className?: string;
  published?: boolean;
  hasSubmissions?: boolean;
  hasActivity?: boolean;
  protectedParticipantIds?: string[];
  editRevision?: number;
};
export function TeacherDashboard() {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const classes = useData<{ items: SchoolClass[] }>("classes"),
    assignments = useData<{ items: TeacherAssignment[] }>("assignments");
  const report = useData<{
    metrics?: {
      incomplete: number;
      waitingFeedback: number;
      repeatedFailures: number;
    };
    submissions?: {
      id: string;
      studentName: string;
      status: string;
      problemId: string;
    }[];
    students?: {
      assignments: {
        id: string;
        score: number | null;
        maxScore: number;
        problems: { status: string; submissionId: string | null }[];
      }[];
    }[];
  }>("reports");
  const imports = useData<{ items: { id: string }[] }>("problems/import");
  const [now] = useState(() => Date.now());
  const active =
    assignments.data?.items.filter(
      (item) => item.state !== "Draft" && new Date(item.dueAt).getTime() > now,
    ) ?? [];
  return (
    <>
      <PageHeader
        eyebrow={tx("教师工作台", "Teacher workspace")}
        title={tx("教学工作台", "Teacher dashboard")}
        description={tx("查看负责班级、作业进度与需要跟进的学生。", "Review classes, assignments, and students who need follow-up.")}
        action={
          active[0] && (
            <Link
              className={buttonVariants()}
              href={`/teacher/assignments/${active[0].id}/progress`}
            >
              {tx("查看作业进度", "View assignment progress")} <ArrowRight size={15} />
            </Link>
          )
        }
      />
      <State resource={classes} />
      <State resource={assignments} />
      <div className="mt-5 grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <Metric
          label={tx("负责班级", "Classes")}
          value={classes.data?.items.length ?? "—"}
          note={classes.data?.items.map((x) => x.name).join(", ")}
        />
        <Metric
          label={tx("进行中的作业", "Open assignments")}
          value={active.length}
          note={tx("跨班级汇总", "Across classes")}
        />
        <Metric
          label={tx("待跟进", "Needs follow-up")}
          value={report.data?.metrics?.incomplete ?? "—"}
          note={tx("未提交、未通过和待反馈", "Missing, unsuccessful, and awaiting feedback")}
        />
        <Metric
          label={tx("题目导入", "Problem imports")}
          value={imports.data?.items.length ?? "—"}
          note={tx("已完成题目导入批次", "Completed import batches")}
        />
      </div>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_360px] gap-6 max-lg:grid-cols-1">
        <section className={panel}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-bold">{tx("需关注的作业", "Assignments needing attention")}</h2>
            <Link className={link} href="/teacher/assignments">
              {tx("查看全部", "View all")}
            </Link>
          </div>
          <div className="divide-y divide-border">
            {active.map((item) => (
              <Link
                key={item.id}
                href={`/teacher/assignments/${item.id}/progress`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-surface-subtle"
              >
                <div>
                  <b>{item.title}</b>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.className ??
                      classes.data?.items.find((x) => x.id === item.classId)
                        ?.name}{" "}
                    · {tx("截止", "Due")} {date(item.dueAt)}
                  </p>
                </div>
                <span className="flex items-center gap-2 text-sm text-primary">
                  {tx("查看进度", "View progress")} <ArrowRight size={15} />
                </span>
              </Link>
            ))}
            {!active.length && (
              <p className="p-5 text-sm text-muted-foreground">
                {tx("暂无进行中的作业。可在作业管理中布置新作业。", "No open assignments. Create one in Assignment management.")}
              </p>
            )}
          </div>
        </section>
        <aside className="space-y-4">
          <section className={`${panel} p-5`}>
            <h2 className="flex items-center gap-2 font-bold">
              <CircleAlert size={17} className="text-warning" />
              {tx("待跟进", "Follow-up")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {tx("按班级和活动查看未开始、反复未通过及待反馈记录。", "Review missing starts, repeated failures, and pending feedback by class and activity.")}
            </p>
            <Link
              href="/teacher/reports"
              className={`${link} mt-4 inline-block text-sm`}
            >
              {tx("查看教学报告", "Open teaching reports")}
            </Link>
          </section>
          <section className={`${panel} p-5`}>
            <h2 className="flex items-center gap-2 font-bold">
              <ClipboardList size={17} className="text-primary" />
              {tx("常用操作", "Classroom actions")}
            </h2>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <Link className={link} href="/teacher/assignments/new/edit">
                {tx("新建作业", "New assignment")}
              </Link>
              <Link className={link} href="/teacher/classes">
                {tx("班级与学生", "Classes & students")}
              </Link>
              <Link className={link} href="/teacher/imports">
                {tx("导入中心", "Import center")}
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

export function TeacherClasses({ user }: { user: CampusUser }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const search = useSearchParams();
  const classIdFromQuery = search.get("classId");
  const [showArchived,setShowArchived]=useState(false);
  const classes = useData<{ items: (SchoolClass & {archived?:boolean})[] }>(showArchived?"classes?archived=true":"classes"),
    people = useData<{ items: Person[] }>("people"),
    assignments = useData<{ items: TeacherAssignment[] }>("assignments");
  const [activeId, setActiveId] = useState(classIdFromQuery ?? ""),
    [dialog, setDialog] = useState<"new" | "edit" | null>(null),
    [archiveTarget,setArchiveTarget]=useState<"archive"|"restore"|null>(null),
    [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  useEffect(() => { if (classIdFromQuery) setActiveId(classIdFromQuery); }, [classIdFromQuery]);
  const current =
    classes.data?.items.find((x) => x.id === activeId && !!x.archived===showArchived) ??
    classes.data?.items.find((x)=>!!x.archived===showArchived);
  const canManage=!!current&&(user.roles.includes("admin")||current.teacherIds.includes(user.identityId));
  const currentAssignment = assignments.data?.items.find(
    (x) => (x.classIds ?? (x.classId ? [x.classId] : [])).includes(current?.id ?? "") && x.state !== "Draft",
  );
  const detail = useData<Assignment>(
    currentAssignment ? `assignments/${currentAssignment.id}` : null,
  );
  const selectedStudent = current?.studentIds.includes(selectedStudentId ?? "")
    ? people.data?.items.find((person) => person.id === selectedStudentId)
    : undefined;
  const assignmentDetail = detail.data;
  const selectedGrade = assignmentDetail && assignmentDetail.id === currentAssignment?.id
    ? assignmentDetail.grades?.find((grade) => grade.identityId === selectedStudentId)
    : undefined;
  const selectedAttempted = selectedGrade?.problems.filter((problem) => Boolean(problem.submissionId)).length ?? 0;
  const selectedSolved = selectedGrade?.problems.filter((problem) => problem.status === "AC").length ?? 0;
  const action = useAction(),
    [code, setCode] = useState<{ name: string; activationCode: string } | null>(
      null,
    );
  return (
    <>
      <PageHeader
        eyebrow={tx("班级与学生", "Classes & students")}
        title={tx("班级与学生", "Classes & students")}
        description={tx("按班级查看学生身份、账号激活状态与真实作业进度。", "Review student identities, account activation, and actual assignment progress by class.")}
        action={
          <div className="flex gap-2">
            <Button onClick={() => setDialog("new")}>{tx("新建班级", "New class")}</Button>
            <Link
              className={buttonVariants({ variant: "secondary" })}
              href={`/teacher/imports?kind=students${current ? `&classId=${current.id}` : ""}`}
            >
              {tx("导入名单", "Import roster")}
            </Link>
          </div>
        }
      />
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant={showArchived?"secondary":"default"} aria-pressed={!showArchived} onClick={()=>{setShowArchived(false);setActiveId("");setSelectedStudentId(null);}}>{tx("使用中", "Active")}</Button>
        <Button variant={showArchived?"default":"secondary"} aria-pressed={showArchived} onClick={()=>{setShowArchived(true);setActiveId("");setSelectedStudentId(null);}}>{tx("已归档", "Archived")}</Button>
        {[
          [tx("课程", "Courses"), "courses"],
          [tx("限时训练", "Timed practice"), "timed-practice"],
          [tx("教学报告", "Teaching reports"), "reports"],
        ].map(([name, path]) => (
          <Link
            key={path}
            className={buttonVariants({ variant: "secondary" })}
            href={`/teacher/${path}`}
          >
            {name}
          </Link>
        ))}
      </div>
      <State resource={classes} />
      <State resource={people} />
      <Feedback action={action} />
      <div className="mt-5 grid grid-cols-[300px_minmax(0,1fr)] gap-6 max-md:grid-cols-1">
        <aside className="space-y-3" aria-label={tx("班级列表", "Class list")}>
          {classes.data?.items.map((item) => (
            <button
              key={item.id}
              onClick={() => { setActiveId(item.id); setSelectedStudentId(null); }}
              aria-pressed={item.id === current?.id}
              className={`block w-full border p-4 text-left panel-shadow ${item.id === current?.id ? "border-primary bg-info-soft" : "border-border bg-surface hover:border-primary/50"}`}
            >
              <div className="font-bold">{item.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {item.studentIds.length} {tx("名学生", "students")} · {item.type === "administrative" ? tx("行政班", "Administrative class") : tx("训练班", "Training class")}
              </div>
            </button>
          ))}
          {!classes.loading &&
            !classes.error &&
            !classes.data?.items.length && (
              <section className={`${panel} p-5 text-sm text-muted-foreground`}>
                {showArchived?tx("暂无已归档班级。", "No archived classes."):tx("暂无班级。点击“新建班级”开始。", "No classes yet. Select New class to begin.")}
              </section>
            )}
        </aside>
        {current && (
          <section className={`${panel} self-start overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="font-bold">{current.name} · {tx("学生名单", "Student roster")}</h2>
              <span className="text-xs text-muted-foreground">
                {current.studentIds.length} {tx("名学生", "students")} ·{" "}
                {currentAssignment?.title ?? tx("尚未布置作业", "No assignment yet")}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canManage||showArchived}
                  onClick={() => setDialog("edit")}
                  data-od-id="edit-class"
                >
                  {tx("编辑班级", "Edit class")}
                </Button>
                {canManage&&<Button size="sm" variant="secondary" disabled={action.busy} onClick={()=>setArchiveTarget(showArchived?"restore":"archive")}>{showArchived?tx("恢复班级", "Restore class"):tx("归档班级", "Archive class")}</Button>}
              </div>
            </div>
            <State resource={detail} />
            <Table
              headers={[
                tx("学号", "Student ID"),
                tx("姓名", "Name"),
                tx("性别", "Gender"),
                tx("账号状态", "Account"),
                tx("作业状态", "Assignment status"),
                tx("得分", "Score"),
                tx("进度", "Progress"),
              ]}
              min={760}
            >
              {current.studentIds.map((id) => {
                const student = people.data?.items.find((x) => x.id === id),
                  grade = detail.data?.grades?.find((x) => x.identityId === id),
                  attempted =
                    grade?.problems.filter((x) => !!x.submissionId).length ?? 0,
                  solved =
                    grade?.problems.filter((x) => x.status === "AC").length ??
                    0;
                return (
                  <tr key={id}>
                    <td className="font-mono text-xs">
                      {student?.number ?? "—"}
                    </td>
                    <td>
                      {student ? <button
                        type="button"
                        onClick={() => setSelectedStudentId(id)}
                        aria-haspopup="dialog"
                        className="rounded-sm text-left font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >{student.name}</button> : tx("加载中", "Loading")}
                    </td>
                    <td className="text-muted-foreground">{locale === "en" ? ({male:"Male",female:"Female",other:"Other",undisclosed:"Prefer not to say"} as Record<string,string>)[student?.gender ?? ""] ?? "Not provided" : genderLabel(student?.gender)}</td>
                    <td>
                      {student?.activated ? (
                        <span className="rounded bg-success-soft px-1.5 py-0.5 text-xs font-semibold text-success">
                          {tx("已激活", "Active")}
                        </span>
                      ) : (
                        <>
                          <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-semibold text-warning">
                            {tx("待激活", "Pending")}
                          </span>
                          <button
                            className={`${link} ml-2 text-xs`}
                            disabled={action.busy}
                            onClick={() =>
                              action.run(async () => {
                                const result = await productionApi<{
                                  activationCode: string;
                                }>(`people/${id}/activation`, {
                                  method: "POST",
                                  body: {},
                                });
                                setCode({
                                  name: student?.name ?? tx("学生", "Student"),
                                  activationCode: result.activationCode,
                                });
                                return tx("新激活码已生成。旧码即刻失效。", "A new activation code was issued. The old code is now invalid.");
                              })
                            }
                          >
                            {tx("生成激活码", "Issue activation code")}
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      <StatusPill
                        status={
                          !attempted
                            ? tx("未开始", "Not started")
                            : solved === grade?.problems.length
                              ? tx("完成", "Completed")
                              : tx("进行中", "In progress")
                        }
                      />
                    </td>
                    <td className="font-semibold">
                      {grade?.score === null
                        ? tx("待评测", "Pending judging")
                        : grade
                          ? `${grade.score} / ${grade.maxScore}`
                          : "—"}
                    </td>
                    <td className="text-muted-foreground">
                      {attempted} / {grade?.problems.length ?? 0} · {solved}{" "}
                      {tx("已解出", "solved")}
                    </td>
                  </tr>
                );
              })}
              {!current.studentIds.length && (
                <Empty columns={7}>
                  {tx("该班级暂无学生。可通过“导入名单”建档入班；学生本人使用激活码认领后创建账号。", "This class has no students. Import a roster to create identities; students create accounts when they claim an activation code.")}
                </Empty>
              )}
            </Table>
          </section>
        )}
      </div>
      {selectedStudent && current && (
        <Drawer title={`${tx("学生详情", "Student details")} · ${selectedStudent.name}`} onClose={() => setSelectedStudentId(null)}>
          <dl className="grid grid-cols-[minmax(90px,auto)_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm">
            <dt className="text-muted-foreground">{tx("学号", "Student ID")}</dt>
            <dd className="font-mono font-semibold">{selectedStudent.number}</dd>
            <dt className="text-muted-foreground">{tx("性别", "Gender")}</dt>
            <dd>{locale === "en" ? ({ male: "Male", female: "Female", other: "Other", undisclosed: "Prefer not to say" } as Record<string, string>)[selectedStudent.gender ?? ""] ?? "Not provided" : genderLabel(selectedStudent.gender)}</dd>
            <dt className="text-muted-foreground">{tx("班级", "Class")}</dt>
            <dd className="min-w-0 break-words font-semibold">{current.name}</dd>
            <dt className="text-muted-foreground">{tx("账号状态", "Account status")}</dt>
            <dd>{selectedStudent.activated ? tx("已激活", "Active") : tx("待激活", "Pending activation")}</dd>
          </dl>
          <div className="mt-5 border-t border-border pt-5">
            <h3 className="font-bold">{tx("当前作业", "Current assignment")}</h3>
            {currentAssignment ? (
              <div className="mt-3 rounded-md border border-border bg-surface-subtle p-4 text-sm">
                <p className="font-semibold">{currentAssignment.title}</p>
                {selectedGrade ? <p className="mt-2 text-muted-foreground">
                  {tx("进度", "Progress")} {selectedAttempted} / {selectedGrade.problems.length} · {selectedSolved} {tx("题已解出", "solved")}
                  {" · "}{tx("得分", "Score")} {selectedGrade.score === null ? tx("待评测", "Pending judging") : `${selectedGrade.score} / ${selectedGrade.maxScore}`}
                </p> : <p className="mt-2 text-muted-foreground">{detail.loading ? tx("正在加载进度…", "Loading progress…") : detail.error ? tx("暂时无法读取进度。", "Progress is temporarily unavailable.") : tx("该作业未布置给这名学生。", "This assignment was not assigned to this student.")}</p>}
              </div>
            ) : <p className="mt-3 text-sm text-muted-foreground">{tx("该班级暂无已发布作业。", "No published assignment for this class yet.")}</p>}
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
            {selectedStudent.activated ? (
              <Link
                href={`/teacher/people/${encodeURIComponent(selectedStudent.id)}?${new URLSearchParams({ from: "classes", classId: current.id })}`}
                className={buttonVariants()}
              >
                <UserRound size={16} /> {tx("查看学生主页", "View student profile")}
              </Link>
            ) : (
              <p className="w-full text-sm text-muted-foreground">{tx("学生激活账号后，才能访问其公开主页。", "The public profile becomes available after the student activates an account.")}</p>
            )}
            <Link
              href={`/teacher/reports?${new URLSearchParams({ classId: current.id, studentId: selectedStudent.id, studentName: selectedStudent.name })}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              {tx("查看教学报告", "View teaching report")}
            </Link>
          </div>
        </Drawer>
      )}
      {dialog && (
        <ClassDialog
          existing={classes.data?.items ?? []}
          people={people.data?.items ?? []}
          user={user}
          current={dialog === "edit" ? current : undefined}
          mode={dialog}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            classes.reload();
            people.reload();
            setActiveId(id);
            setDialog(null);
          }}
        />
      )}
      {code && (
        <Modal title={`${code.name} · ${tx("激活码", "Activation code")}`} onClose={() => setCode(null)}>
          <p className="text-sm text-muted-foreground">
            {tx("请将学号和此激活码交给本人，激活后账号自动建立。", "Give the student their ID and activation code privately. They create an account when claiming it.")}
          </p>
          <p className="mt-4 break-all rounded border border-border bg-surface-subtle p-4 font-mono font-semibold">
            {code.activationCode}
          </p>
          <Button
            className="mt-4"
            onClick={() =>
              action.run(async () => {
                await navigator.clipboard.writeText(code.activationCode);
                return tx("激活码已复制。", "Activation code copied.");
              })
            }
          >
            {tx("复制激活码", "Copy activation code")}
          </Button>
          <Feedback action={action} />
        </Modal>
      )}
      {archiveTarget&&current&&<Modal title={archiveTarget==="archive"?tx("归档班级", "Archive class"):tx("恢复班级", "Restore class")} onClose={()=>setArchiveTarget(null)}>
        <p className="text-sm text-muted-foreground">{archiveTarget==="archive"?tx("归档后班级将移出使用中列表。请先归档此班级的作业和限时训练；名单、成绩及提交记录会保留。", "Archive assignments and timed practices first. The roster, grades, and submissions will be preserved."):tx("恢复班级后，可继续维护学生名单和教学活动。", "Restoring the class makes its roster and activities manageable again.")}</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={()=>setArchiveTarget(null)}>{tx("取消", "Cancel")}</Button><Button disabled={action.busy} onClick={()=>void action.run(async()=>{await productionApi(`classes/${current.id}/${archiveTarget}`,{method:"POST",body:{}});setArchiveTarget(null);setActiveId("");classes.reload();return archiveTarget==="archive"?tx("班级已归档。", "Class archived."):tx("班级已恢复。", "Class restored.");})}>{archiveTarget==="archive"?tx("确认归档", "Archive"):tx("确认恢复", "Restore")}</Button></div>
      </Modal>}
    </>
  );
}
function ClassDialog({
  mode,
  existing,
  people,
  user,
  current,
  onClose,
  onSaved,
}: {
  mode: "new" | "edit";
  existing: SchoolClass[];
  people: Person[];
  user: CampusUser;
  current?: SchoolClass | undefined;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [name, setName] = useState(current?.name ?? ""),
    [description, setDescription] = useState(
      (current as SchoolClass & { description?: string })?.description ?? "",
    ),
    [type,setType]=useState(current?.type??"training"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(current?.studentIds ?? []),
    action = useAction();
  const shown = people.filter(
    (x) =>
      x.kind === "student" &&
      `${x.number} ${x.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Modal
      title={mode === "edit" ? `${tx("编辑班级与名单", "Edit class and roster")} · ${current?.name}` : tx("新建班级", "New class")}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            if(!name.trim())throw new Error(tx("请输入班级名称。", "Enter a class name."));
            if (
              existing.some(
                (x) => x.id !== current?.id && x.name.trim() === name.trim(),
              )
            )
              throw new Error(tx("已存在同名班级。", "A class with this name already exists."));
            const membershipChanged =
              !current ||
              selected.length !== current.studentIds.length ||
              selected.some((id) => !current.studentIds.includes(id));
            const result = await productionApi<SchoolClass>(
              current ? `classes/${current.id}` : "classes",
              {
                method: current ? "PATCH" : "POST",
                body: {
                  name: name.trim(),
                  description,
                  type,
                  ...(membershipChanged ? { studentIds: selected } : {}),
                  ...(!current && user.roles.includes("teacher") ? { teacherIds: [user.identityId] } : {}),
                },
              },
            );
            onSaved(result.id);
          });
        }}
      >
        <Field label={tx("名称", "Name")}>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
            placeholder={tx("例如 高一3班 或 ACSL 集训组", "For example, Grade 10 Class 3 or ACSL Training")}
          />
        </Field>
        <Field label={tx("说明（可选）", "Description (optional)")}>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={input}
          />
        </Field>
        <Field label={tx("班级类型", "Class type")}><select aria-label={tx("班级类型", "Class type")} value={type} onChange={e=>setType(e.target.value)} className={input}><option value="training">{tx("训练班", "Training class")}</option><option value="administrative">{tx("行政班", "Administrative class")}</option></select></Field>
        <div>
          <div className="flex justify-between text-sm">
            <b>{tx("从已有学生中选择（可选）", "Select existing students (optional)")}</b>
            <span className="text-xs text-muted-foreground">
              {tx("已选", "Selected")} {selected.length}
            </span>
          </div>
          <input
            aria-label={tx("搜索学生", "Search students")}
            className={`${input} mt-2`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tx("搜索学号或姓名", "Search student ID or name")}
          />
          <div className="mt-2 max-h-56 overflow-auto rounded-md border border-border">
            {shown.map((student) => (
              <label
                key={student.id}
                className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(student.id)}
                  onChange={(e) =>
                    setSelected((x) =>
                      e.target.checked
                        ? [...x, student.id]
                        : x.filter((id) => id !== student.id),
                    )
                  }
                />
                <span className="font-mono text-xs">{student.number}</span>
                <b>{student.name}</b>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {tx("学生仍保留在原班级。名单中没有的学生可通过“导入名单”先建档入班。", "Students keep their other class memberships. Use Import roster to create identities for students not listed here.")}
          </p>
        </div>
        <Feedback action={action} />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" type="button" onClick={onClose}>
            {tx("取消", "Cancel")}
          </Button>
          <Button type="submit" disabled={action.busy}>
            {mode === "edit" ? tx("保存班级与名单", "Save class and roster") : tx("创建班级", "Create class")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
