"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AppLink, useNavigationBlocker } from "@/components/navigation";
import { StatusPill } from "@/components/page-chrome";
import { Button, buttonVariants } from "@/components/ui/button";
import { Feedback, State, date, textarea, useData, useMutation } from "@/components/student/shared";
import { useLocale } from "@/components/locale-context";
import { productionApi } from "@/lib/production-api";
import { StudySubmissionDetail, type JobDetail } from "./school-submission-detail";
import { useSchoolText } from "./school-ui";

type PublicRecord = {
  id: string;
  schoolId: string;
  problemTitle: string;
  language: string;
  createdAt: string;
  status: string;
  score: number | null;
  noteUpdatedAt?: string | null;
};
type RecordPage = { items: PublicRecord[]; page: number; hasMore: boolean };
type PublicJob = JobDetail & { state: string; note: string | null; noteUpdatedAt: string | null };

export function PublicSubmissions() {
  return <PublicStudyRecords notebook={false} />;
}

export function PublicReviewNotebook() {
  return <PublicStudyRecords notebook />;
}

function PublicStudyRecords({ notebook }: { notebook: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const id = search.get("submissionId");
  const schoolId = search.get("submissionSchoolId");
  const candidate = Number(search.get("publicPage") ?? 1);
  const page = Number.isInteger(candidate) && candidate > 0 && candidate <= 100000 ? candidate : 1;
  function href(changes: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString());
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) params.delete(name);
      else params.set(name, value);
    }
    return params.size ? `${pathname}?${params}` : pathname;
  }
  if (id && schoolId) {
    const path = `practice/submissions/${encodeURIComponent(schoolId)}/${encodeURIComponent(id)}`;
    return <StudySubmissionDetail<PublicJob> key={path} path={path}
      backHref={href({ submissionId: null, submissionSchoolId: null })}
      problemHref={job => `/practice/problems?problemId=${encodeURIComponent(job.problemId)}`}
      renderExtra={(job, reload) => job.state === "completed" &&
        <PublicCorrectionNote key={job.noteUpdatedAt ?? "new"} path={path} job={job} onSaved={reload} />}
    />;
  }
  return <PublicRecordsList key={`${notebook}:${page}`} notebook={notebook} page={page} href={href} />;
}

function PublicRecordsList({ notebook, page, href }: {
  notebook: boolean;
  page: number;
  href: (changes: Record<string, string | null>) => string;
}) {
  const text = useSchoolText();
  const { locale } = useLocale();
  const data = useData<RecordPage>(`practice/${notebook ? "review-notebook" : "submissions"}?page=${page}`);
  return <section className="space-y-3">
    <h2 className="text-lg font-semibold">{notebook ? text("Public practice review notebook", "公开练习订正本") : text("Public practice submissions", "公开练习提交记录")}</h2>
    <State data={data}>
      {data.data?.items.length ? <div className="overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>
            <th scope="col" className="p-3">{text("Problem", "题目")}</th>
            <th scope="col" className="p-3">{text("Result", "结果")}</th>
            <th scope="col" className="p-3">{text("Language", "语言")}</th>
            <th scope="col" className="p-3">{notebook ? text("Note updated", "笔记更新时间") : text("Submitted", "提交时间")}</th>
          </tr></thead>
          <tbody>{data.data.items.map(row => <tr key={`${row.schoolId}:${row.id}`} className="border-t border-border">
            <td className="p-3"><AppLink className="font-semibold text-primary hover:underline" href={href({ submissionId: row.id, submissionSchoolId: row.schoolId })}>{row.problemTitle}</AppLink></td>
            <td className="p-3"><StatusPill status={row.status} /></td>
            <td className="p-3">{row.language === "cpp" ? "C++" : row.language === "javascript" ? "JavaScript" : "Python 3"}</td>
            <td className="p-3">{date((notebook && row.noteUpdatedAt) || row.createdAt, locale)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
        {notebook ? text("Open a completed submission and save a review note to add it here.", "打开已完成的提交并保存订正笔记，即可在这里查看。")
          : text("There are no public practice submissions on this page.", "本页暂无公开练习提交。")}
      </p>}
      {(page > 1 || data.data?.hasMore) && <nav className="flex gap-2" aria-label={text("Record pages", "记录分页")}>
        {page > 1 && <AppLink className={buttonVariants({ size: "sm", variant: "secondary" })} href={href({ publicPage: String(page - 1) })}>{text("Previous", "上一页")}</AppLink>}
        {data.data?.hasMore && <AppLink className={buttonVariants({ size: "sm", variant: "secondary" })} href={href({ publicPage: String(page + 1) })}>{text("Next", "下一页")}</AppLink>}
      </nav>}
    </State>
  </section>;
}

function PublicCorrectionNote({ path, job, onSaved }: { path: string; job: PublicJob; onSaved: () => void }) {
  const text = useSchoolText();
  const [note, setNote] = useState(job.note ?? "");
  const action = useMutation();
  const dirty = note !== (job.note ?? "");
  useNavigationBlocker(dirty);
  return <form className="space-y-3 rounded-lg border border-border bg-surface p-4" onSubmit={event => {
    event.preventDefault();
    void action.run(async () => {
      await productionApi(`${path}/note`, { method: "PATCH", body: { note } });
      onSaved();
    });
  }}>
    <label className="block font-semibold" htmlFor="public-correction-note">{text("Review note", "订正笔记")}</label>
    <textarea id="public-correction-note" className={textarea} rows={4} required maxLength={8000} value={note} onChange={event => setNote(event.target.value)} />
    <Feedback action={action} />
    <Button type="submit" disabled={action.busy || !dirty || !note.trim()}>{text("Save note", "保存笔记")}</Button>
  </form>;
}
