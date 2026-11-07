"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Upload, UserPlus } from "lucide-react";
import { Loading, panelClass, useData } from "@/components/admin/common";
import { Table } from "@/components/teacher/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { SchoolIdentityImport } from "./school-identity-import";
import {
  SchoolClassEditor,
  SchoolClassRosterPicker,
  SchoolClassAction,
} from "./school-class-dialogs";
import { useSchoolText, type School } from "./school-ui";
import { schoolClassHref, schoolClassLocation } from "./school-class-location";

export type SchoolClassRecord = {
  id: string;
  name: string;
  type: "administrative" | "training";
  archived: boolean;
  revision: number;
  studentCount: number;
  teachers: { id: string; name: string }[];
  canManage: boolean;
};
type ClassPage = {
  items: SchoolClassRecord[];
  page: number;
  hasMore: boolean;
  canCreate: boolean;
  archived: boolean;
};
type RosterIdentity = {
  id: string;
  name: string;
  kind: "student" | "teacher";
  number?: string;
  accountLinked?: boolean;
  accountStatus?: "active" | "disabled" | "unlinked";
};
type RosterPage = { items: RosterIdentity[]; page: number; hasMore: boolean };

// Matches the existing teacher Classes workspace: class cards stay visible while
// its selected roster changes. Authorization remains in the school API.
export function SchoolClasses({
  school,
  refreshRevision = 0,
}: {
  school: School;
  refreshRevision?: number;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { archived, page, classId: activeId } = schoolClassLocation(searchParams);
  const [revision, setRevision] = useState(0);
  const navigate = (change: Parameters<typeof schoolClassHref>[2]) =>
    router.push(schoolClassHref(searchParams, school.id, change), { scroll: false });
  return (
    <SchoolClassList
      key={`${school.id}:${activeId}:${archived}:${page}:${revision}:${refreshRevision}`}
      school={school}
      archived={archived}
      page={page}
      onPage={(value) => navigate({ page: value, classId: "" })}
      activeId={activeId}
      onSelect={(id) => navigate({ classId: id })}
      onFilter={(value) => {
        navigate({ archived: value, page: 1, classId: "" });
      }}
      onRefresh={(id, created) => {
        if (id) navigate({ classId: id, ...(created ? { archived: false, page: 1 } : {}) });
        setRevision((value) => value + 1);
      }}
    />
  );
}

function SchoolClassList({
  school,
  archived,
  page,
  onPage,
  activeId,
  onSelect,
  onFilter,
  onRefresh,
}: {
  school: School;
  archived: boolean;
  page: number;
  onPage: (page: number) => void;
  activeId: string;
  onSelect: (id: string) => void;
  onFilter: (archived: boolean) => void;
  onRefresh: (id?: string, created?: boolean) => void;
}) {
  const text = useSchoolText();
  const searchParams = useSearchParams();
  const router = useRouter();
  const base = `schools/${school.id}`;
  const resource = useData<ClassPage>(
    `${base}/classes?archived=${archived}&page=${page}${activeId ? `&classId=${encodeURIComponent(activeId)}` : ""}`,
  );
  useEffect(() => {
    if (!resource.data || resource.error || !activeId) return;
    if (resource.data.page !== page || resource.data.archived !== archived) {
      router.replace(schoolClassHref(searchParams, school.id, {
        page: resource.data.page, archived: resource.data.archived, classId: activeId,
      }), { scroll: false });
    }
  }, [resource.data, resource.error, activeId, page, archived, router, searchParams, school.id]);
  const staff =
    school.roles.includes("teacher") || school.roles.includes("school_admin");
  const admin = school.roles.includes("school_admin");
  const current = activeId
    ? resource.data?.items.find((item) => item.id === activeId)
    : resource.data?.items[0];
  const [editing, setEditing] = useState<SchoolClassRecord | "new" | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div
          className="flex min-w-0 max-w-full flex-wrap gap-2"
          role="group"
          aria-label={text("Class status", "班级状态")}
        >
          <Button
            size="sm"
            variant={archived ? "secondary" : "primary"}
            aria-pressed={!archived}
            onClick={() => onFilter(false)}
          >
            {text("Active", "使用中")}
          </Button>
          {staff && (
            <Button
              size="sm"
              variant={archived ? "primary" : "secondary"}
              aria-pressed={archived}
              onClick={() => onFilter(true)}
            >
              {text("Archived", "已归档")}
            </Button>
          )}
          <Link
            className={buttonVariants({ size: "sm", variant: "secondary" })}
            href={`/schools?schoolId=${school.id}&section=courses`}
          >
            {text("Courses", "课程")}
          </Link>
        </div>
        {staff && (
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!resource.data?.canCreate}
              onClick={() => setEditing("new")}
            >
              <Plus size={15} />
              {text("New class", "新建班级")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!current?.canManage || current.archived}
              onClick={() => setImporting(true)}
            >
              <Upload size={15} />
              {text("Import roster", "导入名单")}
            </Button>
          </div>
        )}
      </div>
      {staff && !admin && resource.data && !resource.data.canCreate && (
        <p className="text-sm text-muted-foreground">
          {text(
            "Ask your school administrator to link your teacher identity before creating a class.",
            "请先联系学校管理员关联你的教师档案，再新建班级。",
          )}
        </p>
      )}
      <Loading resource={resource}>
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside
            className="space-y-3"
            aria-label={text("Class list", "班级列表")}
          >
            {resource.data?.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-pressed={item.id === current?.id}
                className={`block w-full border p-4 text-left panel-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${item.id === current?.id ? "border-primary bg-info-soft" : "border-border bg-surface hover:border-primary/50"}`}
              >
                <span className="block break-words font-bold">{item.name}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {item.studentCount} {text("students", "名学生")} ·{" "}
                  {item.type === "administrative"
                    ? text("Administrative class", "行政班")
                    : text("Training class", "训练班")}
                </span>
              </button>
            ))}
            {!resource.data?.items.length && (
              <p className={`${panelClass} p-5 text-sm text-muted-foreground`}>
                {archived
                  ? text("No archived classes.", "暂无已归档班级。")
                  : admin
                    ? text(
                        "No classes yet. Create a class to get started.",
                        "暂无班级，请先新建班级。",
                      )
                    : staff
                      ? text(
                          "No classes are assigned to you yet.",
                          "你还没有负责的班级。",
                        )
                      : text(
                          "You have not been added to a class yet.",
                          "你还没有加入班级。",
                        )}
              </p>
            )}
            {(page > 1 || resource.data?.hasMore) && (
              <ClassPagination
                page={page}
                hasMore={Boolean(resource.data?.hasMore)}
                onPage={onPage}
              />
            )}
          </aside>
          {current ? (
            <SchoolClassRoster
              key={current.id}
              school={school}
              item={current}
              staff={staff}
              admin={admin}
              onEdit={() => setEditing(current)}
              onRefresh={() => onRefresh(current.id)}
            />
          ) : (
            <section
              className={`${panelClass} p-6 text-sm text-muted-foreground`}
            >
              {text(
                activeId ? "This class is not available in your school workspace." : "Select a class to view its student roster.",
                activeId ? "当前学校工作区无法访问此班级。" : "选择班级后查看学生名单。",
              )}
            </section>
          )}
        </div>
      </Loading>
      {editing && (
        <SchoolClassEditor
          school={school}
          item={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => onRefresh(id, editing === "new")}
        />
      )}
      {importing && current && (
        <SchoolIdentityImport
          school={school}
          initialClass={current}
          studentClassOnly={!admin}
          onClose={() => setImporting(false)}
          onSaved={() => onRefresh(current.id)}
        />
      )}
    </div>
  );
}

function SchoolClassRoster({
  school,
  item,
  staff,
  admin,
  onEdit,
  onRefresh,
}: {
  school: School;
  item: SchoolClassRecord;
  staff: boolean;
  admin: boolean;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const text = useSchoolText();
  const [kind, setKind] = useState<"student" | "teacher">("student");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState<"student" | "teacher" | null>(null);
  const [action, setAction] = useState<
    "archive" | "restore" | RosterIdentity | null
  >(null);
  return (
    <section className={`${panelClass} min-w-0 overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="break-words font-bold">
            {item.name} · {text("Student roster", "学生名单")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.studentCount} {text("students", "名学生")}
            {item.teachers.length > 0 && (
              <>
                {" "}
                · {text("Teachers: ", "教师：")}
                {item.teachers.map((teacher) => teacher.name).join(" / ")}
              </>
            )}
          </p>
        </div>
        {item.canManage && (
          <div className="flex flex-wrap gap-2">
            {!item.archived && (
              <Button size="sm" variant="secondary" onClick={onEdit}>
                {text("Edit class", "编辑班级")}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAction(item.archived ? "restore" : "archive")}
            >
              {item.archived
                ? text("Restore class", "恢复班级")
                : text("Archive class", "归档班级")}
            </Button>
          </div>
        )}
      </div>
      {staff && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <div
            className="flex gap-1"
            role="group"
            aria-label={text("Roster role", "名单角色")}
          >
            {(["student", "teacher"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={kind === value ? "secondary" : "ghost"}
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                  setPage(1);
                }}
              >
                {value === "student"
                  ? text("Students", "学生")
                  : text("Teachers", "教师")}
              </Button>
            ))}
          </div>
          {item.canManage && !item.archived && (
            <div className="flex flex-wrap gap-2">
              {admin && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setAdding("teacher")}
                >
                  {text("Assign teacher", "分配教师")}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAdding("student")}
              >
                <UserPlus size={14} />
                {text("Add student", "添加学生")}
              </Button>
            </div>
          )}
        </div>
      )}
      <SchoolClassRosterRows
        key={`${item.id}:${kind}:${page}`}
        school={school}
        item={item}
        kind={staff ? kind : "student"}
        page={page}
        onPage={setPage}
        staff={staff}
        admin={admin}
        onRemove={setAction}
      />
      {adding && (
        <SchoolClassRosterPicker
          school={school}
          item={item}
          kind={adding}
          onClose={() => setAdding(null)}
          onSaved={onRefresh}
        />
      )}
      {action && (
        <SchoolClassAction
          school={school}
          item={item}
          action={action}
          onClose={() => setAction(null)}
          onSaved={onRefresh}
        />
      )}
    </section>
  );
}

function SchoolClassRosterRows({
  school,
  item,
  kind,
  page,
  onPage,
  staff,
  admin,
  onRemove,
}: {
  school: School;
  item: SchoolClassRecord;
  kind: "student" | "teacher";
  page: number;
  onPage: (page: number) => void;
  staff: boolean;
  admin: boolean;
  onRemove: (identity: RosterIdentity) => void;
}) {
  const text = useSchoolText();
  const resource = useData<RosterPage>(
    `schools/${school.id}/classes/${item.id}/roster?kind=${kind}&page=${page}`,
  );
  const manageable =
    item.canManage && !item.archived && (admin || kind === "student");
  return (
    <div className="min-h-40">
      <Loading resource={resource}>
        <Table
          headers={[
            ...(staff
              ? [
                  kind === "teacher"
                    ? text("Staff ID", "工号")
                    : text("Student ID", "学号"),
                ]
              : []),
            text("Name", "姓名"),
            ...(staff ? [text("Account", "账号")] : []),
            ...(manageable ? [text("Actions", "操作")] : []),
          ]}
          min={staff ? 480 : 260}
        >
          {resource.data?.items.map((identity) => (
            <tr key={identity.id}>
              {staff && (
                <td className="font-mono text-xs">{identity.number}</td>
              )}
              <td className="font-semibold">{identity.name}</td>
              {staff && (
                <td>
                  <span
                    className={
                      identity.accountStatus === "active"
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {identity.accountStatus === "disabled"
                      ? text("Disabled", "已停用")
                      : identity.accountLinked
                        ? text("Linked", "已关联")
                        : text("Not linked", "未关联")}
                  </span>
                </td>
              )}
              {manageable && (
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={text(
                      `Remove ${identity.name} from class`,
                      `将 ${identity.name} 移出班级`,
                    )}
                    onClick={() => onRemove(identity)}
                  >
                    {text("Remove", "移出")}
                  </Button>
                </td>
              )}
            </tr>
          ))}
          {!resource.data?.items.length && (
            <tr>
              <td
                colSpan={staff ? (manageable ? 4 : 3) : 1}
                className="py-8 text-center text-muted-foreground"
              >
                {kind === "teacher"
                  ? text("No teachers assigned.", "尚未分配教师。")
                  : text("This class has no students yet.", "该班级暂无学生。")}
              </td>
            </tr>
          )}
        </Table>
        {(page > 1 || resource.data?.hasMore) && (
          <div className="px-4 py-2">
            <ClassPagination
              page={page}
              hasMore={Boolean(resource.data?.hasMore)}
              onPage={onPage}
            />
          </div>
        )}
      </Loading>
    </div>
  );
}

export function ClassPagination({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}) {
  const text = useSchoolText();
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 text-xs"
      aria-label={text("Pagination", "分页")}
    >
      <span className="text-muted-foreground">
        {text(`Page ${page}`, `第 ${page} 页`)}
      </span>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {text("Previous", "上一页")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!hasMore}
          onClick={() => onPage(page + 1)}
        >
          {text("Next", "下一页")}
        </Button>
      </div>
    </div>
  );
}
