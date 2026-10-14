"use client";

import { AppLink as Link } from "@/components/navigation";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CircleAlert, ClipboardList } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/page-chrome";
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
        eyebrow="教师工作台"
        title="Teacher Dashboard"
        description="查看负责班级、作业进度与需要跟进的学生。"
        action={
          active[0] && (
            <Link
              className={buttonVariants()}
              href={`/teacher/assignments/${active[0].id}/progress`}
            >
              Open progress matrix <ArrowRight size={15} />
            </Link>
          )
        }
      />
      <State resource={classes} />
      <State resource={assignments} />
      <div className="mt-5 grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <Metric
          label="Active classes"
          value={classes.data?.items.length ?? "—"}
          note={classes.data?.items.map((x) => x.name).join(", ")}
        />
        <Metric
          label="Open assignments"
          value={active.length}
          note="Cross-class list"
        />
        <Metric
          label="Needs follow-up"
          value={report.data?.metrics?.incomplete ?? "—"}
          note="未提交、未通过和待反馈"
        />
        <Metric
          label="Imports"
          value={imports.data?.items.length ?? "—"}
          note="已完成题目导入批次"
        />
      </div>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_360px] gap-6 max-lg:grid-cols-1">
        <section className={panel}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-bold">Assignments requiring attention</h2>
            <Link className={link} href="/teacher/assignments">
              Manage all
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
                    · Due {date(item.dueAt)}
                  </p>
                </div>
                <span className="flex items-center gap-2 text-sm text-primary">
                  Matrix <ArrowRight size={15} />
                </span>
              </Link>
            ))}
            {!active.length && (
              <p className="p-5 text-sm text-muted-foreground">
                暂无进行中的作业。通过 Assignment Management 新建作业。
              </p>
            )}
          </div>
        </section>
        <aside className="space-y-4">
          <section className={`${panel} p-5`}>
            <h2 className="flex items-center gap-2 font-bold">
              <CircleAlert size={17} className="text-warning" />
              Follow-up
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              按班级和活动查看未开始、反复未通过及待反馈记录。
            </p>
            <Link
              href="/teacher/reports"
              className={`${link} mt-4 inline-block text-sm`}
            >
              Open teaching reports
            </Link>
          </section>
          <section className={`${panel} p-5`}>
            <h2 className="flex items-center gap-2 font-bold">
              <ClipboardList size={17} className="text-primary" />
              Classroom actions
            </h2>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <Link className={link} href="/teacher/assignments/new/edit">
                New assignment
              </Link>
              <Link className={link} href="/teacher/classes">
                Classes & Students
              </Link>
              <Link className={link} href="/teacher/imports">
                Import Center
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

export function TeacherClasses({ user }: { user: CampusUser }) {
  const search = useSearchParams();
  const classes = useData<{ items: SchoolClass[] }>("classes"),
    people = useData<{ items: Person[] }>("people"),
    assignments = useData<{ items: TeacherAssignment[] }>("assignments");
  const [activeId, setActiveId] = useState(search.get("classId") ?? ""),
    [dialog, setDialog] = useState<"new" | "edit" | null>(null);
  useEffect(() => { const classId = search.get("classId"); if (classId) setActiveId(classId); }, [search]);
  const current =
    classes.data?.items.find((x) => x.id === activeId) ??
    classes.data?.items[0];
  const canManage=!!current&&(user.roles.includes("admin")||current.teacherIds.includes(user.identityId));
  const currentAssignment = assignments.data?.items.find(
    (x) => x.classId === current?.id && x.state !== "Draft",
  );
  const detail = useData<Assignment>(
    currentAssignment ? `assignments/${currentAssignment.id}` : null,
  );
  const action = useAction(),
    [code, setCode] = useState<{ name: string; activationCode: string } | null>(
      null,
    );
  return (
    <>
      <PageHeader
        eyebrow="班级与学生"
        title="班级与学生"
        description="按班级查看学生身份、账号激活状态与真实作业进度。"
        action={
          <div className="flex gap-2">
            <Button onClick={() => setDialog("new")}>新建班级</Button>
            <Link
              className={buttonVariants({ variant: "secondary" })}
              href={`/teacher/imports?kind=members${current ? `&classId=${current.id}` : ""}`}
            >
              导入名单
            </Link>
          </div>
        }
      />
      <div className="mt-5 flex flex-wrap gap-2">
        {[
          ["学习内容", "learning"],
          ["计时训练", "timed-practice"],
          ["教学报告", "reports"],
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
        <aside className="space-y-3" aria-label="班级列表">
          {classes.data?.items.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveId(item.id)}
              aria-pressed={item.id === current?.id}
              className={`block w-full border p-4 text-left panel-shadow ${item.id === current?.id ? "border-primary bg-info-soft" : "border-border bg-surface hover:border-primary/50"}`}
            >
              <div className="font-bold">{item.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {item.studentIds.length} students · {item.type ?? "Classroom"}
              </div>
            </button>
          ))}
          {!classes.loading &&
            !classes.error &&
            !classes.data?.items.length && (
              <section className={`${panel} p-5 text-sm text-muted-foreground`}>
                暂无班级。点击 New class 建立班级。
              </section>
            )}
        </aside>
        {current && (
          <section className={`${panel} self-start overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="font-bold">{current.name} · 学生名单</h2>
              <span className="text-xs text-muted-foreground">
                {current.studentIds.length} students ·{" "}
                {currentAssignment?.title ?? "尚未布置作业"}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canManage}
                  onClick={() => setDialog("edit")}
                  data-od-id="edit-class"
                >
                  编辑班级
                </Button>
              </div>
            </div>
            <State resource={detail} />
            <Table
              headers={[
                "Student ID",
                "Name",
                "性别",
                "Group",
                "Account",
                "Assignment status",
                "Score",
                "Progress",
              ]}
              min={840}
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
                      {student ? <Link
                        href={`/teacher/reports?${new URLSearchParams({ classId: current.id, studentId: id, studentName: student.name })}`}
                        className="font-semibold text-primary hover:underline focus-visible:underline"
                      >{student.name}</Link> : "加载中"}
                    </td>
                    <td className="text-muted-foreground">{genderLabel(student?.gender)}</td>
                    <td className="text-muted-foreground">—</td>
                    <td>
                      {student?.activated ? (
                        <span className="rounded bg-success-soft px-1.5 py-0.5 text-xs font-semibold text-success">
                          已激活
                        </span>
                      ) : (
                        <>
                          <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-semibold text-warning">
                            待激活
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
                                  name: student?.name ?? "学生",
                                  activationCode: result.activationCode,
                                });
                                return "新激活码已生成。旧码即刻失效。";
                              })
                            }
                          >
                            生成激活码
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      <StatusPill
                        status={
                          !attempted
                            ? "Not started"
                            : solved === grade?.problems.length
                              ? "Complete"
                              : "In progress"
                        }
                      />
                    </td>
                    <td className="font-semibold">
                      {grade?.score === null
                        ? "待评测"
                        : grade
                          ? `${grade.score} / ${grade.maxScore}`
                          : "—"}
                    </td>
                    <td className="text-muted-foreground">
                      {attempted} / {grade?.problems.length ?? 0} · {solved}{" "}
                      solved
                    </td>
                  </tr>
                );
              })}
              {!current.studentIds.length && (
                <Empty columns={8}>
                  该班级暂无学生。通过 Import members
                  导入名单，无账号的学生将建档并显示待激活。
                </Empty>
              )}
            </Table>
          </section>
        )}
      </div>
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
        <Modal title={`${code.name} · 激活码`} onClose={() => setCode(null)}>
          <p className="text-sm text-muted-foreground">
            请将学号和此激活码交给本人，激活后账号自动建立。
          </p>
          <p className="mt-4 break-all rounded border border-border bg-surface-subtle p-4 font-mono font-semibold">
            {code.activationCode}
          </p>
          <Button
            className="mt-4"
            onClick={() =>
              action.run(async () => {
                await navigator.clipboard.writeText(code.activationCode);
                return "激活码已复制。";
              })
            }
          >
            复制激活码
          </Button>
          <Feedback action={action} />
        </Modal>
      )}
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
      title={mode === "edit" ? `编辑班级与名单 · ${current?.name}` : "新建班级 / 学生集合"}
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            if(!name.trim())throw new Error("请输入班级名称。");
            if (
              existing.some(
                (x) => x.id !== current?.id && x.name.trim() === name.trim(),
              )
            )
              throw new Error("已存在同名班级。");
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
        <Field label="名称">
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
            placeholder="例如 高一3班 或 ACSL 集训组"
          />
        </Field>
        <Field label="说明（可选）">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={input}
          />
        </Field>
        <Field label="班级类型"><select aria-label="班级类型" value={type} onChange={e=>setType(e.target.value)} className={input}><option value="training">训练班</option><option value="administrative">行政班</option></select></Field>
        <div>
          <div className="flex justify-between text-sm">
            <b>从已有学生中选择（可选）</b>
            <span className="text-xs text-muted-foreground">
              已选 {selected.length}
            </span>
          </div>
          <input
            aria-label="搜索学生"
            className={`${input} mt-2`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索学号或姓名"
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
            学生仍保留在原班级。名单里没有账号的学生可通过 Import members
            先建档入班。
          </p>
        </div>
        <Feedback action={action} />
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={action.busy}>
            {mode === "edit" ? "保存班级与名单" : "创建班级"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
