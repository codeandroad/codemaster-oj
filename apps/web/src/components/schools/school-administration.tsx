"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  Feedback,
  inputClass,
  Loading,
  Modal,
  useData,
  useMutation,
} from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import { cn } from "@/lib/utils";
import { SchoolIdentityImport } from "./school-identity-import";
import { SchoolCourses } from "./school-courses";
import { SchoolClasses } from "./school-classes";
import { SchoolActivationButton } from "./school-activation-button";
import {
  RoleLabel,
  useSchoolError,
  useSchoolText,
  type School,
} from "./school-ui";

export type SchoolSection = "members" | "identities" | "classes" | "courses";
type IdentityKind = "student" | "teacher";
type Identity = {
  id: string;
  name: string;
  number: string;
  kind: IdentityKind;
};
type DirectoryIdentity = Identity & { accountId: string | null };
type MemberAccount = { accountId: string; name: string; username?: string };
type ClassType = "administrative" | "training";
type Page<T> = { items: T[]; page: number; hasMore: boolean };
type Column<T> = { title: string; cell: (item: T) => ReactNode };

export function SchoolAdministration({
  school,
  members,
  refreshRevision,
  actions,
  navigationDisabled = false,
  currentSection,
}: {
  school: School;
  members: ReactNode;
  refreshRevision: number;
  actions: ReactNode;
  navigationDisabled?: boolean;
  currentSection?: SchoolSection;
}) {
  const text = useSchoolText();
  const admin = school.roles.includes("school_admin");
  const identityId = useSearchParams().get("identityId");
  const [section, setSection] = useState<SchoolSection>("classes");
  const sections = [
    ["classes", text("Classes", "班级")],
    ["courses", text("Courses", "课程")],
    ["identities", text("Identities", "身份档案")],
    ["members", text("Members", "成员")],
  ] as const;
  const requestedSection = currentSection ?? section;
  const activeSection =
    admin || requestedSection === "courses" ? requestedSection : "classes";
  const base = `schools/${school.id}`;
  return (
    <div
      className={
        activeSection === "classes" || activeSection === "courses"
          ? ""
          : "rounded-lg border border-border bg-surface p-4"
      }
    >
      {!currentSection && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
          <div
            role="group"
            aria-label={text("School sections", "学校功能")}
            className="flex flex-wrap gap-1"
          >
            {(admin ? sections : sections.slice(0, 2)).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={value === activeSection ? "primary" : "ghost"}
                aria-pressed={value === activeSection}
                disabled={navigationDisabled}
                onClick={() => setSection(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {actions}
        </div>
      )}
      {activeSection === "members" && members}
      {activeSection === "courses" && (
        <SchoolCourses school={school} refreshRevision={refreshRevision} />
      )}
      {activeSection === "identities" && (
        <SchoolDirectory
          base={base}
          school={school}
          refreshRevision={refreshRevision}
          highlightedIdentityId={identityId}
        />
      )}
      {activeSection === "classes" && (
        <SchoolClasses school={school} refreshRevision={refreshRevision} />
      )}
    </div>
  );
}

function SchoolDirectory({
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
  const [kind, setKind] = useState<IdentityKind | "">("");
  const [edit, setEdit] = useState(false);
  const [importing, setImporting] = useState(false);
  const [link, setLink] = useState<DirectoryIdentity | null>(null);
  const [unlink, setUnlink] = useState<DirectoryIdentity | null>(null);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");

  function saved(nextMessage: string) {
    setEdit(false);
    setImporting(false);
    setLink(null);
    setUnlink(null);
    setRevision((value) => value + 1);
    setMessage(nextMessage);
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {text("School identities", "校内身份档案")}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setImporting(true)}
          >
            {text("Import identities", "导入身份")}
          </Button>
          <Button type="button" size="sm" onClick={() => setEdit(true)}>
            <Plus size={14} />
            {text("Create identity", "新建身份")}
          </Button>
        </div>
      </div>
      <IdentityFilter onQuery={setQuery} kind={kind} onKind={setKind} />
      <Feedback action={{ error: "", message }} />
      <SchoolTable<DirectoryIdentity>
        key={`${kind}:${query}:${revision}:${refreshRevision}`}
        path={identityPath(base, kind, query)}
        label={text("School identities", "校内身份档案")}
        empty={
          query
            ? text(
                "No identities match this search.",
                "没有符合搜索条件的身份档案。",
              )
            : text("No identities on this page.", "本页没有身份档案。")
        }
        rowKey={(item) => item.id}
        highlightedRowKey={highlightedIdentityId}
        columns={[
          ...identityColumns(text),
          {
            title: text("Account", "账号"),
            cell: (item) =>
              item.accountId
                ? text("Linked", "已关联")
                : text("Unlinked", "未关联"),
          },
          {
            title: text("Actions", "操作"),
            cell: (item) => (
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={
                    item.accountId
                      ? text(
                          `Unlink account for ${item.name}`,
                          `解除 ${item.name} 的账号关联`,
                        )
                      : text(
                          `Link account for ${item.name}`,
                          `为 ${item.name} 关联账号`,
                        )
                  }
                  onClick={() =>
                    item.accountId ? setUnlink(item) : setLink(item)
                  }
                >
                  {item.accountId
                    ? text("Unlink", "解除关联")
                    : text("Link account", "关联账号")}
                </Button>

                {!item.accountId && (
                  <SchoolActivationButton school={school} identity={item} />
                )}
              </div>
            ),
          },
        ]}
      />
      {importing && (
        <SchoolIdentityImport
          school={school}
          onClose={() => setImporting(false)}
          onSaved={saved}
        />
      )}
      {edit && (
        <CreateSchoolRecord
          endpoint={`${base}/identities`}
          type="identity"
          schoolName={school.name}
          onClose={() => setEdit(false)}
          onSaved={() => saved(text("Identity created.", "已创建身份档案。"))}
        />
      )}
      {link && (
        <LinkAccount
          base={base}
          identity={link}
          onClose={() => setLink(null)}
          onSaved={() => saved(text("Account linked.", "已关联账号。"))}
        />
      )}
      {unlink && (
        <ConfirmSchoolAction
          title={text("Unlink account?", "解除账号关联？")}
          description={text(
            `Unlink the account from ${unlink.name} at ${school.name}. Their login and school membership remain active. A teacher will lose access to the rosters assigned through this identity.`,
            `解除 ${unlink.name} 在 ${school.name} 的账号关联。其登录账号和学校成员关系继续有效，教师将失去通过此档案获得的班级名单访问权限。`,
          )}
          actionLabel={text("Unlink account", "解除账号关联")}
          onClose={() => setUnlink(null)}
          onConfirm={async () => {
            await productionApi(`${base}/identities/${unlink.id}/account`, {
              method: "PATCH",
              body: { accountId: null, expectedAccountId: unlink.accountId },
            });
            saved(text("Account unlinked.", "已解除账号关联。"));
          }}
        />
      )}
    </div>
  );
}

function identityPath(base: string, kind: IdentityKind | "", query: string) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (query) params.set("q", query);
  return params.size ? `${base}/identities?${params}` : `${base}/identities`;
}

function identityColumns<T extends Identity>(
  text: ReturnType<typeof useSchoolText>,
): Column<T>[] {
  return [
    {
      title: text("ID number", "身份编号"),
      cell: (item) => <span className="font-mono text-xs">{item.number}</span>,
    },
    { title: text("Name", "姓名"), cell: (item) => item.name },
    {
      title: text("Role", "角色"),
      cell: (item) => <RoleLabel role={item.kind} />,
    },
  ];
}

function IdentityFilter({
  onQuery,
  kind,
  onKind,
  fixedKind = false,
}: {
  onQuery: (query: string) => void;
  kind: IdentityKind | "";
  onKind: (kind: IdentityKind | "") => void;
  fixedKind?: boolean;
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
          aria-label={text("Search name or ID number", "搜索姓名或身份编号")}
          placeholder={text("Search name or ID number", "搜索姓名或身份编号")}
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
    <SchoolTablePage key={page} {...props} page={page} setPage={setPage} />
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
  endpoint,
  type,
  schoolName,
  onClose,
  onSaved,
}: {
  endpoint: string;
  type: "identity" | "class";
  schoolName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = useSchoolText();
  const action = useMutation();
  const localError = useSchoolError();
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [kind, setKind] = useState<IdentityKind>("student");
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
          ? { name: name.trim(), number: number.trim(), kind }
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
              `Create a student or teacher identity at ${schoolName}. Link it to a school member after saving.`,
              `在 ${schoolName} 创建学生或教师身份，保存后可关联本校成员账号。`,
            )
          : text(
              `Create a class at ${schoolName}. Add students and teachers from the school directory after saving.`,
              `在 ${schoolName} 创建班级，保存后可从身份档案中添加学生和教师。`,
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
