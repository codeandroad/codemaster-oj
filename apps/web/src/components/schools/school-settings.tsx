"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Feedback,
  inputClass,
  Loading,
  useData,
} from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, productionApi } from "@/lib/production-api";
import { useLocale } from "@/components/locale-context";
import { SchoolExitRequestAction } from "./school-exit-request";
import {
  RoleLabel,
  schoolDisplayName,
  useSchoolText,
  type School,
} from "./school-ui";

export type SchoolSettingsRecord = {
  id: string;
  name: string;
  nameZh: string;
  nameEn: string;
  revision: number;
};

export function SchoolSettingsDialog({
  school,
  onClose,
  onSaved,
}: {
  school: School;
  onClose: () => void;
  onSaved: (school: SchoolSettingsRecord) => void;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  if (school.roles.includes("school_admin"))
    return (
      <EditableSchoolDialog
        school={school}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogTitle className="break-words pr-8 leading-snug">
          {schoolDisplayName(school, locale)}
        </DialogTitle>
        <DialogDescription>
          {text("Your school membership", "你在此学校的成员身份")}
        </DialogDescription>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{text("Role", "角色")}</dt>
            <dd className="mt-1 font-medium">
              <SchoolRoles school={school} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {text("Chinese name", "中文名称")}
            </dt>
            <dd className="mt-1 break-words">{school.nameZh || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {text("English name", "英文名称")}
            </dt>
            <dd className="mt-1 break-words">{school.nameEn || "—"}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {text(
            "School administrators manage these names.",
            "学校名称由本校管理员维护。",
          )}
        </p>
        {school.roles.includes("student") && school.roles.every(role => role === "student") && (
          <SchoolExitRequestAction
            schoolId={school.id}
            schoolName={schoolDisplayName(school, locale)}
          />
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {text("Close", "关闭")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SchoolRoles({ school }: { school: School }) {
  return school.roles.map((role, index) => (
    <span key={role}>
      {index > 0 && " · "}
      <RoleLabel role={role} />
    </span>
  ));
}

function EditableSchoolDialog({
  school,
  onClose,
  onSaved,
}: {
  school: School;
  onClose: () => void;
  onSaved: (school: SchoolSettingsRecord) => void;
}) {
  const text = useSchoolText();
  const data = useData<SchoolSettingsRecord>(`schools/${school.id}/settings`);
  if (data.data && !data.error)
    return (
      <SchoolNamesEditor
        initial={data.data}
        school={school}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{text("School details", "学校基础信息")}</DialogTitle>
        <DialogDescription>
          {text(
            "Manage the names shown in your school workspace.",
            "管理学校工作区中显示的名称。",
          )}
        </DialogDescription>
        <Loading resource={data}>{null}</Loading>
      </DialogContent>
    </Dialog>
  );
}

export function SchoolSettings({
  schoolId,
  onSaved,
}: {
  schoolId: string;
  onSaved?: (school: SchoolSettingsRecord) => void;
}) {
  const text = useSchoolText();
  const data = useData<SchoolSettingsRecord>(`schools/${schoolId}/settings`);
  const [editing, setEditing] = useState<SchoolSettingsRecord | null>(null);
  const [message, setMessage] = useState("");
  const editButton = useRef<HTMLButtonElement>(null);
  function closeEditor() {
    setEditing(null);
    data.reload();
    requestAnimationFrame(() => editButton.current?.focus());
  }
  return (
    <Loading resource={data}>
      {data.data && (
        <section className="mt-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {text("School details", "学校基础信息")}
            </h2>
            <Button
              ref={editButton}
              size="sm"
              variant="secondary"
              onClick={() => {
                setMessage("");
                setEditing(data.data);
              }}
            >
              {text("Edit names", "修改名称")}
            </Button>
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">
                {text("Chinese name", "中文名称")}
              </dt>
              <dd className="mt-1 break-words font-medium">
                {data.data.nameZh || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {text("English name", "英文名称")}
              </dt>
              <dd className="mt-1 break-words font-medium">
                {data.data.nameEn || "—"}
              </dd>
            </div>
          </dl>
          <Feedback action={{ error: "", message }} />
        </section>
      )}
      {editing && (
        <SchoolNamesEditor
          initial={editing}
          onClose={closeEditor}
          onSaved={(school) => {
            closeEditor();
            onSaved?.(school);
            setMessage(text("School names updated.", "学校名称已更新。"));
          }}
        />
      )}
    </Loading>
  );
}

function SchoolNamesEditor({
  initial,
  school,
  onClose,
  onSaved,
}: {
  initial: SchoolSettingsRecord;
  school?: School;
  onClose: () => void;
  onSaved: (school: SchoolSettingsRecord) => void;
}) {
  const text = useSchoolText();
  const [nameZh, setNameZh] = useState(initial.nameZh);
  const [nameEn, setNameEn] = useState(initial.nameEn);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const pending = useRef(false);
  const chineseInput = useRef<HTMLInputElement>(null);
  const englishInput = useRef<HTMLInputElement>(null);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const dirty = nameZh !== initial.nameZh || nameEn !== initial.nameEn;
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function close() {
    if (pending.current) return;
    if (dirty) setDiscard(true);
    else onClose();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const zh = nameZh.trim(),
      en = nameEn.trim();
    if ((!zh && !en) || zh.length > 100 || en.length > 100) {
      setError(
        text(
          "Enter at least one name, with no more than 100 characters each.",
          "请至少填写一个名称，每个名称不超过 100 个字符。",
        ),
      );
      (en.length > 100 ? englishInput : chineseInput).current?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await productionApi<SchoolSettingsRecord>(
        `schools/${initial.id}/settings`,
        {
          method: "PATCH",
          body: { nameZh: zh, nameEn: en, expectedRevision: initial.revision },
        },
      );
      onSaved(updated);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : "";
      setError(
        code === "STALE_SCHOOL_SETTINGS"
          ? text(
              "Another administrator updated these names. Your changes are kept here; close and reload the settings before saving again.",
              "其他管理员已修改名称。当前输入已保留，请关闭并重新加载学校设置后再保存。",
            )
          : ["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED"].includes(code)
            ? text(
                "You no longer have permission to edit this school. Your changes have not been saved.",
                "你已无权修改此学校，当前修改尚未保存。",
              )
            : text(
                "Could not save school names. Check your connection and try again.",
                "学校名称未能保存，请检查网络后重试。",
              ),
      );
      requestAnimationFrame(() => errorElement.current?.focus());
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>
          {discard
            ? text("Discard changes?", "放弃修改？")
            : text("School details", "学校基础信息")}
        </DialogTitle>
        <DialogDescription>
          {discard
            ? text(
                "The names you entered have not been saved.",
                "你填写的名称尚未保存。",
              )
            : text(
                "Add at least one name. The navigation uses the name matching each user's language.",
                "请至少填写一个名称，导航将优先显示与用户页面语言对应的名称。",
              )}
        </DialogDescription>
        {discard ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setDiscard(false)}>
              {text("Keep editing", "继续编辑")}
            </Button>
            <Button variant="destructive" onClick={onClose}>
              {text("Discard changes", "放弃修改")}
            </Button>
          </div>
        ) : (
          <form
            noValidate
            onSubmit={save}
            className="space-y-4"
            aria-busy={busy}
          >
            {school && (
              <p className="text-sm text-muted-foreground">
                <SchoolRoles school={school} />
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                {" "}
                <span>{text("Chinese name", "中文名称")}</span>
                <input
                  ref={chineseInput}
                  className={inputClass}
                  value={nameZh}
                  maxLength={100}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => setNameZh(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                {" "}
                <span>{text("English name", "英文名称")}</span>
                <input
                  ref={englishInput}
                  className={inputClass}
                  value={nameEn}
                  maxLength={100}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => setNameEn(event.target.value)}
                />
              </label>
            </div>
            {error && (
              <p
                ref={errorElement}
                tabIndex={-1}
                role="alert"
                className="text-sm text-destructive outline-none"
              >
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={close}
                disabled={busy}
              >
                {text("Cancel", "取消")}
              </Button>
              <Button type="submit" disabled={!dirty || busy}>
                {busy
                  ? text("Saving…", "保存中…")
                  : text("Save names", "保存名称")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
