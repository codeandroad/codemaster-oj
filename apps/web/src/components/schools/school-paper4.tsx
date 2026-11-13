"use client";
import { RowActionButton } from "@/components/ui/row-action";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Archive,
  ClipboardCheck,
  Download,
  FilePlus2,
  Play,
  RefreshCw,
  Send,
  Upload,
} from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRangeSelection } from "@/components/ui/use-range-selection";
import {
  Feedback,
  State,
  date,
  useData,
  useMutation,
} from "@/components/student/shared";
import { productionApi, type CampusUser } from "@/lib/production-api";
import {
  downloadPaper4Export,
  type Paper4ExportEnvelope,
} from "@/components/paper4/paper4-export";
import { SchoolActivityScholarshipRule } from "./school-scholarship";
import { SchoolPaper4Editor } from "./school-paper4-editor";
import { SchoolPaper4AttemptView } from "./school-paper4-workspace";
import {
  SchoolPaper4Import,
  SchoolPaper4Assign,
} from "./school-paper4-dialogs";
import {
  navigateSchoolPaper4,
  paper4VisiblePapers,
  type SchoolPaper4Activity,
  type SchoolPaper4Paper,
} from "./school-paper4-model";

export function SchoolPaper4({
  schoolId,
  role,
}: {
  schoolId: string;
  role: string;
  user?: CampusUser;
}) {
  return (
    <SchoolPaper4Contents
      key={`${schoolId}:${role}`}
      schoolId={schoolId}
      role={role}
    />
  );
}
function SchoolPaper4Contents({
  schoolId,
  role,
}: {
  schoolId: string;
  role: string;
}) {
  const { locale } = useLocale(),
    tx = (zh: string, en: string) => (locale === "zh" ? zh : en);
  const search = useSearchParams(),
    base = `schools/${schoolId}/paper4`,
    staff = role === "teacher" || role === "school_admin";
  const archived = search.get("paper4Archived") === "1",
    tab = search.get("paper4Tab") === "activities" ? "activities" : "library";
  const year = search.get("paper4Year") ?? "",
    session = search.get("paper4Session") ?? "";
  const paperId = search.get("paper4Id"),
    attemptId = search.get("paper4AttemptId");
  const papers = useData<{ items: SchoolPaper4Paper[] }>(
      `${base}/papers?archived=${archived}`,
    ),
    activities = useData<{ items: SchoolPaper4Activity[] }>(
      `${base}/activities`,
    );
  const [selected, setSelected] = useState<string[]>([]),
    [importing, setImporting] = useState(false),
    [assigning, setAssigning] = useState<SchoolPaper4Paper[] | null>(null),
    [publishing, setPublishing] = useState(false);
  const action = useMutation(),
    visible = paper4VisiblePapers(papers.data?.items ?? [], year, session);
  const selectedPapers = visible.filter((p) => selected.includes(p.id)),
    manageable = selectedPapers.filter((p) => p.canManage),
    assignable = selectedPapers.filter(
      (p) => p.canManage && p.published && !p.archived,
    );
  const range = useRangeSelection(
    visible.map((p) => ({ id: p.id })),
    `${year}:${session}:${archived}`,
  );
  const years = [
    ...new Set(
      (papers.data?.items ?? []).flatMap((p) =>
        p.exam?.examYear ? [p.exam.examYear] : [],
      ),
    ),
  ].sort((a, b) => b - a);
  const refresh = () => {
    papers.reload();
    activities.reload();
  };
  useEffect(() => {
    if (
      !papers.data?.items.some((p) =>
        ["queued", "leased"].includes(p.validation?.state ?? ""),
      )
    )
      return;
    const timer = setInterval(papers.reload, 2000);
    return () => clearInterval(timer);
  }, [papers.data, papers.reload]);
  const back = () => {
    navigateSchoolPaper4({ paper4Id: null, paper4AttemptId: null });
    refresh();
  };
  const open = async (paper: { id: string }, activityId?: string) => {
    const attempt = await productionApi<{ id: string }>(`${base}/attempts`, {
      method: "POST",
      body: { paperId: paper.id, activityId, requestId: crypto.randomUUID() },
    });
    navigateSchoolPaper4({ paper4Id: null, paper4AttemptId: attempt.id });
  };
  if (attemptId)
    return (
      <SchoolPaper4AttemptView
        key={attemptId}
        base={base}
        attemptId={attemptId}
        role={role}
        onBack={back}
        onOpenPaper={async (id) => {
          const p = papers.data?.items.find((p) => p.id === id);
          if (p) await open(p);
        }}
        activities={activities.data?.items ?? []}
        onOpenActivity={async (id) => {
          const item = activities.data?.items.find((a) => a.id === id);
          if (item) await open({ id: item.paperId }, item.id);
        }}
        papers={visible.filter((p) => p.published && !p.archived)}
      />
    );
  if (paperId && staff)
    return (
      <SchoolPaper4Editor
        key={paperId}
        base={base}
        id={paperId}
        role={role}
        onBack={back}
        onReview={(id) =>
          navigateSchoolPaper4({ paper4Id: null, paper4AttemptId: id })
        }
      />
    );
  const batch = (kind: "validate" | "publish") =>
    void action.run(async () => {
      await productionApi(`${base}/papers/${kind}`, {
        method: "POST",
        body: {
          requestId: crypto.randomUUID(),
          items: manageable.map((p) => ({
            id: p.id,
            expectedRevision: p.revision,
          })),
        },
      });
      setPublishing(false);
      refresh();
      action.success(
        tx(
          kind === "validate" ? "参考程序已加入验证队列。" : "试卷已审核发布。",
          kind === "validate"
            ? "Reference programs queued for validation."
            : "Papers reviewed and published.",
        ),
      );
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["library", tx("自由练习库", "Practice library")],
              ["activities", tx("已布置活动", "Assigned activities")],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={tab === value ? "default" : "ghost"}
              onClick={() => navigateSchoolPaper4({ paper4Tab: value }, true)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            aria-label={tx("刷新", "Refresh")}
          >
            <RefreshCw size={14} />
          </Button>
          {staff && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setImporting(true)}
              >
                <Upload size={14} />
                {tx("导入试卷", "Import papers")}
              </Button>
              <Button
                size="sm"
                onClick={() => navigateSchoolPaper4({ paper4Id: "new" })}
              >
                <FilePlus2 size={14} />
                {tx("新建试卷", "New paper")}
              </Button>
            </>
          )}
        </div>
      </div>
      <Feedback action={action} />
      {tab === "library" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                {tx("年份", "Year")}
                <select
                  className="h-9 rounded border border-input bg-background px-2 text-sm"
                  value={year}
                  onChange={(e) =>
                    navigateSchoolPaper4({ paper4Year: e.target.value }, true)
                  }
                >
                  <option value="">{tx("全部年份", "All years")}</option>
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs">
                {tx("考季", "Session")}
                <select
                  className="h-9 rounded border border-input bg-background px-2 text-sm"
                  value={session}
                  onChange={(e) =>
                    navigateSchoolPaper4(
                      { paper4Session: e.target.value },
                      true,
                    )
                  }
                >
                  <option value="">{tx("全部考季", "All sessions")}</option>
                  <option value="summer">May/June</option>
                  <option value="autumn">October/November</option>
                </select>
              </label>
              {staff && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    navigateSchoolPaper4(
                      { paper4Archived: archived ? null : "1" },
                      true,
                    )
                  }
                >
                  {archived
                    ? tx("查看在用", "Show active")
                    : tx("查看归档", "Show archived")}
                </Button>
              )}
            </div>
            {staff && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-xs text-muted-foreground">
                  {tx(
                    `已选 ${selectedPapers.length}`,
                    `${selectedPapers.length} selected`,
                  )}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.busy || !manageable.length}
                  onClick={() =>
                    void action.run(async () =>
                      downloadPaper4Export(
                        await productionApi<Paper4ExportEnvelope>(
                          `${base}/papers/export`,
                          {
                            method: "POST",
                            body: { paperIds: manageable.map((p) => p.id) },
                          },
                        ),
                      ),
                    )
                  }
                >
                  <Download size={14} />
                  {tx("导出 ZIP", "Export ZIP")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.busy || !manageable.length || archived}
                  onClick={() => batch("validate")}
                >
                  <Play size={14} />
                  {tx("验证", "Validate")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={action.busy || !assignable.length}
                  onClick={() => setAssigning(assignable)}
                >
                  <ClipboardCheck size={14} />
                  {tx("布置活动", "Assign")}
                </Button>
                {role === "school_admin" && (
                  <Button
                    size="sm"
                    disabled={
                      action.busy ||
                      !manageable.length ||
                      manageable.some((p) => p.validation?.status !== "AC") ||
                      archived
                    }
                    onClick={() => setPublishing(true)}
                  >
                    <Send size={14} />
                    {tx("审核上架", "Review & publish")}
                  </Button>
                )}
              </div>
            )}
          </div>
          <State data={papers}>
            <div className="overflow-auto rounded-lg border border-border bg-surface">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="bg-surface-subtle text-xs text-muted-foreground">
                  <tr>
                    {staff && (
                      <th className="w-10 px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={tx(
                            "选择当前列表",
                            "Select visible papers",
                          )}
                          checked={
                            !!visible.length &&
                            visible.every((p) => selected.includes(p.id))
                          }
                          onChange={(e) => {
                            range.resetAnchor();
                            setSelected(
                              e.target.checked
                                ? [
                                    ...new Set([
                                      ...selected,
                                      ...visible.map((p) => p.id),
                                    ]),
                                  ]
                                : selected.filter(
                                    (id) => !visible.some((p) => p.id === id),
                                  ),
                            );
                          }}
                        />
                      </th>
                    )}
                    <th className="px-3 py-2">{tx("试卷", "Paper")}</th>
                    <th className="w-20 px-2 py-2">{tx("状态", "Status")}</th>
                    <th className={staff ? "w-48 px-2 py-2" : "w-24 px-2 py-2"}>
                      {tx("操作", "Actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      {staff && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selected.includes(p.id)}
                            aria-label={tx(
                              `选择 ${p.title}`,
                              `Select ${p.title}`,
                            )}
                            onChange={(e) => {
                              const ids = range.getRange(p.id, e);
                              setSelected(
                                ids
                                  ? [...new Set([...selected, ...ids])]
                                  : e.target.checked
                                    ? [...selected, p.id]
                                    : selected.filter((id) => id !== p.id),
                              );
                            }}
                          />
                        </td>
                      )}
                      <td className="min-w-0 px-3 py-2">
                        <button
                          className="block max-w-full truncate text-left font-semibold text-primary hover:underline"
                          title={p.title}
                          disabled={action.busy}
                          onClick={() =>
                            staff
                              ? navigateSchoolPaper4({ paper4Id: p.id })
                              : void action.run(() => open(p))
                          }
                        >
                          {p.shortTitle || p.title}
                        </button>
                        <span
                          className="block truncate text-xs text-muted-foreground"
                          title={p.title}
                        >
                          {p.title} · {p.questionCount} {tx("题", "questions")}{" "}
                          · {p.totalMarks}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {p.archived
                          ? tx("已归档", "Archived")
                          : p.published
                            ? tx("已上架", "Published")
                            : tx("草稿", "Draft")}
                        {p.validation && (
                          <span className="block text-muted-foreground">
                            {p.validation.status ?? p.validation.state}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {p.published &&
                            !p.archived &&
                            (!staff || p.canManage) && (
                              <RowActionButton
                                disabled={action.busy}
                                onClick={() =>
                                  staff
                                    ? setAssigning([p])
                                    : void action.run(() => open(p))
                                }
                              >
                                {staff
                                  ? tx("布置", "Assign")
                                  : tx("练习", "Practice")}
                              </RowActionButton>
                            )}
                          {staff && p.canManage && (
                            <>
                              <RowActionButton
                                onClick={() =>
                                  navigateSchoolPaper4({ paper4Id: p.id })
                                }
                              >
                                {tx("编辑", "Edit")}
                              </RowActionButton>
                              <RowActionButton
                                disabled={action.busy}
                                aria-label={tx(
                                  p.archived ? "恢复试卷" : "归档试卷",
                                  p.archived
                                    ? "Restore paper"
                                    : "Archive paper",
                                )}
                                onClick={() =>
                                  void action.run(async () => {
                                    await productionApi(
                                      `${base}/papers/${p.id}`,
                                      {
                                        method: "PATCH",
                                        body: {
                                          expectedRevision: p.revision,
                                          archived: !p.archived,
                                        },
                                      },
                                    );
                                    refresh();
                                  })
                                }
                              >
                                <Archive size={14} />
                              </RowActionButton>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && (
                <p className="p-5 text-sm text-muted-foreground">
                  {tx("没有符合筛选的试卷。", "No papers match these filters.")}
                </p>
              )}
            </div>
          </State>
        </>
      ) : (
        <State data={activities}>
          <div className="overflow-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-subtle text-xs">
                <tr>
                  <th className="px-3 py-2">{tx("活动", "Activity")}</th>
                  <th className="px-3 py-2">{tx("时间", "Schedule")}</th>
                  <th className="px-3 py-2">{tx("操作", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {activities.data?.items.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-3 py-2 font-semibold">
                      {a.title}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {a.kind === "exam"
                          ? tx("模拟考试", "Mock exam")
                          : tx("练习", "Practice")}{" "}
                        ·{" "}
                        {a.resultsPublished
                          ? tx("已公布", "Released")
                          : tx("未公布", "Not released")}
                      </span>
                      <SchoolActivityScholarshipRule
                        schoolId={schoolId}
                        activityId={a.id}
                        type="paper4_activity"
                        editable={a.canConfigureRule === true}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {date(a.startsAt, locale)} – {date(a.endsAt, locale)}
                    </td>
                    <td className="px-3 py-2">
                      {a.canManage ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <RowActionButton
                            onClick={() =>
                              navigateSchoolPaper4({ paper4Id: a.paperId })
                            }
                          >
                            {tx("查看答卷", "Review attempts")}
                          </RowActionButton>
                          <RowActionButton
                            disabled={action.busy || a.resultsPublished}
                            onClick={() =>
                              void action.run(async () => {
                                await productionApi(
                                  `${base}/activities/${a.id}/results/publish`,
                                  { method: "POST" },
                                );
                                refresh();
                              })
                            }
                          >
                            {tx("公布成绩", "Release results")}
                          </RowActionButton>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          disabled={action.busy}
                          onClick={() =>
                            void action.run(async () => {
                              const result = await productionApi<{
                                id: string;
                              }>(`${base}/attempts`, {
                                method: "POST",
                                body: {
                                  paperId: a.paperId,
                                  activityId: a.id,
                                  requestId: crypto.randomUUID(),
                                },
                              });
                              navigateSchoolPaper4({
                                paper4AttemptId: result.id,
                              });
                            })
                          }
                        >
                          {tx("开始或继续", "Start or continue")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!activities.data?.items.length && (
              <p className="p-5 text-sm text-muted-foreground">
                {tx("暂无活动。", "No assigned activities.")}
              </p>
            )}
          </div>
        </State>
      )}
      {importing && (
        <SchoolPaper4Import
          base={base}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            refresh();
          }}
        />
      )}
      {assigning && (
        <SchoolPaper4Assign
          base={base}
          papers={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            refresh();
            navigateSchoolPaper4({ paper4Tab: "activities" }, true);
          }}
        />
      )}
      <Dialog open={publishing} onOpenChange={setPublishing}>
        <DialogContent>
          <DialogTitle>
            {tx("审核并上架试卷", "Review and publish papers")}
          </DialogTitle>
          <DialogDescription>
            {tx(
              "将选中且验证通过的试卷开放给本校学生自由练习。参考代码与隐藏测试不会随题干公开。",
              "Make the selected validated papers available for this school's free practice. Reference code and hidden tests remain private.",
            )}
          </DialogDescription>
          <ul className="max-h-48 overflow-auto text-sm">
            {manageable.map((p) => (
              <li key={p.id} className="py-1">
                {p.title}
              </li>
            ))}
          </ul>
          <Feedback action={action} />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={() => setPublishing(false)}
            >
              {tx("取消", "Cancel")}
            </Button>
            <Button disabled={action.busy} onClick={() => batch("publish")}>
              {tx(
                `上架 ${manageable.length} 套`,
                `Publish ${manageable.length} papers`,
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
