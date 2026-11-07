"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Upload } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { PageHeader, StatusPill } from "@/components/page-chrome";
import { Button } from "@/components/ui/button";
import { date, Empty, link, panel, State, Table, useData } from "@/components/teacher/shared";
import { SchoolActivityReportView } from "./school-activities";
import type { ActivityKind, SchoolActivity } from "./school-activities-model";
import { schoolWorkspaceHref } from "./school-workspace-location";
import { ImportClassPicker, SchoolIdentityImport } from "./school-identity-import";
import { type School, useSchoolText } from "./school-ui";

export function SchoolStaffImports({ school, teacher }: { school: School; teacher: boolean }) {
  const text = useSchoolText();
  const canManageAllClasses = school.roles.includes("school_admin");
  const [target, setTarget] = useState<{ id: string; name: string; type?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <>
      <PageHeader title={text("Import center", "导入中心")} />
      <section className={`${panel} space-y-4 p-5`}>
        <div>
          <h2 className="text-lg font-bold">{teacher ? text("Student roster import", "学生名单导入") : text("Identity import", "身份导入")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {teacher
              ? canManageAllClasses
                ? text("Select a school class, then preview a CSV or Excel roster before importing.", "选择本校班级，预览 CSV 或 Excel 名单后再导入。")
                : text("Select a class you teach, then preview a CSV or Excel roster before importing.", "选择负责的班级，预览 CSV 或 Excel 名单后再导入。")
              : text("Preview student or teacher identity records from a CSV or Excel file before importing them into this school.", "预览 CSV 或 Excel 中的学生、教师身份档案后，导入本校。")}
          </p>
        </div>
        {teacher && <div className="max-w-xl"><ImportClassPicker base={`schools/${school.id}`} selected={target} onSelect={setTarget} disabled={importing} required /></div>}
        <Button disabled={teacher && !target} onClick={() => { setImporting(true); setMessage(""); }}>
          <Upload size={16} />
          {teacher ? text("Import roster", "导入名单") : text("Import identities", "导入身份")}
        </Button>
        {message && <p role="status" className="text-sm text-success">{message}</p>}
      </section>
      {importing && <SchoolIdentityImport school={school} initialClass={target} studentClassOnly={teacher} onClose={() => setImporting(false)} onSaved={result => { setImporting(false); setMessage(result); }} />}
    </>
  );
}

export function SchoolTeachingReports({ schoolId }: { schoolId: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const kind = search.get("reportKind") === "timed" ? "timed" : "assignment";
  const archived = search.get("reportArchived") === "1";
  const rawPage = Number(search.get("reportPage") ?? 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000 ? rawPage : 1;
  const activityId = search.get("activityId");
  const base = `schools/${schoolId}/activities`;
  const href = (kind: ActivityKind, archived: boolean, page = 1, activityId?: string) => {
    const params = new URLSearchParams({ reportKind: kind });
    if (archived) params.set("reportArchived", "1");
    if (page > 1) params.set("reportPage", String(page));
    if (activityId) params.set("activityId", activityId);
    return `${schoolWorkspaceHref(schoolId, "reports", "teacher")}&${params}`;
  };
  if (activityId) return <SchoolActivityReportView key={activityId} base={base} activityId={activityId} onBack={() => router.push(href(kind, archived, page))} />;
  return <SchoolReportDirectory key={`${schoolId}:${kind}:${archived}:${page}`} base={base} kind={kind} archived={archived} page={page} href={href} />;
}

function SchoolReportDirectory({ base, kind, archived, page, href }: {
  base: string;
  kind: ActivityKind;
  archived: boolean;
  page: number;
  href: (kind: ActivityKind, archived: boolean, page?: number, activityId?: string) => string;
}) {
  const text = useSchoolText();
  const router = useRouter();
  const data = useData<{ items: SchoolActivity[]; hasMore: boolean }>(`${base}?kind=${kind}&archived=${archived}&page=${page}`);
  const rows = data.data?.items ?? [];
  return (
    <>
      <PageHeader title={text("Teaching reports", "教学报告")} />
      <section className={panel}>
        <div className="flex flex-wrap gap-2 border-b border-border p-4">
          <div className="flex gap-2" role="group" aria-label={text("Activity type", "活动类型")}>
            <Button size="sm" aria-pressed={kind === "assignment"} variant={kind === "assignment" ? "primary" : "secondary"} onClick={() => router.push(href("assignment", archived))}>{text("Assignments", "作业")}</Button>
            <Button size="sm" aria-pressed={kind === "timed"} variant={kind === "timed" ? "primary" : "secondary"} onClick={() => router.push(href("timed", archived))}>{text("Timed practice", "限时训练")}</Button>
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={event => router.push(href(kind, event.target.checked))} />
            {text("Archived", "已归档")}
          </label>
        </div>
        {data.loading || data.error ? <div className="px-4 pb-4"><State resource={data} /></div> : (
          <Table min={560} headers={[text("Activity", "活动"), text("Status", "状态"), text("Participants", "参与人数"), text("Deadline", "截止时间"), text("Actions", "操作")]}>
            {rows.map(activity => (
              <tr key={activity.id}>
                <td className="font-semibold">{activity.title}</td>
                <td><StatusPill status={activity.state} /></td>
                <td>{activity.participantCount}</td>
                <td>{date(activity.endsAt)}</td>
                <td><AppLink href={href(kind, archived, page, activity.id)} className={`${link} inline-flex items-center gap-2`}>
                  {text("View report", "查看报告")} <ArrowRight size={14} aria-hidden="true" />
                </AppLink></td>
              </tr>
            ))}
            {!rows.length && <Empty columns={5}>{text("No activities on this page.", "本页暂无活动。")}</Empty>}
          </Table>
        )}
        {(page > 1 || data.data?.hasMore) && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">{text(`Page ${page}`, `第 ${page} 页`)}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => router.push(href(kind, archived, page - 1))}>{text("Previous", "上一页")}</Button>
            <Button size="sm" variant="secondary" disabled={!data.data?.hasMore} onClick={() => router.push(href(kind, archived, page + 1))}>{text("Next", "下一页")}</Button>
          </div>
        </div>}
      </section>
    </>
  );
}
