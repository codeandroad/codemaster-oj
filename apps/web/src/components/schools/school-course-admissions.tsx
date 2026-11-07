"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loading, panelClass, useData } from "@/components/admin/common";
import { AppLink } from "@/components/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { CourseAdmissionsDialog } from "./course-admissions-dialog";
import { useSchoolText } from "./school-ui";

export const legacyCourseAdmissionsHref = "/admin/course-admissions";
export const legacyCourseAdmissionsSchoolId = "00000000-0000-4000-8000-000000000052";

type Course = { id: string; title: string; pendingCount: number };
type AdmissionsList = { items: Course[]; page: number; hasMore: boolean };

export function SchoolCourseAdmissions({ schoolId, href, coursesHref }: {
  schoolId: string;
  href: string;
  coursesHref: string;
}) {
  const text = useSchoolText();
  const router = useRouter();
  const search = useSearchParams();
  const [page, setPage] = useState(1);
  const courses = useData<AdmissionsList>(`schools/${schoolId}/course-admissions?page=${page}`);
  const courseId = search.get("courseId");
  const applicationId = search.get("applicationId") ?? undefined;
  const course = courses.data?.items.find(item => item.id === courseId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {text("Review requests to access your school's courses.", "审核本校课程的访问申请。")}
        </p>
        <AppLink href={coursesHref} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          {text("Manage courses", "管理课程")}
        </AppLink>
      </div>
      <Loading resource={courses}>
        {courses.data && (
          <>
            <section className={`${panelClass} overflow-x-auto`}>
              <table aria-label={text("Course applications", "课程申请")} className="w-full text-left text-sm">
                <thead className="bg-surface-subtle text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3">{text("Course", "课程")}</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">{text("Pending requests", "待审核申请")}</th>
                    <th scope="col" className="px-4 py-3">{text("Actions", "操作")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {courses.data.items.map(item => (
                    <tr key={item.id}>
                      <th scope="row" className="px-4 py-2 font-medium">{item.title}</th>
                      <td className={`px-4 py-2 tabular-nums ${item.pendingCount ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                        {item.pendingCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <AppLink href={`${href}${href.includes("?") ? "&" : "?"}${new URLSearchParams({ courseId: item.id })}`}
                          className={buttonVariants({ variant: "ghost", size: "sm" })}>
                          {text("Review requests", "查看申请")}
                        </AppLink>
                      </td>
                    </tr>
                  ))}
                  {!courses.data.items.length && (
                    <tr><td colSpan={3} className="px-4 py-7 text-center text-muted-foreground">
                      {page === 1 ? text("No courses are accepting applications. You can open applications in course management.", "暂无课程开放申请。可在课程管理中开放申请。")
                        : text("There are no more courses on this page.", "本页暂无课程。")}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </section>
            {(page > 1 || courses.data.hasMore) && (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" disabled={page === 1 || page !== courses.data.page} onClick={() => setPage(page - 1)}>
                  {text("Previous", "上一页")}
                </Button>
                <Button size="sm" variant="secondary" disabled={!courses.data.hasMore || page !== courses.data.page} onClick={() => setPage(page + 1)}>
                  {text("Next", "下一页")}
                </Button>
              </div>
            )}
          </>
        )}
      </Loading>
      {courseId && (
        <CourseAdmissionsDialog key={`${courseId}:${applicationId ?? ""}`} schoolId={schoolId}
          course={{ id: courseId, title: course?.title ?? "" }} applicationId={applicationId}
          onChanged={courses.reload} onClose={() => router.replace(href)}/>
      )}
    </div>
  );
}
