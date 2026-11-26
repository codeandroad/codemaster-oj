"use client";

import { schoolClassApiPath, schoolWorkspaceHref } from "./school-workspace-location";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Upload, UserPlus } from "lucide-react";
import { Drawer, inputClass, Loading, panelClass, useData } from "@/components/admin/common";
import { AppLink } from "@/components/navigation";
import { Table } from "@/components/teacher/shared";
import { Button } from "@/components/ui/button";
import { SchoolIdentityImport } from "./school-identity-import";
import { SchoolIdentityDetails } from "./school-administration";
import {
  SchoolClassEditor,
  SchoolClassRosterPicker,
  SchoolClassAction,
  TeacherPermissionsEditor,
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
  canRename: boolean;
  canManageStudents: boolean;
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
  canRename: boolean;
  canManageStudents: boolean;
  accountLinked?: boolean;
  accountStatus?: "active" | "disabled" | "unlinked";
};
type RosterKind = "student" | "teacher";
type RosterPage = { items: RosterIdentity[]; page: number; hasMore: boolean };

export function SchoolClasses({
  school,
  refreshRevision = 0,
  management = true,
}: {
  school: School;
  refreshRevision?: number;
  management?: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { archived, page, classId: activeId } = schoolClassLocation(searchParams);
  const [query,setQuery] = useState("");
  const [kind,setKind] = useState<RosterKind>("student");
  const [revision, setRevision] = useState(0);
  const navigate = (change: Parameters<typeof schoolClassHref>[2]) =>
    router.push(schoolClassHref(searchParams, school.id, change), { scroll: false });
  return (
    <SchoolClassList
      key={`${school.id}:${management}:${activeId}:${archived}:${page}:${revision}:${refreshRevision}`}
      school={school}
      management={management}
      kind={kind}
      onKind={setKind}
      query={query}
      onQuery={setQuery}
      archived={archived}
      page={page}
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
  management, query, onQuery, kind, onKind,
  activeId,
  onSelect,
  onFilter,
  onRefresh,
}: {
  school: School;
  archived: boolean;
  page: number;
  kind: RosterKind; onKind: (kind:RosterKind)=>void;
  management: boolean; query: string; onQuery: (value:string)=>void;
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
    schoolClassApiPath(`${base}/classes?archived=${archived}&page=${page}${activeId ? `&classId=${encodeURIComponent(activeId)}` : ""}`, !management),
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
  const admin = management && school.roles.includes("school_admin");
  const choices = useData<{items:{id:string;name:string}[]}>(schoolClassApiPath(`${base}/classes?view=choices&archived=${archived}`, !management));
  const reloadClasses = resource.reload;
  const reloadChoices = choices.reload;
  useEffect(() => {
    if (management) return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        reloadClasses();
        reloadChoices();
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [management, reloadClasses, reloadChoices]);
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
        </div>
        {staff && (
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            {admin && <Button
              size="sm"
              disabled={!resource.data?.canCreate}
              onClick={() => setEditing("new")}
            >
              <Plus size={15} />
              {text("New class", "新建班级")}
            </Button>}
            <Button
              size="sm"
              variant="secondary"
              disabled={!current?.canManageStudents || current.archived}
              onClick={() => setImporting(true)}
            >
              <Upload size={15} />
              {text("Import roster", "导入名单")}
            </Button>
          </div>
        )}
      </div>
      <search className="flex flex-wrap items-center gap-2" aria-label={text("Class roster filters","班级名单筛选")}>
        <input type="search" name="rosterSearch" value={query} maxLength={100} className={inputClass+" min-w-40 flex-1"}
          aria-label={text("Search roster by name or ID","搜索名单中的姓名或编号")} placeholder={text("Search roster by name or ID","搜索名单中的姓名或编号")}
          onChange={event=>onQuery(event.target.value)} />
        <select aria-label={text("Select class","选择班级")} name="classId" className={inputClass+" !w-auto max-w-full"}
          value={current?.id ?? ""} disabled={!choices.data?.items.length} onChange={event=>onSelect(event.target.value)}>
          {!current && <option value="">{text("Select class","选择班级")}</option>}
          {choices.data?.items.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </search>
      {choices.error && <Loading resource={choices}>{null}</Loading>}
      <Loading resource={resource}>
        <div className="min-w-0">
          {current ? (
            <SchoolClassRoster
              key={current.id}
              school={school}
              item={current}
              kind={kind}
              onKind={onKind}
              query={query.trim()}
              staff={staff}
              admin={admin}
              onIdentityChanged={reloadClasses}
              onEdit={() => setEditing(current)}
              onRefresh={() => onRefresh(current.id)}
            />
          ) : (
            <section
              className={`${panelClass} p-6 text-sm text-muted-foreground`}
            >
              {archived ? text("No archived classes.","暂无已归档班级。") : admin
                ? text("No classes yet. Create a class to get started.","暂无班级，请先新建班级。")
                : text("No classes assigned. Contact your school administrator.","尚未分配班级，请联系学校管理员。")}
            </section>
          )}
        </div>
      </Loading>
      {editing && (admin || (editing !== "new" && current?.canRename && current.id === editing.id)) && (
        <SchoolClassEditor
          school={school}
          renameOnly={!admin}
          item={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => onRefresh(id, editing === "new")}
        />
      )}
      {importing && current?.canManageStudents && (
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
  item, query, kind, onKind,
  staff,
  admin,
  onIdentityChanged,
  onEdit,
  onRefresh,
}: {
  school: School;
  item: SchoolClassRecord;
  query: string;
  kind:RosterKind;
  onKind:(kind:RosterKind)=>void;
  staff: boolean;
  admin: boolean;
  onIdentityChanged: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const text = useSchoolText();
  const [cursor,setCursor] = useState({query, page:1});
  const page = cursor.query === query ? cursor.page : 1;
  const setPage = (page:number)=>setCursor({query,page});
  const [editingTeacher,setEditingTeacher] = useState<RosterIdentity | null>(null);
  const [adding, setAdding] = useState<"student" | "teacher" | null>(null);
  const [action, setAction] = useState<
    "archive" | "restore" | RosterIdentity | null
  >(null);
  return (
    <section className={`${panelClass} min-w-0 overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="break-words font-bold">
            {item.name} · {kind === "teacher" ? text("Teacher roster","教师名单") : text("Student roster", "学生名单")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.type === "administrative" ? text("Administrative class","行政班") : text("Training class","训练班")} · {item.studentCount} {text("students", "名学生")}
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
            {!item.archived && item.canRename && (
              <Button size="sm" variant="secondary" onClick={onEdit}>
                {admin ? text("Edit class", "编辑班级") : text("Rename class","修改班级名称")}
              </Button>
            )}
            {admin && <Button
              size="sm"
              variant="secondary"
              onClick={() => setAction(item.archived ? "restore" : "archive")}
            >
              {item.archived
                ? text("Restore class", "恢复班级")
                : text("Archive class", "归档班级")}
            </Button>}
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
                  onKind(value);
                  setPage(1);
                }}
              >
                {value === "student"
                  ? text("Students", "学生")
                  : text("Teachers", "教师")}
              </Button>
            ))}
          </div>
          {item.canManageStudents && !item.archived && (
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
        onIdentityChanged={onIdentityChanged}
        query={query}
        onEditTeacher={setEditingTeacher}
        onRemove={setAction}
      />
      {editingTeacher && <TeacherPermissionsEditor school={school} item={item} teacher={editingTeacher} onClose={()=>setEditingTeacher(null)} onSaved={onRefresh}/>}
      {adding && item.canManageStudents && (
        <SchoolClassRosterPicker
          school={school}
          teaching={!admin}
          item={item}
          kind={adding}
          onClose={() => setAdding(null)}
          onSaved={()=>{onKind(adding);onRefresh();}}
        />
      )}
      {action && (admin || item.canManageStudents) && (
        <SchoolClassAction
          school={school}
          teaching={!admin}
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
  onIdentityChanged,
  onRemove, query, onEditTeacher,
}: {
  school: School;
  item: SchoolClassRecord;
  kind: "student" | "teacher";
  page: number;
  onPage: (page: number) => void;
  staff: boolean;
  admin: boolean;
  onIdentityChanged: () => void;
  onRemove: (identity: RosterIdentity) => void;
  query:string;
  onEditTeacher:(teacher:RosterIdentity)=>void;
}) {
  const text = useSchoolText();
  const [selected, setSelected] = useState<RosterIdentity | null>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  const roster = useRef<HTMLDivElement>(null);
  const resource = useData<RosterPage>(
    schoolClassApiPath(`schools/${school.id}/classes/${item.id}/roster?kind=${kind}&page=${page}&q=${encodeURIComponent(query)}`, staff && !admin),
  );
  const manageable =
    !item.archived && (admin || (item.canManageStudents && kind === "student"));
  function closeDetails() {
    setSelected(null);
    requestAnimationFrame(() => (nameButton.current?.isConnected ? nameButton.current : roster.current)?.focus());
  }
  return (
    <div ref={roster} tabIndex={-1} className="min-h-40">
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
              <td className="font-semibold">{staff ? (
                <button type="button" aria-haspopup="dialog" className="text-left text-primary hover:underline focus-visible:underline"
                  onClick={event => { nameButton.current = event.currentTarget; setSelected(identity); }}>
                  {identity.name}
                </button>
              ) : identity.name}</td>
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
                <td><div className="flex flex-wrap gap-1">
                  {admin && kind==="teacher" && <Button size="sm" variant="secondary" onClick={()=>onEditTeacher(identity)}>
                    {text("Class permissions","班级权限")}</Button>}
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
                  </Button></div>
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
                {query ? text("No matching roster entries.","没有匹配的名单记录。") : kind === "teacher"
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
      {staff && selected && (admin
        ? <SchoolIdentityDetails key={selected.id} school={school} identityId={selected.id} onClose={closeDetails}
            onSaved={() => { resource.reload(); onIdentityChanged(); }}/>
        : <TeachingRosterAccount key={selected.id} schoolId={school.id} classroom={item} identity={selected}
            onClose={closeDetails} onRemove={() => { setSelected(null); onRemove(selected); }}/>)}
    </div>
  );
}

type RosterAccount = Pick<RosterIdentity, "id" | "kind" | "name"> & {
  number: string; username: string | null; accountStatus: "active" | "disabled" | "unlinked";
  schoolAccess: "active" | "suspended" | null; canRemove: boolean;
};

function TeachingRosterAccount({schoolId, classroom, identity, onClose, onRemove}: {
  schoolId: string; classroom: SchoolClassRecord; identity: RosterIdentity; onClose: () => void; onRemove: () => void;
}) {
  const text = useSchoolText();
  const resource = useData<RosterAccount>(schoolClassApiPath(`schools/${schoolId}/classes/${classroom.id}/roster/${identity.id}`));
  const person = resource.data;
  return <Drawer title={person?.name ?? identity.name} eyebrow={text("Account details", "账号详情")} onClose={onClose}>
    <Loading resource={resource}>{person && <div className="space-y-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
        <dt>{text("Username", "用户名")}</dt><dd className="break-all">{person.username ?? text("Not linked", "未关联")}</dd>
        <dt>{person.kind === "student" ? text("Student ID", "学号") : text("Staff ID", "工号")}</dt><dd>{person.number}</dd>
        <dt>{text("Role", "角色")}</dt><dd>{person.kind === "student" ? text("Student", "学生") : text("Teacher", "教师")}</dd>
        <dt>{text("Class", "班级")}</dt><dd>{classroom.name}</dd>
        {person.accountStatus !== "unlinked" && <><dt>{text("Platform login", "平台登录")}</dt>
          <dd>{person.accountStatus === "active" ? text("Enabled", "已启用") : text("Disabled", "已停用")}</dd></>}
        {person.schoolAccess && <><dt>{text("School access", "本校访问")}</dt>
          <dd>{person.schoolAccess === "active" ? text("Active", "已开放") : text("Suspended", "已暂停")}</dd></>}
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        {person.kind === "student" && person.accountStatus === "active" && person.schoolAccess === "active" &&
          <AppLink className="text-sm font-semibold text-primary hover:underline" href={schoolWorkspaceHref(schoolId,"leaderboard","teacher")+"&profileId="+person.id}>
            {text("View student profile", "查看学生主页")}</AppLink>}
        {person.canRemove && <Button type="button" size="sm" variant="secondary" onClick={onRemove}>{text("Remove from class", "移出班级")}</Button>}
      </div>
    </div>}</Loading>
  </Drawer>;
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
