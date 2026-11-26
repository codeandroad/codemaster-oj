"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import {
  Drawer, useAdminText, Feedback,
  inputClass,
  Loading,
  Modal,
  useData,
  useMutation,
} from "@/components/admin/common";
import { genderLabel } from "@/lib/gender";
import { AppLink } from "@/components/navigation";
import { schoolWorkspaceHref } from "./school-workspace-location";
import { SchoolClassFilter, useSchoolDirectoryOptions } from "./school-directory-filters";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { productionApi, type CampusGender } from "@/lib/production-api";
import { cn } from "@/lib/utils";
import { SchoolIdentityImport } from "./school-identity-import";
import { SchoolIdentityClasses, type IdentityClass } from "./school-identity-classes";
import { OptionalIdentityFields, SchoolIdentityProfile } from "./school-identity-profile";
import { SchoolClassPicker } from "./school-class-picker";
import { SchoolActivationButton } from "./school-activation-button";
import {
  RoleLabel,
  useSchoolError,
  useSchoolText,
  type School,
} from "./school-ui";

type IdentityKind = "student" | "teacher";
type Identity = {
  id: string;
  name: string;
  number: string;
  kind: IdentityKind;
};
type DirectoryIdentity = Omit<Identity,"kind"> & { kind: IdentityKind | "school_admin"; accountId: string | null;
  roles: (IdentityKind | "school_admin")[]; username: string | null; gender: CampusGender | null; notes?:string | null; classes: IdentityClass[];
  archivedAt: string | null; archivedByExit: boolean; canArchive:boolean };
type MemberAccount = { accountId: string; name: string; username?: string };
type ClassType = "administrative" | "training";
type Page<T> = { items: T[]; page: number; hasMore: boolean };
type Column<T> = { title: string; cell: (item: T) => ReactNode };

export function SchoolDirectory({
  base,
  school,
  refreshRevision,
  highlightedIdentityId,
}: {
  base: string;
  school: School;
  refreshRevision: number;
  highlightedIdentityId: string | null;
}) {
  const text = useSchoolText();
  const [query, setQuery] = useState("");
  const t = useAdminText();
  const [kind, setKind] = useState<DirectoryIdentity["kind"] | "">("");
  const [archived,setArchived] = useState(false);
  const [status,setStatus] = useState("all");
  const [classId,setClassId] = useState("");
  const [viewId,setViewId] = useState(highlightedIdentityId);
  const [archiving,setArchiving] = useState<DirectoryIdentity|null>(null);
  const options = useSchoolDirectoryOptions(school.id,archived);
  const params = new URLSearchParams({status,q:query,archived:String(archived)});
  if(kind) params.set("kind",kind);
  if(classId) params.set("classId",classId);
  const [edit, setEdit] = useState(false);
  const [importing, setImporting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");

  function saved(nextMessage: string) {
    setEdit(false);
    setImporting(false);
    setArchiving(null); options.reload();
    setRevision((value) => value + 1);
    setMessage(nextMessage);
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex flex-wrap gap-2">
          {!archived && kind!=="school_admin" && <>
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>{text("Import roster","导入名单")}</Button>
            <Button size="sm" onClick={() => setEdit(true)}><Plus size={14}/>{!kind ? text("Create identity","新建身份") : kind==="teacher" ? text("Create teacher identity","新建教师身份") : text("Create student identity","新建学生身份")}</Button>
          </>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[false,true].map(value=><Button key={String(value)} size="sm" aria-pressed={archived===value} variant={archived===value?"secondary":"ghost"}
          onClick={()=>{setArchived(value);setStatus("all");}}>{value ? text("Deleted","已删除") : text("Active records","正常档案")}</Button>)}
      </div>
      <search aria-label={text("Identity filters","身份档案筛选")} className="flex flex-wrap items-center gap-2"><div className="min-w-48 flex-1">
        <IdentityFilter onQuery={setQuery} kind="" onKind={()=>{}} fixedKind searchAccount/></div>
        <select aria-label={text("Filter by role","按角色筛选")} name="role" className={inputClass+" !w-auto max-w-full"} value={kind}
          onChange={event=>setKind(event.target.value as typeof kind)}>
          <option value="">{text("All roles","全部角色")}</option>
          {(["student","teacher","school_admin"] as const).map(role=><option key={role} value={role}>
            {role==="student" ? text("Student","学生") : role==="teacher" ? text("Teacher","教师") : text("School administrator","学校管理员")} · {options.data?.counts[role] ?? 0}
          </option>)}
        </select>
        {!archived && <select aria-label={text("Claim status","认领状态")} className={inputClass+" !w-auto"} value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="all">{text("All statuses","全部状态")}</option><option value="active">{text("Claimed","已认领")}</option>
          <option value="pending">{text("Awaiting claim","待认领")}</option></select>}
        <SchoolClassFilter classes={options.data?.classes ?? []} value={classId} onChange={setClassId}/>
      </search>
      <Feedback action={{ error: options.error, message }} />
      <SchoolTable<DirectoryIdentity> key={params.toString()} refreshKey={`${revision}:${refreshRevision}`}
        path={`${base}/identities?${params}`} label={text("School identities","校内身份档案")}
        empty={text("No matching identities.","没有符合条件的身份档案。")} rowKey={item=>item.id}
        highlightedRowKey={viewId} columns={[
          {title:kind==="student"?text("Student ID","学号"):kind==="teacher"?text("Staff ID","工号"):text("Identity ID","身份编号"),cell:item=><code>{item.number}</code>},
          {title:text("Name","姓名"),cell:item=><button className="font-semibold text-primary hover:underline" onClick={()=>setViewId(item.id)}>{item.name}</button>},
          {title:text("Role","角色"),cell:item=><div className="flex flex-wrap gap-x-2">{item.roles.map(role=><span key={role}><RoleLabel role={role}/></span>)}</div>},
          {title:text("Gender","性别"),cell:item=>t(genderLabel(item.gender))},
          {title:text("Classes","关联班级"),cell:item=>item.classes.filter(c=>!c.archived).map(c=>c.name).join("、")||"—"},
          {title:text("Linked account","关联账号"),cell:item=>item.username ?? "—"},
          {title:text("Status","状态"),cell:item=>item.archivedByExit ? text("Left school","已退校") : archived ? text("Deleted","已删除") : item.accountId ? text("Claimed","已认领") : text("Awaiting claim","待认领")},
          {title:text("Actions","操作"),cell:item=><div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={()=>setViewId(item.id)}>{text("View","查看")}</Button>
            {item.canArchive && <Button size="sm" variant="secondary" onClick={()=>setArchiving(item)}>{archived?text("Restore","恢复"):text("Delete","删除")}</Button>}
          </div>}
        ]}/>
      {viewId && !archiving && <SchoolIdentityDetails key={viewId} school={school} identityId={viewId}
        onClose={() => setViewId(null)} onSaved={saved}/>}
      {archiving && <ConfirmSchoolAction title={archiving.archivedAt ? text("Restore identity?","恢复身份档案？") : text("Delete identity?","删除身份档案？")}
        description={archiving.name+" · "+text("The ID and class assignments are retained.","原编号与班级关联会保留。")}
        actionLabel={archiving.archivedAt?text("Restore","恢复"):text("Delete","删除")} onClose={()=>setArchiving(null)} onConfirm={async()=>{
          await productionApi(`${base}/identities/${archiving.id}/${archiving.archivedAt?"restore":"archive"}`,{method:"POST",body:{}});
          setViewId(null);saved(archiving.archivedAt?text("Identity restored.","已恢复档案。"):text("Identity deleted.","已删除档案。"));
        }}/>}
      {importing && (
        <SchoolIdentityImport
          initialKind={kind==="teacher" ? "teacher" : "student"}
          school={school}
          onClose={() => setImporting(false)}
          onSaved={saved}
        />
      )}
      {edit && (
        <CreateSchoolRecord
          initialKind={kind==="teacher" ? "teacher" : "student"}
          endpoint={`${base}/identities`}
          type="identity"
          school={school}
          onClose={() => setEdit(false)}
          onSaved={() => saved(text("Identity created.", "已创建身份档案。"))}
        />
      )}
    </div>
  );
}

export function SchoolIdentityDetails({ school, identityId, onClose, onSaved }: {
  school: School; identityId: string; onClose: () => void; onSaved: (message: string) => void;
}) {
  const text = useSchoolText(), t = useAdminText();
  const base = `schools/${school.id}`;
  const details = useData<DirectoryIdentity & { memberProfileId: string | null }>(`${base}/identities/${identityId}/details`);
  const person = details.data;
  const [action, setAction] = useState<"classes" | "profile" | "link" | "unlink" | null>(null);
  function saved(message: string) {
    setAction(null);
    details.reload();
    onSaved(message);
  }
  return <>
      {!action && <Drawer title={person?.name ?? text("Identity details","身份详情")}
        eyebrow={person?.number} onClose={onClose}>
        <Loading resource={details}>{person && <div className="space-y-4 text-sm">
          {person.memberProfileId ? (
              <AppLink className={buttonVariants({ size: "sm", variant: "secondary" })}
                href={schoolWorkspaceHref(school.id, "leaderboard") + "&profileId=" + person.memberProfileId}>
                {person.kind === "student" ? text("View student profile", "查看学生主页") : text("View profile", "查看主页")}
              </AppLink>
            ) : person.kind === "student" && (
              <p className="text-muted-foreground">{person.archivedAt
                ? text("The student profile is unavailable because this identity is archived.", "该身份档案已归档，学生主页不可访问。")
                : person.accountId
                  ? text("The student profile is unavailable because the linked account or its school access is inactive.", "关联账号或本校访问已停用，学生主页不可访问。")
                  : text("The student profile will be available after this identity is linked to an active account.", "此档案关联有效账号后，即可查看学生主页。")}</p>
          )}
          <section className="space-y-3 rounded-md border border-border p-4">
            <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{text("Identity details","身份资料")}</h3>
              {!person.archivedAt && <Button size="sm" variant="secondary" onClick={()=>setAction("profile")}>{text("Edit profile","编辑资料")}</Button>}</div>
            <dl className="grid grid-cols-2 gap-3"><div><dt>{text("Gender","性别")}</dt><dd>{t(genderLabel(person.gender))}</dd></div>
              <div><dt>{text("Classes","关联班级")}</dt><dd>{person.classes.filter(c=>!c.archived).map(c=>c.name).join("、")||"—"}</dd></div>
              <div><dt>{text("Notes","备注")}</dt><dd className="whitespace-pre-wrap">{person.notes||"—"}</dd></div></dl>
            {!person.archivedAt && person.kind!=="school_admin" && <Button size="sm" variant="secondary" onClick={()=>setAction("classes")}>{text("Adjust classes","调整班级")}</Button>}
          </section>
          <section className="space-y-3 rounded-md border border-border p-4"><h3 className="font-semibold">{text("Login account","登录账号")}</h3>
            <p>{person.username || (person.archivedAt ? "—" : text("Awaiting claim","待认领"))}</p>
            <div className="flex flex-wrap items-center gap-2">
              {person.accountId && <AppLink className="text-primary underline" href={schoolWorkspaceHref(school.id,"members")+"&accountId="+person.accountId}>{text("View in accounts","在账号与角色中查看")}</AppLink>}
              {!person.archivedAt && person.kind!=="school_admin" && <>
                <Button size="sm" variant="secondary" onClick={()=>setAction(person.accountId ? "unlink" : "link")}>{person.accountId ? text("Unlink","解除关联") : text("Link account","关联账号")}</Button>
                {!person.accountId && <SchoolActivationButton school={school} identity={{...person,kind:person.kind}}/>}
              </>}
            </div>
          </section>
          <section className="rounded-md border border-border p-4"><h3 className="mb-1 font-semibold">{text("Record history","历史记录")}</h3>
            {text("Updating the profile or changing its account link preserves classes, assignments and submission history.","编辑资料或变更账号关联后，原有班级、作业和提交记录会保留。")}</section>
        </div>}</Loading></Drawer>}
      {action === "classes" && <SchoolIdentityClasses school={school} identityId={identityId}
        onClose={() => setAction(null)}
        onSaved={() => saved(text("Class assignments saved.", "已保存班级调整。"))}/>}
      {action === "profile" && <SchoolIdentityProfile school={school} identityId={identityId}
        onClose={() => setAction(null)}
        onSaved={() => saved(text("Identity profile saved.", "已保存身份资料。"))}/>}
      {action === "link" && person && (
        <LinkAccount
          base={base}
          identity={person}
          onClose={() => setAction(null)}
          onSaved={() => saved(text("Account linked.", "已关联账号。"))}
        />
      )}
      {action === "unlink" && person && (
        <ConfirmSchoolAction
          title={text("Unlink account?", "解除账号关联？")}
          description={text(
            `Unlink the account from ${person.name} at ${school.name}. Their login and school membership remain active. A teacher will lose access to the rosters assigned through this identity.`,
            `解除 ${person.name} 在 ${school.name} 的账号关联。其登录账号和学校成员关系继续有效，教师将失去通过此档案获得的班级名单访问权限。`,
          )}
          actionLabel={text("Unlink account", "解除账号关联")}
          onClose={() => setAction(null)}
          onConfirm={async () => {
            await productionApi(`${base}/identities/${person.id}/account`, {
              method: "PATCH",
              body: { accountId: null, expectedAccountId: person.accountId },
            });
            saved(text("Account unlinked.", "已解除账号关联。"));
          }}
        />
      )}
  </>;
}

export function IdentityFilter({
  onQuery,
  kind,
  onKind,
  fixedKind = false, searchAccount = false,
}: {
  onQuery: (query: string) => void;
  kind: IdentityKind | "";
  onKind: (kind: IdentityKind | "") => void;
  fixedKind?: boolean; searchAccount?: boolean;
}) {
  const text = useSchoolText();
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  return (
    <form
      noValidate
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current) onQuery(value.trim());
      }}
    >
      <div className="relative min-w-36 flex-1">
        <input
          ref={input}
          type="text"
          className={`${inputClass} pr-10`}
          aria-label={searchAccount ? text("Search ID, name or account","搜索编号、姓名或账号") : text("Search name or ID number", "搜索姓名或身份编号")}
          placeholder={searchAccount ? text("Search ID, name or account","搜索编号、姓名或账号") : text("Search name or ID number", "搜索姓名或身份编号")}
          maxLength={100}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0.5 top-0.5"
            aria-label={text("Clear search", "清除搜索")}
            title={text("Clear search", "清除搜索")}
            onClick={() => {
              setValue("");
              onQuery("");
              input.current?.focus();
            }}
          >
            <X size={16} />
          </Button>
        )}
      </div>
      {!fixedKind && (
        <select
          aria-label={text("Filter by role", "按角色筛选")}
          className={cn(inputClass, "w-auto max-w-full")}
          value={kind}
          onChange={(event) => onKind(event.target.value as IdentityKind | "")}
        >
          <option value="">{text("All roles", "全部角色")}</option>
          <option value="student">{text("Students", "学生")}</option>
          <option value="teacher">{text("Teachers", "教师")}</option>
        </select>
      )}
      <Button type="submit" variant="secondary">
        {text("Search", "搜索")}
      </Button>
    </form>
  );
}

type SchoolTableProps<T> = {
  refreshKey?: string;
  path: string;
  label: string;
  empty: string;
  rowKey: (item: T) => string;
  highlightedRowKey?: string | null;
  columns: Column<T>[];
};

function SchoolTable<T>(props: SchoolTableProps<T>) {
  const [page, setPage] = useState(1);
  return (
    <SchoolTablePage key={`${page}:${props.refreshKey ?? ""}`} {...props} page={page} setPage={setPage} />
  );
}

function SchoolTablePage<T>({
  path,
  label,
  empty,
  rowKey,
  highlightedRowKey,
  columns,
  page,
  setPage,
}: SchoolTableProps<T> & {
  page: number;
  setPage: (value: number) => void;
}) {
  const text = useSchoolText();
  const resource = useData<Page<T>>(
    `${path}${path.includes("?") ? "&" : "?"}page=${page}`,
  );
  return (
    <div className="min-h-32">
      <Loading resource={resource}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                {columns.map((column) => (
                  <th key={column.title} scope="col" className="py-2 pr-3">
                    {column.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resource.data?.items.map((item) => (
                <tr
                  key={rowKey(item)}
                  aria-current={highlightedRowKey === rowKey(item) ? "true" : undefined}
                  className={`border-b border-border last:border-0 ${highlightedRowKey === rowKey(item) ? "bg-accent" : ""}`}
                >
                  {columns.map((column) => (
                    <td key={column.title} className="break-words py-2 pr-3">
                      {column.cell(item)}
                    </td>
                  ))}
                </tr>
              ))}
              {!resource.data?.items.length && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-6 text-center text-muted-foreground"
                  >
                    {empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div
          role="group"
          aria-label={text("Pagination", "分页")}
          className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"
        >
          <span className="text-muted-foreground">
            {text(`Page ${page}`, `第 ${page} 页`)}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              {text("Previous", "上一页")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!resource.data?.hasMore}
              onClick={() => setPage(page + 1)}
            >
              {text("Next", "下一页")}
            </Button>
          </div>
        </div>
      </Loading>
    </div>
  );
}

function CreateSchoolRecord({
  initialKind = "student", endpoint,
  type,
  school,
  onClose,
  onSaved,
}: {
  initialKind?: IdentityKind;
  endpoint: string;
  type: "identity" | "class";
  school: School;
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = useSchoolText();
  const action = useMutation();
  const localError = useSchoolError();
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [kind, setKind] = useState<IdentityKind>(initialKind);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [optionalFields, setOptionalFields] = useState<{ gender: CampusGender | null; notes: string }>({ gender: null, notes: "" });
  const [classType, setClassType] = useState<ClassType>("administrative");
  const [invalid, setInvalid] = useState<"name" | "number" | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  const isIdentity = type === "identity";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    if (!name.trim()) {
      setInvalid("name");
      nameInput.current?.focus();
      return;
    }
    if (isIdentity && !number.trim()) {
      setInvalid("number");
      numberInput.current?.focus();
      return;
    }
    setInvalid(null);
    void action.run(async () => {
      try {
        const body = isIdentity
          ? { name: name.trim(), number: number.trim(), kind, classIds, ...optionalFields }
          : { name: name.trim(), type: classType };
        await productionApi(endpoint, { method: "POST", body });
        onSaved();
      } catch (error) {
        throw localError(error);
      }
    });
  }

  const label = isIdentity
    ? text("Create identity", "新建身份")
    : text("Create class", "新建班级");
  return (
    <Modal
      title={label}
      description={
        isIdentity
          ? text(
              `Create a student or teacher identity at ${school.name}. Link it to a school member after saving.`,
              `在 ${school.name} 创建学生或教师身份，保存后可关联本校成员账号。`,
            )
          : text(
              `Create a class at ${school.name}. Add students and teachers from the school directory after saving.`,
              `在 ${school.name} 创建班级，保存后可从身份档案中添加学生和教师。`,
            )
      }
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      <form noValidate className="space-y-3" onSubmit={submit}>
        <label className="block space-y-1 text-sm font-semibold">
          <span>
            {isIdentity ? text("Name", "姓名") : text("Class name", "班级名称")}
          </span>
          <input
            ref={nameInput}
            name="name"
            value={name}
            maxLength={100}
            required
            disabled={action.busy}
            aria-invalid={invalid === "name"}
            aria-describedby={
              invalid === "name" ? "school-record-name-error" : undefined
            }
            onChange={(event) => {
              setName(event.target.value);
              if (invalid === "name") setInvalid(null);
            }}
            className={inputClass}
          />
        </label>
        {invalid === "name" && (
          <p
            id="school-record-name-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {text("Enter a name.", "请输入名称。")}
          </p>
        )}
        {isIdentity ? (
          <>
            <label className="block space-y-1 text-sm font-semibold">
              <span>{text("ID number", "身份编号")}</span>
              <input
                ref={numberInput}
                name="number"
                value={number}
                maxLength={64}
                required
                disabled={action.busy}
                aria-invalid={invalid === "number"}
                aria-describedby={
                  invalid === "number"
                    ? "school-record-number-error"
                    : undefined
                }
                onChange={(event) => {
                  setNumber(event.target.value);
                  if (invalid === "number") setInvalid(null);
                }}
                className={inputClass}
              />
            </label>
            {invalid === "number" && (
              <p
                id="school-record-number-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {text("Enter an ID number.", "请输入身份编号。")}
              </p>
            )}
            <label className="block space-y-1 text-sm font-semibold">
              <span>{text("Role", "角色")}</span>
              <select
                className={inputClass}
                value={kind}
                disabled={action.busy}
                onChange={(event) =>
                  setKind(event.target.value as IdentityKind)
                }
              >
                <option value="student">{text("Student", "学生")}</option>
                <option value="teacher">{text("Teacher", "教师")}</option>
              </select>
            </label>
            <fieldset disabled={action.busy} className="space-y-3">
              <legend className="sr-only">{text("Additional details", "补充资料")}</legend>
              <OptionalIdentityFields {...optionalFields} onChange={value => setOptionalFields(previous => ({ ...previous, ...value }))}/>
            </fieldset>
            <fieldset disabled={action.busy} className="space-y-2">
              <legend className="text-sm font-semibold">
                {kind === "student"
                  ? text("Student classes (optional)", "所在班级（可选）")
                  : text("Teaching classes (optional)", "任教班级（可选）")}
              </legend>
              <SchoolClassPicker schoolId={school.id} selected={classIds} onChange={setClassIds} />
            </fieldset>
          </>
        ) : (
          <label className="block space-y-1 text-sm font-semibold">
            <span>{text("Class type", "班级类型")}</span>
            <select
              className={inputClass}
              value={classType}
              disabled={action.busy}
              onChange={(event) =>
                setClassType(event.target.value as ClassType)
              }
            >
              <option value="administrative">
                {text("Administrative", "行政班")}
              </option>
              <option value="training">{text("Training", "训练班")}</option>
            </select>
          </label>
        )}
        <Feedback action={action} />
        <SchoolDialogActions
          busy={action.busy}
          label={label}
          onClose={onClose}
        />
      </form>
    </Modal>
  );
}

function SchoolDialogActions({
  busy,
  disabled = false,
  label,
  onClose,
}: {
  busy: boolean;
  disabled?: boolean;
  label: string;
  onClose: () => void;
}) {
  const text = useSchoolText();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={onClose}
      >
        {text("Cancel", "取消")}
      </Button>
      <Button type="submit" disabled={busy || disabled} aria-busy={busy}>
        {label}
      </Button>
    </div>
  );
}

function accountLabel(member: MemberAccount) {
  return `${member.name} · ${member.username ?? member.accountId}`;
}

function LinkAccount({
  base,
  identity,
  onClose,
  onSaved,
}: {
  base: string;
  identity: DirectoryIdentity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = useSchoolText();
  const [selected, setSelected] = useState<MemberAccount | null>(null);
  return (
    <SchoolPicker
      title={text("Link account", "关联账号")}
      description={text(
        `Choose a school member for ${identity.name}. A linked teacher can view the rosters assigned to this identity.`,
        `为 ${identity.name} 选择一位本校成员。教师关联后可以查看分配给此档案的班级名单。`,
      )}
      selection={selected ? accountLabel(selected) : undefined}
      actionLabel={text("Link account", "关联账号")}
      onClose={onClose}
      onConfirm={async () => {
        if (!selected) return;
        await productionApi(`${base}/identities/${identity.id}/account`, {
          method: "PATCH",
          body: { accountId: selected.accountId },
        });
        onSaved();
      }}
    >
      {(busy) => (
        <SchoolTable<MemberAccount>
          path={`${base}/members?role=${identity.kind}&unlinked=true`}
          label={text("Available member accounts", "可关联的成员账号")}
          empty={text(
            "No available members with this role on this page.",
            "本页没有该角色的可关联成员。",
          )}
          rowKey={(item) => item.accountId}
          columns={[
            { title: text("Name", "姓名"), cell: accountLabel },
            {
              title: text("Actions", "操作"),
              cell: (item) => (
                <PickerChoice
                  name={accountLabel(item)}
                  selected={item.accountId === selected?.accountId}
                  disabled={busy}
                  onSelect={() => setSelected(item)}
                />
              ),
            },
          ]}
        />
      )}
    </SchoolPicker>
  );
}

function PickerChoice({
  name,
  selected,
  disabled,
  onSelect,
}: {
  name: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const text = useSchoolText();
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "primary" : "secondary"}
      aria-pressed={selected}
      aria-label={text(`Select ${name}`, `选择 ${name}`)}
      disabled={disabled}
      onClick={onSelect}
    >
      {selected ? text("Selected", "已选择") : text("Select", "选择")}
    </Button>
  );
}

function SchoolPicker({
  title,
  description,
  selection,
  actionLabel,
  onClose,
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  selection?: string;
  actionLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  children: (busy: boolean) => ReactNode;
}) {
  const text = useSchoolText();
  const action = useMutation();
  const localError = useSchoolError();
  return (
    <Modal
      title={title}
      description={description}
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      {children(action.busy)}
      <p role="status" className="break-words text-sm text-muted-foreground">
        {selection
          ? text(`Selected · ${selection}`, `已选择 · ${selection}`)
          : text("Select one record to continue.", "请选择一条记录。")}
      </p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!selection || action.busy) return;
          void action.run(async () => {
            try {
              await onConfirm();
            } catch (error) {
              throw localError(error);
            }
          });
        }}
      >
        <Feedback action={action} />
        <SchoolDialogActions
          busy={action.busy}
          disabled={!selection}
          label={actionLabel}
          onClose={onClose}
        />
      </form>
    </Modal>
  );
}

function ConfirmSchoolAction({
  title,
  description,
  actionLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const text = useSchoolText();
  const action = useMutation();
  const localError = useSchoolError();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.busy) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <Feedback action={action} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            ref={cancel}
            variant="secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            {text("Cancel", "取消")}
          </Button>
          <Button
            variant="danger"
            disabled={action.busy}
            aria-busy={action.busy}
            onClick={() =>
              void action.run(async () => {
                try {
                  await onConfirm();
                } catch (error) {
                  throw localError(error);
                }
              })
            }
          >
            {actionLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
