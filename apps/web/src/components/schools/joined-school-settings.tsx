"use client";

import { useRef, useState } from "react";
import { ArrowUpRight, ChevronRight, ShieldCheck, UserPlus } from "lucide-react";
import {
  Feedback,
  Loading,
  panelClass,
  useData,
  useMutation,
} from "@/components/admin/common";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { productionApi, type CampusUser } from "@/lib/production-api";
import { JoinSchoolForm } from "./join-school-form";
import { schoolWorkspaceHref } from "./school-workspace-location";
import { writeSchoolPreference } from "./school-selection";
import { SchoolSettingsDialog } from "./school-settings";
import {
  RoleLabel,
  schoolDisplayName,
  useSchoolError,
  useSchoolText,
  type School,
} from "./school-ui";

type DefaultWorkspace = { defaultSchoolId: string | null };

export function JoinedSchoolSettings({
  user,
  onSchoolsChanged,
}: {
  user: CampusUser;
  onSchoolsChanged?: () => void;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const localError = useSchoolError();
  const schools = useData<{ items: School[] }>("schools");
  const defaults = useData<DefaultWorkspace>("auth/default-workspace");
  const [savedDefault, setSavedDefault] = useState<DefaultWorkspace | null>(
    null,
  );
  const [selected, setSelected] = useState<School | null>(null);
  const [joining, setJoining] = useState(false);
  const action = useMutation();
  const pending = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const defaultId = (savedDefault ?? defaults.data)?.defaultSchoolId;
  const staff = user.platformAdmin || user.roles.some(role => role !== "student") ||
    schools.data?.items.some(school => school.roles.some(role => role !== "student"));
  function changed() {
    schools.reload();
    window.dispatchEvent(new Event("codemaster:schools-changed"));
    onSchoolsChanged?.();
  }
  function closeSchool() {
    setSelected(null);
    requestAnimationFrame(() => returnFocus.current?.focus());
  }
  async function setDefault(schoolId: string | null) {
    if (pending.current) return;
    pending.current = true;
    await action.run(async () => {
      try {
        const result = await productionApi<DefaultWorkspace>(
          "auth/default-workspace",
          { method: "PATCH", body: { defaultSchoolId: schoolId } },
        );
        setSavedDefault(result);
        defaults.reload();
        action.success(
          schoolId
            ? text(
                "Default school saved for your next sign-in.",
                "默认学校已保存，下次登录时生效。",
              )
            : text("Default school cleared.", "已取消默认学校。"),
        );
      } catch (error) {
        throw localError(error);
      }
    });
    pending.current = false;
  }
  return (
    <section
      id="schools"
      className={`${panelClass} mt-4 scroll-mt-20`}
      aria-labelledby="joined-schools-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="joined-schools-title" className="font-semibold">
            {text("Schools", "学校")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {text(
              "Manage your schools and choose where to start after signing in.",
              "管理已加入的学校，选择登录后默认进入的学校。",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {staff && <AppLink href="/practice/courses" className="inline-flex min-h-9 items-center rounded-md px-2 text-sm font-medium text-primary hover:bg-muted">{text("Public learning", "公开学习")}</AppLink>}
          {user.platformAdmin && <AppLink href="/platform" className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary hover:bg-muted"><ShieldCheck size={15} aria-hidden="true" />{text("Platform administration", "平台管理")}</AppLink>}
        <Button
          size="sm"
          variant="secondary"
          disabled={action.busy}
          onClick={() => {
            returnFocus.current = document.activeElement as HTMLElement;
            setJoining(true);
          }}
        >
          <UserPlus size={15} aria-hidden="true" />
          {text("Join with an invitation", "使用邀请码加入")}
        </Button>
        </div>
      </div>
      <div className="px-4 pb-4">
        <Loading resource={schools}>
          <Loading resource={defaults}>
            {schools.data?.items.length ? (
              <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                {schools.data.items.map((school) => (
                  <li
                    key={school.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                      onClick={(event) => {
                        returnFocus.current = event.currentTarget;
                        setSelected(school);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-semibold">
                          {schoolDisplayName(school, locale)}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {school.roles.map((role, index) => (
                            <span key={role}>
                              {index > 0 && " · "}
                              <RoleLabel role={role} />
                            </span>
                          ))}
                        </span>
                      </span>
                      <ChevronRight
                        size={15}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                    </button>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      {school.id === defaultId && (
                        <span className="rounded bg-accent px-2 py-1 text-xs font-medium text-primary">
                          {text("Default", "默认")}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={action.busy}
                        aria-label={
                          school.id === defaultId
                            ? text(
                                `Clear ${schoolDisplayName(school, locale)} as default`,
                                `取消 ${schoolDisplayName(school, locale)} 为默认学校`,
                              )
                            : text(
                                `Set ${schoolDisplayName(school, locale)} as default`,
                                `将 ${schoolDisplayName(school, locale)} 设为默认学校`,
                              )
                        }
                        onClick={() =>
                          void setDefault(
                            school.id === defaultId ? null : school.id,
                          )
                        }
                      >
                        {school.id === defaultId
                          ? text("Clear default", "取消默认")
                          : text("Set default", "设为默认")}
                      </Button>
                      {school.legacy && [...new Set([...user.roles, ...(user.roles.includes("admin") ? ["teacher" as const] : [])])].length > 1 && <div className="flex flex-wrap items-center gap-1">{[...new Set([...user.roles, ...(user.roles.includes("admin") ? ["teacher" as const] : [])])].map(role => <AppLink key={role} href={role === "student" ? "/" : `/${role}`} onNavigate={() => writeSchoolPreference(user.id, school.id)} className="inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium text-primary hover:bg-muted">{role === "admin" ? text("Administration", "管理工作区") : role === "teacher" ? text("Teaching", "教学工作区") : text("Learning", "学生工作区")}</AppLink>)}</div>}
                      {!school.legacy && school.roles.includes("school_admin") && (
                        <AppLink
                          href={schoolWorkspaceHref(school.id, "home", "teacher")}
                          className="inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium text-primary hover:bg-muted"
                        >
                          {text("Teaching workspace", "教学工作区")}
                        </AppLink>
                      )}
                      <AppLink
                        href={schoolWorkspaceHref(school.id)}
                        onNavigate={() =>
                          writeSchoolPreference(user.id, school.id)
                        }
                        className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                        aria-label={text(
                          `Open ${schoolDisplayName(school, locale)}`,
                          `进入 ${schoolDisplayName(school, locale)}`,
                        )}
                      >
                        {text("Open", "进入")}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </AppLink>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-sm text-muted-foreground">
                {text(
                  "You have not joined a school. Public courses and practice are still available.",
                  "你尚未加入学校，仍可学习公开课程和进行自由练习。",
                )}
              </p>
            )}
          </Loading>
        </Loading>
        <Feedback action={action} />
      </div>
      {selected && (
        <SchoolSettingsDialog
          key={selected.id}
          school={selected}
          onClose={closeSchool}
          onSaved={() => {
            closeSchool();
            changed();
            action.success(text("School names updated.", "学校名称已更新。"));
          }}
        />
      )}
      {joining && (
        <JoinSchoolDialog
          onClose={() => {
            setJoining(false);
            requestAnimationFrame(() => returnFocus.current?.focus());
          }}
          onJoined={() => {
            setJoining(false);
            changed();
            action.success(text("School joined.", "已加入学校。"));
            requestAnimationFrame(() => returnFocus.current?.focus());
          }}
        />
      )}
    </section>
  );
}

export function JoinSchoolDialog({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (schoolId: string) => void;
}) {
  const text = useSchoolText();
  const action = useMutation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>{text("Join a school", "加入学校")}</DialogTitle>
        <DialogDescription>
          {text(
            "Enter the invitation code from your school administrator.",
            "填写学校管理员提供的邀请码。",
          )}
        </DialogDescription>
        <JoinSchoolForm
          action={action}
          onCancel={onClose}
          onJoined={onJoined}
        />
      </DialogContent>
    </Dialog>
  );
}
