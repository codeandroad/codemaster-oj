"use client";

import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import {
  area,
  date,
  Drawer,
  Feedback,
  Field,
  State,
  useAction,
  useData,
} from "./shared";

type Entry = {
  id: string;
  kind: string;
  status: string;
  score: number | null;
  createdAt: string;
  language: string;
  code: string;
  reviews: { note: string }[];
};

export function SchoolAssignmentSubmissions({
  path,
  title,
  onClose,
}: {
  path: string;
  title: string;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => (locale === "zh" ? zh : en);
  const [page, setPage] = useState(1);
  const result = useData<{ items: Entry[]; hasMore: boolean }>(
    path + `&page=${page}`,
  );
  const action = useAction();
  return (
    <Drawer title={title} onClose={onClose}>
      <h3 className="mb-3 font-semibold">
        {tx("代码、订正与反馈", "Code, corrections and feedback")}
      </h3>
      <State resource={result} />
      <Feedback action={action} />
      {result.data?.items.map((entry) => (
        <details
          className="mb-3 rounded-md border border-border p-3"
          key={entry.id}
          open={result.data?.items.length === 1 || undefined}
        >
          <summary className="cursor-pointer text-sm font-medium">
            {date(entry.createdAt)} ·{" "}
            {entry.kind === "correction"
              ? tx("订正", "Correction") + " · "
              : ""}
            {entry.status} · {entry.score ?? "—"} / 100
          </summary>
          <p className="mt-3 text-xs text-muted-foreground">
            {entry.language} · {entry.id}
          </p>
          <pre className="my-3 overflow-auto rounded bg-surface-subtle p-3 text-xs">
            {entry.code}
          </pre>
          {entry.reviews.map((r, i) => (
            <p className="my-2 whitespace-pre-wrap text-sm" key={i}>
              {r.note}
            </p>
          ))}
          {entry.kind === "submit" && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const note = new FormData(form).get("note");
                void action.run(async () => {
                  await productionApi(path, {
                    method: "POST",
                    body: { submissionId: entry.id, note },
                  });
                  form.reset();
                  result.reload();
                  return tx(
                    "反馈已发送给学生。",
                    "Feedback sent to the student.",
                  );
                });
              }}
            >
              <Field label={tx("教师反馈", "Teacher feedback")}>
                <textarea
                  required
                  name="note"
                  maxLength={10000}
                  className={area}
                />
              </Field>
              <Button disabled={action.busy} size="sm">
                {tx("保存反馈", "Save feedback")}
              </Button>
            </form>
          )}
        </details>
      ))}
      {result.data && !result.data.items.length && (
        <p className="text-sm text-muted-foreground">
          {tx(
            "该学生尚未在这份作业中提交此题。",
            "This student has no submission for this problem in the assignment.",
          )}
        </p>
      )}
      {(page > 1 || result.data?.hasMore) && (
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={page === 1 || result.loading}
            onClick={() => setPage(page - 1)}
          >
            {tx("上一页", "Previous")}
          </Button>
          <Button
            variant="secondary"
            disabled={!result.data?.hasMore || result.loading}
            onClick={() => setPage(page + 1)}
          >
            {tx("下一页", "Next")}
          </Button>
        </div>
      )}
    </Drawer>
  );
}
