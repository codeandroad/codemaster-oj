"use client";

import { AppLink } from "@/components/navigation";
import { PageHeader } from "@/components/page-chrome";
import { buttonVariants } from "@/components/ui/button";
import { useLocale } from "@/components/locale-context";
import { workspaceNavigation } from "@/components/workspace-navigation";
import { schoolWorkspaceHref } from "@/components/schools/school-workspace-location";
import { Loading, panelClass, useData } from "./common";
import type { Person, SchoolClass } from "@/lib/production-api";

type DashboardClass = Pick<SchoolClass, "id" | "name"> & {
  studentIds?: string[];
  studentCount?: number;
};

export function AdminDashboard({ schoolId }: { schoolId?: string }) {
  const { t, locale } = useLocale();
  const people = useData<{ items: Pick<Person, "id" | "name" | "number">[] }>(schoolId ? `schools/${schoolId}/identities` : "people");
  const classes = useData<{ items: DashboardClass[] }>(schoolId ? `schools/${schoolId}/classes` : "classes");
  const peopleHref = schoolId ? schoolWorkspaceHref(schoolId, "identities") : "/admin/people";
  const teacherHref = schoolId ? schoolWorkspaceHref(schoolId, "home", "teacher") : null;
  const personHref = (id: string) => schoolId
    ? `${peopleHref}&identityId=${encodeURIComponent(id)}`
    : `${peopleHref}?personId=${encodeURIComponent(id)}`;
  const classHref = (id: string) => schoolId
    ? `${schoolWorkspaceHref(schoolId, "classes", "teacher")}&classId=${encodeURIComponent(id)}`
    : `${peopleHref}?classId=${encodeURIComponent(id)}`;
  return (
    <>
      <PageHeader
        eyebrow={t("管理员首页")}
        title={t("管理工作台")}
        description={t("维护学校身份与账号，查看导入、判题服务和系统设置。")}
        action={teacherHref && <AppLink href={teacherHref} className={buttonVariants({ variant: "secondary" })}>
          {locale === "en" ? "Teaching workspace" : "教学工作区"}
        </AppLink>}
      />
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {workspaceNavigation.admin.slice(1, 4).map(item => (
          <AppLink
            key={item.path}
            href={schoolId ? schoolWorkspaceHref(schoolId, item.section) : item.path}
            className={`${panelClass} flex items-center gap-4 p-5 hover:border-primary`}
          >
            <item.icon className="text-primary" />
            <span className="font-bold">{t(item.label)}</span>
          </AppLink>
        ))}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className={panelClass}>
          <div className="flex justify-between border-b border-border p-4">
            <h2 className="font-bold">{t("身份档案")}</h2>
            <AppLink href={peopleHref} className="text-sm font-semibold text-primary">{t("查看全部")}</AppLink>
          </div>
          <Loading resource={people}>
            <div className="divide-y divide-border">
              {people.data?.items.slice(0, 8).map(person => (
                <div key={person.id} className="flex justify-between gap-3 p-4 text-sm">
                  <AppLink href={personHref(person.id)} className="font-semibold text-primary hover:underline focus-visible:underline">{person.name}</AppLink>
                  <span className="font-mono text-xs text-muted-foreground">{person.number}</span>
                </div>
              ))}
              {!people.data?.items.length && <p className="p-5 text-sm text-muted-foreground">{t("暂无身份，请先建立档案或导入名单。")}</p>}
            </div>
          </Loading>
        </section>
        <section className={panelClass}>
          <div className="border-b border-border p-4"><h2 className="font-bold">{t("学校班级")}</h2></div>
          <Loading resource={classes}>
            <div className="divide-y divide-border">
              {classes.data?.items.map(cls => (
                <div key={cls.id} className="flex justify-between gap-3 p-4 text-sm">
                  <AppLink href={classHref(cls.id)} className="font-semibold text-primary hover:underline focus-visible:underline">{cls.name}</AppLink>
                  <span className="text-muted-foreground">{cls.studentCount ?? cls.studentIds?.length ?? 0}{locale === "en" ? " students" : " 位学生"}</span>
                </div>
              ))}
              {!classes.data?.items.length && <p className="p-5 text-sm text-muted-foreground">{t("暂无班级，可在教学工作区建立。")}</p>}
            </div>
          </Loading>
        </section>
      </div>
    </>
  );
}
