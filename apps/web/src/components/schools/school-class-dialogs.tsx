"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  Feedback,
  inputClass,
  Loading,
  Modal,
  useData,
  useMutation,
} from "@/components/admin/common";
import { Table } from "@/components/teacher/shared";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import {
  schoolDisplayName,
  useSchoolError,
  useSchoolText,
  type School,
} from "./school-ui";
import type { SchoolClassRecord } from "./school-classes";

export function SchoolClassEditor({
  school,
  item,
  onClose,
  onSaved,
}: {
  school: School;
  item?: SchoolClassRecord;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const localError = useSchoolError();
  const action = useMutation();
  const [name, setName] = useState(item?.name ?? "");
  const [type, setType] = useState<"administrative" | "training">(
    item?.type ?? "training",
  );
  const [invalid, setInvalid] = useState(false);
  const lock = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (!name.trim()) {
      setInvalid(true);
      nameInput.current?.focus();
      return;
    }
    lock.current = true;
    void action
      .run(async () => {
        try {
          const saved = await productionApi<SchoolClassRecord>(
            `schools/${school.id}/classes${item ? `/${item.id}` : ""}`,
            {
              method: item ? "PATCH" : "POST",
              body: {
                name: name.trim(),
                type,
                ...(item ? { expectedRevision: item.revision } : {}),
              },
            },
          );
          onClose();
          onSaved(saved.id);
        } catch (error) {
          throw localError(error);
        }
      })
      .finally(() => {
        lock.current = false;
      });
  }
  return (
    <Modal
      title={
        item ? text("Edit class", "编辑班级") : text("New class", "新建班级")
      }
      description={schoolDisplayName(school, locale)}
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        <label className="block space-y-1 text-sm font-semibold">
          <span>{text("Class name", "班级名称")}</span>
          <input
            ref={nameInput}
            autoFocus
            className={inputClass}
            value={name}
            maxLength={100}
            required
            disabled={action.busy}
            aria-invalid={invalid}
            onChange={(event) => {
              setName(event.target.value);
              setInvalid(false);
            }}
          />
        </label>
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {text("Enter a class name.", "请输入班级名称。")}
          </p>
        )}
        <label className="block space-y-1 text-sm font-semibold">
          <span>{text("Class type", "班级类型")}</span>
          <select
            className={inputClass}
            value={type}
            disabled={action.busy}
            onChange={(event) => setType(event.target.value as typeof type)}
          >
            <option value="administrative">
              {text("Administrative class", "行政班")}
            </option>
            <option value="training">{text("Training class", "训练班")}</option>
          </select>
        </label>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            {text("Cancel", "取消")}
          </Button>
          <Button type="submit" disabled={action.busy}>
            {text("Save", "保存")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Candidate = {
  id: string;
  name: string;
  number: string;
  kind: "student" | "teacher";
  accountLinked: boolean;
};
export function SchoolClassRosterPicker({
  school,
  item,
  kind,
  onClose,
  onSaved,
}: {
  school: School;
  item: SchoolClassRecord;
  kind: "student" | "teacher";
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = useSchoolText();
  const localError = useSchoolError();
  const action = useMutation();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const lock = useRef(false);
  async function add() {
    if (!selected || lock.current) return;
    lock.current = true;
    await action.run(async () => {
      try {
        await productionApi(`schools/${school.id}/classes/${item.id}/roster`, {
          method: "POST",
          body: { identityId: selected.id },
        });
        onClose();
        onSaved();
      } catch (error) {
        throw localError(error);
      }
    });
    lock.current = false;
  }
  return (
    <Modal
      title={
        kind === "teacher"
          ? text("Assign teacher", "分配教师")
          : text("Add student", "添加学生")
      }
      description={item.name}
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
            setPage(1);
            setSelected(null);
          }}
        >
          <input
            autoFocus
            className={inputClass}
            value={search}
            maxLength={100}
            disabled={action.busy}
            aria-label={text("Search name or ID", "搜索姓名或编号")}
            placeholder={text("Search name or ID", "搜索姓名或编号")}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={action.busy}>
            {text("Search", "搜索")}
          </Button>
        </form>
        <CandidateRows
          key={`${kind}:${query}:${page}`}
          path={`schools/${school.id}/classes/${item.id}/candidates?${new URLSearchParams({ kind, q: query, page: String(page) })}`}
          selected={selected}
          onSelect={setSelected}
          disabled={action.busy}
          page={page}
          onPage={(value) => {
            setPage(value);
            setSelected(null);
          }}
        />
        {selected && (
          <p className="text-sm">
            {text("Selected: ", "已选择：")}
            {selected.name} · {selected.number}
          </p>
        )}
        {selected?.kind === "teacher" && !selected.accountLinked && (
          <p className="text-sm text-muted-foreground">
            {text(
              "This teacher can access the class after their school identity is linked to an account.",
              "该教师的本校档案关联账号后，即可访问班级。",
            )}
          </p>
        )}
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={action.busy} onClick={onClose}>
            {text("Cancel", "取消")}
          </Button>
          <Button
            disabled={action.busy || !selected}
            onClick={() => void add()}
          >
            {text("Add", "添加")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CandidateRows({
  path,
  selected,
  onSelect,
  disabled,
  page,
  onPage,
}: {
  path: string;
  selected: Candidate | null;
  onSelect: (item: Candidate) => void;
  disabled: boolean;
  page: number;
  onPage: (page: number) => void;
}) {
  const text = useSchoolText();
  const resource = useData<{ items: Candidate[]; hasMore: boolean }>(path);
  return (
    <Loading resource={resource}>
      <div className="max-h-80 overflow-auto">
        <Table
          headers={[
            text("ID", "编号"),
            text("Name", "姓名"),
            text("Account", "账号"),
            text("Select", "选择"),
          ]}
          min={420}
        >
          {resource.data?.items.map((candidate) => (
            <tr key={candidate.id}>
              <td className="font-mono text-xs">{candidate.number}</td>
              <td>{candidate.name}</td>
              <td>
                {candidate.accountLinked
                  ? text("Linked", "已关联")
                  : text("Not linked", "未关联")}
              </td>
              <td>
                <Button
                  size="sm"
                  variant={
                    selected?.id === candidate.id ? "primary" : "secondary"
                  }
                  aria-pressed={selected?.id === candidate.id}
                  aria-label={text(
                    `Select ${candidate.name}`,
                    `选择 ${candidate.name}`,
                  )}
                  disabled={disabled}
                  onClick={() => onSelect(candidate)}
                >
                  {selected?.id === candidate.id
                    ? text("Selected", "已选择")
                    : text("Select", "选择")}
                </Button>
              </td>
            </tr>
          ))}
          {!resource.data?.items.length && (
            <tr>
              <td
                colSpan={4}
                className="py-6 text-center text-muted-foreground"
              >
                {text(
                  "No matching identities outside this class.",
                  "没有可添加到本班的匹配身份档案。",
                )}
              </td>
            </tr>
          )}
        </Table>
      </div>
      {(page > 1 || resource.data?.hasMore) && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span>{text(`Page ${page}`, `第 ${page} 页`)}</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || page <= 1}
              onClick={() => onPage(page - 1)}
            >
              {text("Previous", "上一页")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || !resource.data?.hasMore}
              onClick={() => onPage(page + 1)}
            >
              {text("Next", "下一页")}
            </Button>
          </div>
        </div>
      )}
    </Loading>
  );
}

export function SchoolClassAction({
  school,
  item,
  action: requestedAction,
  onClose,
  onSaved,
}: {
  school: School;
  item: SchoolClassRecord;
  action: "archive" | "restore" | { id: string; name: string; kind: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const text = useSchoolText();
  const localError = useSchoolError();
  const action = useMutation();
  const lock = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const roster = typeof requestedAction !== "string" ? requestedAction : null;
  const label = roster
    ? text("Remove from class", "移出班级")
    : requestedAction === "archive"
      ? text("Archive class", "归档班级")
      : text("Restore class", "恢复班级");
  async function confirm() {
    if (lock.current) return;
    lock.current = true;
    await action.run(async () => {
      try {
        const base = `schools/${school.id}/classes/${item.id}`;
        await productionApi(
          roster ? `${base}/roster/${roster.id}` : `${base}/${requestedAction}`,
          roster
            ? { method: "DELETE" }
            : { method: "POST", body: { expectedRevision: item.revision } },
        );
        onClose();
        onSaved();
      } catch (error) {
        throw localError(error);
      }
    });
    lock.current = false;
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !lock.current) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (action.busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (action.busy) event.preventDefault();
        }}
      >
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>
          {roster
            ? text(
                `Remove ${roster.name} from ${item.name}? Their school identity and learning records are retained.`,
                `将 ${roster.name} 移出 ${item.name}？校内身份与学习记录会保留。`,
              )
            : requestedAction === "archive"
              ? text(
                  `Archive ${item.name}? The class roster and learning records are retained; restore it before editing or importing.`,
                  `归档 ${item.name}？班级名单和学习记录会保留，恢复后可继续编辑和导入。`,
                )
              : text(
                  `Restore ${item.name} to active classes?`,
                  `将 ${item.name} 恢复到使用中的班级？`,
                )}
        </DialogDescription>
        <Feedback action={action} />
        <div className="flex justify-end gap-2">
          <Button
            ref={cancel}
            variant="secondary"
            disabled={action.busy}
            onClick={onClose}
          >
            {text("Cancel", "取消")}
          </Button>
          <Button disabled={action.busy} onClick={() => void confirm()}>
            {label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
