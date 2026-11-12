"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Languages } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { inputClass } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal, useData } from "@/components/teacher/shared";
import { SolutionBundle, type SolutionArticle } from "@/components/scholarship/solution-content";
import { MathContent } from "@/components/math-content";
import { ApiError, apiMessage, productionApi, productionId, type SubmissionLanguage } from "@/lib/production-api";
import { ScholarshipIcon } from "@/components/scholarship/scholarship-icon";
import { ScholarshipPopover } from "@/components/scholarship/scholarship-popover";
import { useData as useStudentData } from "@/components/student/shared";
import {
  sameSolutionDraft,
  referenceSolutionDraft,
  SolutionAlternativesEditor,
  SolutionDiscardDialog,
  solutionDraftError,
  SolutionDraftPreview,
  useSolutionDraftNavigation,
  type SolutionDraft,
  type OriginalSolution,
  type InheritedSolution,
} from "@/components/scholarship/solution-alternatives-editor";

export type SchoolAssistanceTarget = {
  type: "problem" | "paper4";
  versionId: string;
  problemId?: string;
  paperId?: string;
  questionKey?: string;
  attemptId?: string;
  activityId?: string;
};
type Kind = "FULL_TRANSLATION" | "FULL_SOLUTION";
type Settings = {
  initialGrant: number;
  firstAcReward: number;
  translationPrice: number;
  solutionPrice: number;
  activityRewardCap: number;
  firstAcPoints: number;
  revision: number;
  displayFields: Record<string, boolean>;
};
type Content = SolutionDraft & { id?: string; revision: number; status: string; hasPendingSolutions?: boolean; originalSolution?: OriginalSolution; inheritedSolution?: InheritedSolution };
type Target = SchoolAssistanceTarget & {
  subjectKey: string;
  title: string;
  contents: { id: string; kind: Kind; revision: number; status: string; hasPendingSolutions?: boolean }[];
  policies: {
    kind: Kind;
    mode: string;
    price: number | null;
    opensAt: string | null;
  }[];
};
function Feedback({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}
function Loading() {
  const tx = useText();
  return (
    <p role="status" className="py-6 text-sm text-muted-foreground">
      {tx("加载中…", "Loading…")}
    </p>
  );
}
const prefix = (schoolId: string) => `schools/${schoolId}/scholarship`;
function useText() {
  const { locale } = useLocale();
  return (zh: string, en: string) => (locale === "en" ? en : zh);
}
const notify = () =>
  window.dispatchEvent(new Event("codemaster:school-scholarship-changed"));
export function SchoolAssistance(props: {
  schoolId: string;
  target: SchoolAssistanceTarget;
  kind: Kind;
  preferredLanguage?: SubmissionLanguage;
}) {
  return (
    <SchoolAssistanceContents
      key={JSON.stringify([props.schoolId, props.target, props.kind])}
      {...props}
    />
  );
}
function SchoolAssistanceContents({
  schoolId,
  target,
  kind,
  preferredLanguage,
}: {
  schoolId: string;
  target: SchoolAssistanceTarget;
  kind: Kind;
  preferredLanguage?: SubmissionLanguage;
}) {
  const tx = useText(),
    [quote, setQuote] = useState<{
      available: boolean;
      reason: string;
      price: number;
      basePrice: number;
      translationCredit: number;
      balance: number;
      balanceAfter: number;
      unlocked: boolean;
      mode: string;
      contentId: string;
      contentRevision: number;
    } | null>(null),
    [provided, setProvided] = useState<{ body: string; solutions?: SolutionArticle[] } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    request = useRef<string | null>(null);
  const problemSolutions = kind === "FULL_SOLUTION" && target.type === "problem";
  const title =
    kind === "FULL_SOLUTION"
      ? problemSolutions
        ? tx("题解与参考代码", "Solutions and reference code")
        : tx("完整题解与参考代码", "Full solution and reference code")
      : tx("中文题面", "Chinese translation");
  async function prepare() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setQuote(
        await productionApi(`${prefix(schoolId)}/assistance/quote`, {
          method: "POST",
          body: { ...target, kind },
        }),
      );
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function provide() {
    if (lock.current || !quote?.available) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (quote.mode === "paid" && !quote.unlocked) {
        request.current ??= productionId();
        await productionApi(`${prefix(schoolId)}/assistance/unlock`, {
          method: "POST",
          body: {
            ...target,
            kind,
            requestId: request.current,
            confirmedContentId: quote.contentId,
            confirmedRevision: quote.contentRevision,
            confirmedPrice: quote.price,
          },
        });
        notify();
      }
      const content = await productionApi<{ body: string; solutions?: SolutionArticle[] }>(
        `${prefix(schoolId)}/assistance/provide`,
        { method: "POST", body: { ...target, kind } },
      );
      setProvided(content);
      setQuote(null);
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <Feedback error={error} />
      {provided !== null ? (
        kind === "FULL_SOLUTION" ? (
          <SolutionBundle body={provided.body} solutions={provided.solutions} preferredLanguage={preferredLanguage} />
        ) : (
          <MathContent content={provided.body} />
        )
      ) : (
        <>
          {problemSolutions && (
            <p className="text-sm text-muted-foreground">
              {tx("一次解锁即可查看此版本已发布的所有题解。", "Unlock all published solutions for this version together.")}
            </p>
          )}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void prepare()}
          >
            {kind === "FULL_SOLUTION" ? (
              <BookOpen className="size-4" />
            ) : (
              <Languages className="size-4" />
            )}
            {tx("查看开放方式与价格", "View access and price")}
          </Button>
        </>
      )}
      {quote && (
        <Modal
          title={title}
          onClose={() => {
            if (!busy) setQuote(null);
          }}
        >
          <div className="space-y-4 text-sm">
            <Feedback error={error} />
            {!quote.available ? (
              <p>{quote.reason}</p>
            ) : (
              <>
                <p>
                  {quote.unlocked ? (
                    tx(
                      "已解锁，免费重看。",
                      "Already unlocked. View again at no charge.",
                    )
                  ) : quote.mode === "free" ? (
                    tx(
                      "本次免费开放，不产生永久购买权益。",
                      "Free access for this context; no permanent purchase entitlement.",
                    )
                  ) : (
                    <>
                      {tx("解锁需要", "Unlock for")}{" "}
                      <strong>
                        {quote.price} {tx("奖学金", "scholarship")}
                      </strong>
                      {quote.translationCredit > 0 && (
                        <span>
                          {" "}
                          ({quote.basePrice} − {quote.translationCredit}{" "}
                          {tx("翻译抵扣", "translation credit")})
                        </span>
                      )}{" "}
                      · {tx("扣后余额", "Balance after")}: {quote.balanceAfter}
                    </>
                  )}
                </p>
                {kind === "FULL_SOLUTION" && (
                  <p className="text-muted-foreground">
                    {tx(
                      "在提交前查看完整答案，该提交不获得本题首次 AC 奖学金；成绩和排行榜积分不变。",
                      "Receiving the full solution before submitting excludes that submission from the first-AC scholarship reward. Grades and ranking points stay unchanged.",
                    )}
                  </p>
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setQuote(null)}
              >
                {tx("取消", "Cancel")}
              </Button>
              {quote.available && (
                <Button
                  disabled={busy || quote.balanceAfter < 0}
                  onClick={() => void provide()}
                >
                  {quote.balanceAfter < 0
                    ? tx("余额不足", "Insufficient balance")
                    : quote.price > 0
                      ? tx("确认解锁并查看", "Confirm unlock and view")
                      : tx("查看内容", "View content")}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

type ActivityAssistancePolicy = {
  mode: "disabled" | "paid" | "free";
  opensAt: string | null;
};
type Rule = {
  amount: number;
  minimumAc: number;
  minimumScore: number;
  requireAll: boolean;
  completionAvailable: boolean;
  taskKind: string;
  allowSolutionAssisted: boolean;
  revision: number;
  assistance: {
    translation: ActivityAssistancePolicy;
    solution: ActivityAssistancePolicy;
  };
};
export function SchoolActivityScholarshipRule({
  schoolId,
  activityId,
  type = "activity",
  editable = false,
}: {
  schoolId: string;
  activityId: string;
  type?: "activity" | "paper4_activity";
  editable?: boolean;
}) {
  const tx = useText(),
    data = useData<Rule>(
      `${prefix(schoolId)}/activity-rule?${new URLSearchParams({ activityId, type })}`,
    ),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<Rule | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (data.loading) return null;
  if (data.error) return <Feedback error={data.error} />;
  if (!data.data) return null;
  const r = data.data;
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      await productionApi(`${prefix(schoolId)}/activity-rule`, {
        method: "POST",
        body: { ...draft, activityId, type, expectedRevision: draft.revision },
      });
      setEditing(false);
      data.reload();
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {r.amount > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-900">
              <ScholarshipIcon className="mr-1 inline size-4" />+{r.amount}{" "}
              {r.requireAll ? tx("完成奖学金", "completion scholarship") : tx("奖学金", "scholarship")}
            </summary>
            <p className="mt-1">
              {r.requireAll
                ? tx("在截止前通过本作业全部必做题的正式判题。无截止时间的作业在达标后发放。", "Pass every required problem through formal submissions received in this assignment by its deadline. Assignments without a deadline pay on completion.")
                : tx(`至少通过 ${r.minimumAc} 题，得分至少 ${r.minimumScore}%。`, `Pass at least ${r.minimumAc} and score at least ${r.minimumScore}%.`)}
              {" "}{r.allowSolutionAssisted ? tx("可使用题解。", "Solution-assisted submissions qualify.") : tx("仅独立完成的提交计入奖励。", "Only unassisted submissions qualify.")}
            </p>
          </details>
        )}
        {editable && (
          <Button
            variant="secondary"
            onClick={() => {
              setDraft({ ...r, requireAll: r.requireAll || (r.completionAvailable && r.revision === 0) });
              setEditing(true);
            }}
          >
            {r.completionAvailable ? tx("作业完成奖学金", "Assignment completion scholarship") : tx("活动奖学金", "Activity scholarship")}
          </Button>
        )}
      </div>
      {editing && draft && (
        <Modal
          title={r.completionAvailable ? tx("作业完成奖学金", "Assignment completion scholarship") : tx("活动奖励规则", "Activity reward rule")}
          onClose={() => {
            if (!busy) setEditing(false);
          }}
        >
          <div className="space-y-3">
            <Feedback error={error} />
            <p className="text-sm text-muted-foreground">
              {tx(
                "活动开始前公示并冻结；每名学生每项活动奖励一次。",
                "Published before the activity and then frozen. Awarded once per student and activity.",
              )}
            </p>
            {r.completionAvailable && (
              <label className="block text-sm">
                {tx("发放条件", "Award condition")}
                <select className={inputClass} value={draft.requireAll ? "complete" : "threshold"} onChange={event => setDraft({ ...draft, requireAll: event.target.value === "complete" })}>
                  <option value="complete">{tx("通过全部必做题", "Pass every required problem")}</option>
                  <option value="threshold">{tx("达到指定题数和得分", "Meet a problem and score threshold")}</option>
                </select>
              </label>
            )}
            {(
              [
                ["amount", tx("额外奖学金", "Extra scholarship")],
                ["minimumAc", tx("至少通过题数", "Minimum accepted problems")],
                ["minimumScore", tx("最低得分百分比", "Minimum score percent")],
              ] as const
            ).filter(([field]) => field === "amount" || !draft.requireAll).map(([k, label]) => (
              <label key={k} className="block text-sm">
                {label}
                <input
                  type="number"
                  min={k === "minimumAc" ? 1 : 0}
                  max={k === "amount" ? 1000 : 100}
                  className={inputClass}
                  value={draft[k]}
                  onChange={(e) =>
                    setDraft({ ...draft, [k]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
            <label className="block text-sm">
              {tx("任务类型", "Task type")}
              <select
                className={inputClass}
                value={draft.taskKind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    taskKind: e.target.value,
                    allowSolutionAssisted:
                      e.target.value === "challenge"
                        ? false
                        : draft.allowSolutionAssisted,
                  })
                }
              >
                <option value="challenge">{tx("挑战", "Challenge")}</option>
                <option value="learning">{tx("学习", "Learning")}</option>
                <option value="correction">{tx("订正", "Correction")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.allowSolutionAssisted}
                disabled={draft.taskKind === "challenge"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    allowSolutionAssisted: e.target.checked,
                  })
                }
              />
              {tx(
                "允许查看题解后的提交计入活动奖励",
                "Allow solution-assisted submissions toward this activity reward",
              )}
            </label>
            <fieldset className="space-y-2 border-t border-border pt-3">
              <legend className="text-sm font-semibold">
                {tx("辅助内容开放", "Assistance access")}
              </legend>
              {(
                [
                  ["translation", tx("中文题面", "Translation")],
                  ["solution", tx("参考答案", "Solution")],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="grid gap-2 sm:grid-cols-2">
                  <label className="text-sm">
                    {label}
                    <select
                      className={inputClass}
                      value={draft.assistance[key].mode}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          assistance: {
                            ...draft.assistance,
                            [key]: {
                              ...draft.assistance[key],
                              mode: e.target
                                .value as ActivityAssistancePolicy["mode"],
                            },
                          },
                        })
                      }
                    >
                      <option value="disabled">{tx("禁用", "Disabled")}</option>
                      <option value="paid">
                        {tx("付费解锁", "Paid unlock")}
                      </option>
                      <option value="free">
                        {tx("活动内免费", "Free in this activity")}
                      </option>
                    </select>
                  </label>
                  <label className="text-sm">
                    {tx("开放时间（可选）", "Opens at (optional)")}
                    <input
                      type="datetime-local"
                      className={inputClass}
                      value={
                        draft.assistance[key].opensAt
                          ? new Date(
                              new Date(
                                draft.assistance[key].opensAt!,
                              ).getTime() -
                                new Date(
                                  draft.assistance[key].opensAt!,
                                ).getTimezoneOffset() *
                                  60000,
                            )
                              .toISOString()
                              .slice(0, 16)
                          : ""
                      }
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          assistance: {
                            ...draft.assistance,
                            [key]: {
                              ...draft.assistance[key],
                              opensAt: e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null,
                            },
                          },
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                {tx(
                  "考核成绩公布前，辅助内容始终关闭。禁用和未到开放时间的限制在其他入口同样生效。",
                  "Assessment assistance stays closed until results are released. Disabled and opening-time restrictions also apply through other entrances.",
                )}
              </p>
            </fieldset>
            {r.completionAvailable && (
              <p className="text-xs text-muted-foreground">
                {tx("奖励按本作业的有效正式提交计算。达标后自动发放，并通过站内通知告知学生。", "Eligible formal submissions in this assignment count toward the reward. Qualifying students receive it automatically with an in-app notification.")}
              </p>
            )}
            <Button disabled={busy} onClick={() => void save()}>
              {tx("保存", "Save")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function SchoolScholarship({
  schoolId,
  role,
}: {
  schoolId: string;
  role: string;
}) {
  const tx = useText(),
    [tab, setTab] = useState(role === "student" ? "ledger" : "content");
  const admin = role === "school_admin";
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
        {(role === "student"
          ? [["ledger", tx("收支明细", "Transactions")]]
          : [
              ["content", tx("内容审核与价格", "Content and prices")],
              ...(admin
                ? [
                    ["ledger", tx("流水审计", "Ledger audit")],
                    ["grant", tx("发放与调整", "Grants and adjustments")],
                    ["settings", tx("配置", "Configuration")],
                  ]
                : []),
            ]
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "secondary"}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === "ledger" && (
        <ScholarshipLedger schoolId={schoolId} admin={admin} />
      )}
      {tab === "content" && (
        <ScholarshipContents schoolId={schoolId} admin={admin} />
      )}
      {tab === "grant" && admin && <ScholarshipGrant schoolId={schoolId} />}
      {tab === "settings" && admin && (
        <ScholarshipSettings schoolId={schoolId} />
      )}
    </div>
  );
}
function ScholarshipLedger({
  schoolId,
  admin,
}: {
  schoolId: string;
  admin: boolean;
}) {
  const tx = useText(),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [refund, setRefund] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    request = useRef("");
  type Entry = {
    id: string;
    name?: string;
    delta: number;
    balanceAfter: number;
    kind: string;
    reason: string;
    createdAt: string;
    refunded: boolean;
    credited: boolean;
  };
  const data = useData<{
      items: Entry[];
      hasMore: boolean;
      reviewCases?: {
        id: string;
        source: string;
        reason: string;
        createdAt: string;
      }[];
    }>(`${prefix(schoolId)}/ledger?page=${page}`),
    wallet = useData<{ balance: number }>(
      admin ? null : `${prefix(schoolId)}/wallet`,
    );
  async function submit() {
    if (!refund || busy) return;
    setBusy(true);
    setError("");
    try {
      await productionApi(`${prefix(schoolId)}/refund`, {
        method: "POST",
        body: { ledgerId: refund, reason, requestId: request.current },
      });
      setRefund(null);
      data.reload();
      notify();
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    initial_grant: tx("初始额度", "Initial allowance"),
    first_ac: tx("首次 AC", "First AC"),
    activity: tx("活动奖励", "Activity reward"),
    purchase: tx("内容解锁", "Content unlock"),
    refund: tx("退款", "Refund"),
    admin_grant: tx("管理员发放", "Admin grant"),
    admin_adjustment: tx("管理员调整", "Admin adjustment"),
  };
  return (
    <>
      <Feedback error={data.error || error} />
      {!admin && wallet.data && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-4">
          <ScholarshipIcon className="size-6" />
          <strong className="text-2xl">{wallet.data.balance}</strong>
          <span>{tx("奖学金余额", "Scholarship balance")}</span>
        </div>
      )}
      {data.loading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-muted-foreground">
              <tr>
                {[
                  tx("时间", "Time"),
                  ...(admin ? [tx("学生", "Student")] : []),
                  tx("来源", "Source"),
                  tx("变动", "Change"),
                  tx("余额", "Balance"),
                  tx("原因", "Reason"),
                  ...(admin ? [tx("操作", "Actions")] : []),
                ].map((v) => (
                  <th className="px-3 py-3" key={v}>
                    {v}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data?.items.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  {admin && <td className="px-3 py-2">{row.name}</td>}
                  <td className="px-3 py-2">{labels[row.kind] ?? row.kind}</td>
                  <td
                    className={`px-3 py-2 font-semibold ${row.delta > 0 ? "text-emerald-700" : "text-foreground"}`}
                  >
                    {row.delta > 0 ? "+" : ""}
                    {row.delta}
                  </td>
                  <td className="px-3 py-2">{row.balanceAfter}</td>
                  <td className="max-w-64 px-3 py-2">{row.reason}</td>
                  {admin && (
                    <td className="px-3 py-2">
                      {row.kind === "purchase" &&
                        (row.refunded ? (
                          <span>{tx("已退款", "Refunded")}</span>
                        ) : row.credited ? (
                          <span className="text-xs text-muted-foreground">
                            {tx("已抵扣题解", "Used toward solution")}
                          </span>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() => {
                              request.current = productionId();
                              setReason("");
                              setRefund(row.id);
                            }}
                          >
                            {tx("退款", "Refund")}
                          </Button>
                        ))}
                    </td>
                  )}
                </tr>
              ))}
              {data.data?.items.length === 0 && (
                <tr>
                  <td
                    colSpan={admin ? 7 : 5}
                    className="p-6 text-center text-muted-foreground"
                  >
                    {tx("暂无收支记录。", "No transactions yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          {tx("上一页", "Previous")}
        </Button>
        <Button
          variant="secondary"
          disabled={!data.data?.hasMore}
          onClick={() => setPage(page + 1)}
        >
          {tx("下一页", "Next")}
        </Button>
      </div>
      {admin && !!data.data?.reviewCases?.length && (
        <details className="rounded-lg border border-border bg-surface p-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            {tx("判题变更待核查", "Judgement changes to review")} ·{" "}
            {data.data.reviewCases.length}
          </summary>
          <p className="mt-2 text-muted-foreground">
            {tx(
              "历史奖学金未自动扣回；请按记录核查后使用有原因的调整。",
              "Previously awarded scholarship has not been reclaimed automatically. Review the records before making a reasoned adjustment.",
            )}
          </p>
          <ul className="mt-2 space-y-2">
            {data.data.reviewCases.map((c) => (
              <li
                key={c.id}
                className="break-words border-t border-border pt-2"
              >
                <time>{new Date(c.createdAt).toLocaleString()}</time>
                <p>{c.reason}</p>
                <code className="text-xs">{c.source}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {refund && (
        <Modal
          title={tx("消费退款", "Refund purchase")}
          onClose={() => {
            if (!busy) setRefund(null);
          }}
        >
          <div className="space-y-3">
            <Feedback error={error} />
            <p className="text-sm">
              {tx(
                "退款最多一次，已购买权益保留。",
                "Refund once at most; the purchased entitlement remains.",
              )}
            </p>
            <label className="block text-sm">
              {tx("原因", "Reason")}
              <textarea
                className={inputClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || !reason.trim()}
              onClick={() => void submit()}
            >
              {tx("确认退款", "Confirm refund")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ScholarshipSettings({ schoolId }: { schoolId: string }) {
  const tx = useText(),
    data = useData<Settings>(`${prefix(schoolId)}/settings`),
    [draft, setDraft] = useState<Settings | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const c = draft ?? data.data;
  async function save() {
    if (!c || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await productionApi<Settings>(
        `${prefix(schoolId)}/settings`,
        { method: "PATCH", body: { ...c, expectedRevision: c.revision } },
      );
      setDraft(next);
      setSaved(true);
      data.reload();
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (data.loading) return <Loading />;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <Feedback error={error || data.error} />
      {c && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["initialGrant", tx("新学生初始额度", "New student allowance")],
                ["firstAcReward", tx("首次 AC 奖学金", "First-AC scholarship")],
                [
                  "translationPrice",
                  tx("中文题面默认价格", "Default translation price"),
                ],
                ["solutionPrice", tx("题解默认价格", "Default solution price")],
                [
                  "activityRewardCap",
                  tx("每活动奖励上限", "Activity reward cap"),
                ],
                [
                  "firstAcPoints",
                  tx("首次 AC 排行积分", "First-AC ranking points"),
                ],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-sm font-medium">
                {label}
                <input
                  type="number"
                  min="0"
                  className={inputClass}
                  value={c[key]}
                  onChange={(e) => {
                    setDraft({ ...c, [key]: Number(e.target.value) });
                    setSaved(false);
                  }}
                />
              </label>
            ))}
          </div>
          <p className="my-3 text-xs text-muted-foreground">
            {tx(
              "调整初始额度不补发给已有身份。奖学金与排行榜积分分别记账。",
              "Changing the initial allowance does not backfill existing identities. Scholarship and ranking points are accounted separately.",
            )}
          </p>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-2 font-medium">
              {tx("排行榜显示字段", "Leaderboard fields")}
            </legend>
            {(["solved", "attempts", "acRate", "scholarship"] as const).map(
              (key, i) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={c.displayFields[key] !== false}
                    onChange={(e) =>
                      setDraft({
                        ...c,
                        displayFields: {
                          ...c.displayFields,
                          [key]: e.target.checked,
                        },
                      })
                    }
                  />
                  {
                    [
                      tx("解题数", "Solved"),
                      tx("提交数", "Attempts"),
                      tx("AC 率", "AC rate"),
                      tx("奖学金余额", "Scholarship balance"),
                    ][i]
                  }
                </label>
              ),
            )}
          </fieldset>
          <Button className="mt-4" disabled={busy} onClick={() => void save()}>
            {tx("保存", "Save")}
          </Button>
          {saved && (
            <span className="ml-3 text-sm text-emerald-700">
              {tx("已保存", "Saved")}
            </span>
          )}
        </>
      )}
    </div>
  );
}
function ScholarshipGrant({ schoolId }: { schoolId: string }) {
  const tx = useText(),
    data = useData<{
      items: { id: string; name: string; number: string; balance: number }[];
      classes: { id: string; name: string }[];
    }>(`${prefix(schoolId)}/recipients`),
    [selected, setSelected] = useState<string[]>([]),
    [classes, setClasses] = useState<string[]>([]),
    [amount, setAmount] = useState(100),
    [kind, setKind] = useState("admin_grant"),
    [reason, setReason] = useState(""),
    [q, setQ] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    request = useRef<string | null>(null),
    anchor = useRef<string | null>(null);
  const items = (data.data?.items ?? []).filter((i) =>
    `${i.name} ${i.number}`.toLowerCase().includes(q.toLowerCase()),
  );
  function toggle(id: string, checked: boolean, shift: boolean) {
    const a = items.findIndex((i) => i.id === anchor.current),
      b = items.findIndex((i) => i.id === id),
      ids =
        shift && a >= 0
          ? items.slice(Math.min(a, b), Math.max(a, b) + 1).map((i) => i.id)
          : [id];
    setSelected((old) =>
      checked
        ? [...new Set([...old, ...ids])]
        : old.filter((x) => !ids.includes(x)),
    );
    anchor.current = id;
    request.current = null;
  }
  async function grant() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    request.current ??= productionId();
    try {
      const r = await productionApi<{ count: number }>(
        `${prefix(schoolId)}/grant`,
        {
          method: "POST",
          body: {
            requestId: request.current,
            identityIds: selected,
            classIds: classes,
            amount,
            kind,
            reason,
          },
        },
      );
      setNotice(`${r.count} ${tx("名学生已处理", "students updated")}`);
      request.current = null;
      setSelected([]);
      setClasses([]);
      data.reload();
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <Feedback error={error || data.error} />
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      <input
        aria-label={tx("搜索学生", "Search students")}
        className={inputClass}
        placeholder={tx("搜索姓名或编号", "Search name or ID")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        {data.data?.classes.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={classes.includes(c.id)}
              onChange={(e) => {
                setClasses((old) =>
                  e.target.checked
                    ? [...old, c.id]
                    : old.filter((x) => x !== c.id),
                );
                request.current = null;
              }}
            />
            {c.name}
          </label>
        ))}
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border border-border">
        {items.map((i) => (
          <label
            key={i.id}
            className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              checked={selected.includes(i.id)}
              onChange={() => {}}
              onClick={(e) => toggle(i.id, e.currentTarget.checked, e.shiftKey)}
            />
            <span>
              {i.name} · {i.number}
            </span>
            <span className="ml-auto text-muted-foreground">{i.balance}</span>
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          {tx("操作", "Operation")}
          <select
            className={inputClass}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              request.current = null;
            }}
          >
            <option value="admin_grant">{tx("发放", "Grant")}</option>
            <option value="admin_adjustment">
              {tx("有原因的调整", "Adjustment with reason")}
            </option>
          </select>
        </label>
        <label className="text-sm">
          {tx("每名学生金额", "Amount per student")}
          <input
            type="number"
            min={kind === "admin_grant" ? 1 : -100000}
            max={100000}
            className={inputClass}
            value={amount}
            onChange={(e) => {
              setAmount(Number(e.target.value));
              request.current = null;
            }}
          />
        </label>
      </div>
      <label className="block text-sm">
        {tx("原因", "Reason")}
        <textarea
          className={inputClass}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            request.current = null;
          }}
        />
      </label>
      <Button
        disabled={
          busy ||
          !reason.trim() ||
          (!selected.length && !classes.length) ||
          amount === 0
        }
        onClick={() => void grant()}
      >
        {tx("确认执行", "Confirm operation")}
      </Button>
    </div>
  );
}
export function SchoolScholarshipBalance({
  schoolId,
  href,
}: {
  schoolId: string;
  href: string;
}) {
  const { data, reload } = useStudentData<{ balance: number }>(`${prefix(schoolId)}/wallet`);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("codemaster:school-scholarship-changed", refresh);
    const timer = window.setInterval(refresh, 45000);
    return () => {
      window.removeEventListener(
        "codemaster:school-scholarship-changed",
        refresh,
      );
      clearInterval(timer);
    };
  }, [reload]);
  return <ScholarshipPopover balance={data?.balance} ledgerPath={`${prefix(schoolId)}/ledger`} href={href} onRefresh={reload}/>;
}
function ScholarshipContents({
  schoolId,
  admin,
}: {
  schoolId: string;
  admin: boolean;
}) {
  const tx = useText(),
    data = useData<{ items: Target[] }>(`${prefix(schoolId)}/targets`),
    [kind, setKind] = useState<Kind>("FULL_SOLUTION"),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<Target | null>(null),
    [prices, setPrices] = useState(false),
    [price, setPrice] = useState(""),
    [mode, setMode] = useState("paid"),
    [opensAt, setOpensAt] = useState(""),
    [review, setReview] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    anchor = useRef<string | null>(null);
  const state = (i: Target) => i.contents.find((c) => c.kind === kind),
    reviewStatus = (i: Target) => state(i)?.hasPendingSolutions ? "draft" : state(i)?.status ?? "missing",
    items = (data.data?.items ?? []).filter(
      (i) =>
        (status === "all" || reviewStatus(i) === status) &&
        i.title.toLowerCase().includes(q.toLowerCase()),
    ),
    chosen = (data.data?.items ?? []).filter((i) =>
      selected.includes(i.subjectKey),
    );
  const label = (s: string) =>
    ({
      published: tx("已发布", "Published"),
      draft: tx("待审核", "Awaiting review"),
      missing: tx("缺少内容", "Missing content"),
      withdrawn: tx("已撤回", "Withdrawn"),
    })[s] ?? s;
  function toggle(id: string, checked: boolean, shift: boolean) {
    const a = items.findIndex((i) => i.subjectKey === anchor.current),
      b = items.findIndex((i) => i.subjectKey === id),
      ids =
        shift && a >= 0
          ? items
              .slice(Math.min(a, b), Math.max(a, b) + 1)
              .map((i) => i.subjectKey)
          : [id];
    setSelected((old) =>
      checked
        ? [...new Set([...old, ...ids])]
        : old.filter((x) => !ids.includes(x)),
    );
    anchor.current = id;
  }
  async function publish() {
    if (busy || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      const contents = chosen
        .map(state)
        .filter(
          (c): c is NonNullable<typeof c> => !!c && (c.status !== "published" || Boolean(c.hasPendingSolutions)),
        );
      if (contents.length !== chosen.length)
        throw new Error(
          tx(
            "请选择都有待审核内容的题目。",
            "Select only items with reviewable content.",
          ),
        );
      await productionApi(`${prefix(schoolId)}/contents/review`, {
        method: "POST",
        body: {
          items: contents.map((c) => ({ id: c.id, revision: c.revision })),
          confirmReviewed: true,
        },
      });
      setReview(false);
      setSelected([]);
      data.reload();
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function savePrices() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await productionApi(`${prefix(schoolId)}/policies`, {
        method: "POST",
        body: {
          targets: chosen,
          kind,
          mode,
          price: price === "" ? null : Number(price),
          opensAt: opensAt ? new Date(opensAt).toISOString() : null,
        },
      });
      setPrices(false);
      data.reload();
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <Feedback error={error || data.error} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={tx("辅助类型", "Assistance type")}
          className={`${inputClass} max-w-52`}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as Kind);
            setSelected([]);
          }}
        >
          <option value="FULL_SOLUTION">
            {tx("完整题解与参考代码", "Solution and code")}
          </option>
          <option value="FULL_TRANSLATION">
            {tx("中文题面", "Chinese translation")}
          </option>
        </select>
        <select
          aria-label={tx("审核状态", "Review status")}
          className={`${inputClass} max-w-44`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">{tx("全部状态", "All statuses")}</option>
          {["missing", "draft", "published", "withdrawn"].map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <input
          aria-label={tx("搜索题目", "Search problems")}
          className={`${inputClass} max-w-72`}
          placeholder={tx("搜索题目", "Search problems")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {selected.length} {tx("项已选", "selected")}
        </span>
        <Button
          variant="secondary"
          disabled={!selected.length}
          onClick={() => setPrices(true)}
        >
          {tx("批量价格与开放规则", "Set access and prices")}
        </Button>
        {admin && (
          <Button
            disabled={
              !selected.length ||
              chosen.some((i) => ["missing", "published"].includes(reviewStatus(i)))
            }
            onClick={() => {
              setConfirmed(false);
              setReview(true);
            }}
          >
            {tx("审核发布所选", "Review and publish")}
          </Button>
        )}
      </div>
      {data.loading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-muted-foreground">
              <tr>
                <th className="w-10 p-3">
                  <input
                    aria-label={tx("选择当前筛选", "Select filtered items")}
                    type="checkbox"
                    checked={
                      items.length > 0 &&
                      items.every((i) => selected.includes(i.subjectKey))
                    }
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [
                              ...new Set([
                                ...old,
                                ...items.map((i) => i.subjectKey),
                              ]),
                            ]
                          : old.filter(
                              (id) => !items.some((i) => i.subjectKey === id),
                            ),
                      )
                    }
                  />
                </th>
                <th className="p-3">{tx("题目", "Problem")}</th>
                <th className="p-3">{tx("内容状态", "Content status")}</th>
                <th className="p-3">{tx("价格", "Price")}</th>
                <th className="p-3">{tx("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const c = state(i),
                  displayStatus = reviewStatus(i),
                  p = i.policies.find((p) => p.kind === kind);
                return (
                  <tr className="border-t border-border" key={i.subjectKey}>
                    <td className="p-3">
                      <input
                        aria-label={`${tx("选择", "Select")} ${i.title}`}
                        type="checkbox"
                        checked={selected.includes(i.subjectKey)}
                        onChange={() => {}}
                        onClick={(e) =>
                          toggle(
                            i.subjectKey,
                            e.currentTarget.checked,
                            e.shiftKey,
                          )
                        }
                      />
                    </td>
                    <td className="max-w-96 px-3 py-2 font-medium">
                      {i.title}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 ${displayStatus === "published" ? "text-emerald-700" : "text-muted-foreground"}`}
                      >
                        {displayStatus === "published" && (
                          <Check className="size-3.5" />
                        )}
                        {c?.hasPendingSolutions ? tx("更新待审核", "Updates awaiting review") : label(displayStatus)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {p?.mode === "disabled"
                        ? tx("禁用", "Disabled")
                        : p?.mode === "free"
                          ? tx("免费", "Free")
                          : (p?.price ?? tx("学校默认", "School default"))}
                    </td>
                    <td className="px-3 py-2">
                      <Button variant="secondary" onClick={() => setEditing(i)}>
                        {tx("编辑 / 预览", "Edit / preview")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-muted-foreground"
                  >
                    {tx(
                      "没有符合条件的题目。先发布校内题目版本。",
                      "No matching problems. Publish a school problem version first.",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ContentEditor
          key={`${editing.subjectKey}:${kind}`}
          schoolId={schoolId}
          target={editing}
          kind={kind}
          onClose={() => setEditing(null)}
          onSaved={() => data.reload()}
        />
      )}
      {prices && (
        <Modal
          title={tx("批量价格与开放规则", "Access and prices")}
          onClose={() => {
            if (!busy) setPrices(false);
          }}
        >
          <div className="space-y-3">
            <p className="text-sm">
              {chosen.length}{" "}
              {tx(
                "项。购买权益持续有效，活动限制优先。",
                "items. Purchases remain valid; activity restrictions take precedence.",
              )}
            </p>
            <label className="block text-sm">
              {tx("开放方式", "Access")}
              <select
                className={inputClass}
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="paid">{tx("付费", "Paid")}</option>
                <option value="free">{tx("免费", "Free")}</option>
                <option value="disabled">{tx("禁用", "Disabled")}</option>
              </select>
            </label>
            <label className="block text-sm">
              {tx(
                "解锁价格（留空使用学校默认）",
                "Price (blank uses school default)",
              )}
              <input
                type="number"
                min="0"
                max="1000"
                className={inputClass}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              {tx("开放时间（可选）", "Opens at (optional)")}
              <input
                type="datetime-local"
                className={inputClass}
                value={opensAt}
                onChange={(e) => setOpensAt(e.target.value)}
              />
            </label>
            <Button disabled={busy} onClick={() => void savePrices()}>
              {tx("应用到所选", "Apply to selected")}
            </Button>
          </div>
        </Modal>
      )}
      {review && (
        <Modal
          title={tx("审核并发布", "Review and publish")}
          onClose={() => {
            if (!busy) setReview(false);
          }}
        >
          <div className="space-y-3">
            <ul className="max-h-48 overflow-y-auto text-sm">
              {chosen.map((i) => (
                <li key={i.subjectKey}>{i.title}</li>
              ))}
            </ul>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                {tx(
                  "已逐项预览并核对所选版本的内容，不含隐藏测试、教师私有批注或判题内部信息。",
                  "I have previewed and reviewed the selected content versions. They contain no hidden tests, private teacher notes or judge internals.",
                )}
              </span>
            </label>
            <Button
              disabled={busy || !confirmed}
              onClick={() => void publish()}
            >
              {tx("确认审核发布", "Confirm publication")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ContentEditor({
  schoolId,
  target,
  kind,
  onClose,
  onSaved,
}: {
  schoolId: string;
  target: Target;
  kind: Kind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tx = useText(),
    query = new URLSearchParams(
      Object.entries({ ...target, kind }).filter(
        ([, v]) => typeof v === "string",
      ) as [string, string][],
    ),
    data = useData<Content>(`${prefix(schoolId)}/content?${query}`),
    [draft, setDraft] = useState<SolutionDraft | null>(null),
    [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [conflict, setConflict] = useState(false),
    [discard, setDiscard] = useState<"close" | "reload" | null>(null),
    [usage, setUsage] = useState(false);
  const inFlight = useRef(false);
  const saved = data.data ?? { body: "" };
  const multiple = kind === "FULL_SOLUTION" && target.type === "problem";
  const originalSolution = data.data?.originalSolution;
  const inherited = multiple && !data.data?.id ? data.data?.inheritedSolution : undefined;
  const initial = inherited
    ? { body: inherited.body, solutions: inherited.solutions ?? [{ title: tx("原有题解", "Existing solution"), body: inherited.body }] }
    : multiple && !data.data?.id && originalSolution
    ? referenceSolutionDraft(originalSolution, tx("原参考题解", "Reference solution"))
    : saved;
  const value = draft ?? initial;
  const dirty = !sameSolutionDraft(value, saved);
  const unsavedEdits = draft !== null && dirty;
  const disabled = busy || data.loading || Boolean(data.error) || !data.data;
  const canSave = !disabled && dirty && !conflict && !solutionDraftError(value);
  useSolutionDraftNavigation(unsavedEdits || busy);
  const records = useData<{
    items: { id: string; name: string; kind: string; providedAt: string }[];
  }>(usage ? `${prefix(schoolId)}/usage?${query}` : null);
  function edit(next: SolutionDraft) {
    setDraft(next);
    setMessage("");
    if (!conflict) setError("");
  }
  async function save() {
    if (!canSave || !data.data || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await productionApi<Omit<Content, keyof SolutionDraft>>(`${prefix(schoolId)}/content`, {
        method: "POST",
        body: {
          ...target,
          ...value,
          kind,
          expectedRevision: data.data.revision,
        },
      });
      data.setData({ ...value, ...next, originalSolution });
      setDraft(null);
      setMessage(tx("草稿已保存，等待审核。", "Draft saved for review."));
      data.reload();
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      setError(apiMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function close() {
    if (inFlight.current) return;
    if (unsavedEdits) setDiscard("close");
    else onClose();
  }
  function confirmDiscard() {
    if (discard === "close") {
      onClose();
      return;
    }
    setDiscard(null);
    setDraft(null);
    setConflict(false);
    setError("");
    data.reload();
  }
  return (
    <Modal wide title={target.title} onClose={close}>
      <div className="space-y-3">
        <Feedback error={error || data.error} />
        {message && <p role="status" className="text-sm text-success">{message}</p>}
        {data.data?.hasPendingSolutions && <p className="text-xs text-muted-foreground">{tx("已保存的更新等待审核。学员目前可查看已发布的题解。", "Saved updates are awaiting review. Students can still view the published solutions.")}</p>}
        {conflict && <Button size="sm" variant="secondary" onClick={() => setDiscard("reload")}>{tx("重新载入", "Reload")}</Button>}
        {data.error && !conflict && <Button size="sm" variant="secondary" onClick={data.reload}>{tx("重试", "Retry")}</Button>}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={preview ? "secondary" : "default"}
            onClick={() => {
              setPreview(false);
              setUsage(false);
            }}
          >
            {tx("编辑内容", "Edit content")}
          </Button>
          <Button
            variant={preview ? "default" : "secondary"}
            onClick={() => {
              setPreview(true);
              setUsage(false);
            }}
          >
            {tx("预览", "Preview")}
          </Button>
          <Button variant="secondary" onClick={() => setUsage(!usage)}>
            {tx("学生使用记录", "Student usage")}
          </Button>
        </div>
        {data.loading && !data.data ? <Loading /> : usage ? (
          <>
            <Feedback error={records.error} />
            <div className="max-h-80 overflow-auto text-sm">
              {records.data?.items.map((i) => (
                <div
                  className="flex gap-3 border-b border-border py-2"
                  key={i.id}
                >
                  <span>{i.name}</span>
                  <span>
                    {i.kind === "FULL_SOLUTION"
                      ? tx("题解", "Solution")
                      : tx("翻译", "Translation")}
                  </span>
                  <time>{new Date(i.providedAt).toLocaleString()}</time>
                </div>
              ))}
              {records.data?.items.length === 0 && (
                <p>{tx("暂无记录。", "No records.")}</p>
              )}
            </div>
          </>
        ) : preview ? (
          <div className="max-h-[60vh] overflow-y-auto">
            {kind === "FULL_SOLUTION" ? (
              <SolutionDraftPreview draft={value} />
            ) : (
              <MathContent content={value.body} />
            )}
          </div>
        ) : data.data && (
          <>
            <p className="text-xs text-muted-foreground">
              {tx(
                "只录入面向学生的题解或译文。核对参考代码与说明，保存后由学校管理员审核发布。不要包含隐藏测试或私有批注。",
                "Prepare student-facing solutions or translations. Check the reference code and explanation, then save for school administrator review. Do not include hidden tests or private notes.",
              )}
            </p>
            {inherited && <p className="text-sm text-muted-foreground">{tx(`已从版本 ${inherited.versionId.slice(0, 8)} 带入全部已发布题解，尚未保存到此版本。请核对新题面、接口和参考代码后保存，交由管理员审核发布。`, `All published solutions from version ${inherited.versionId.slice(0, 8)} are carried forward into this unsaved draft. Check the new statement, interface and reference code, then save for administrator review.`)}</p>}
            {multiple && !data.data.id && !inherited && originalSolution && <p className="text-sm text-muted-foreground">{tx("已用此版本的原参考题解准备首篇草稿。其他解法可继续追加，审核发布后学生才能查看。", "The first draft is prepared from this version’s reference solution. Add other approaches alongside it; students can view them after review and publication.")}</p>}
            {multiple ? <SolutionAlternativesEditor value={value} onChange={edit} disabled={disabled} originalSolution={originalSolution} /> : <textarea
              aria-label={tx("辅助内容", "Assistance content")}
              className="min-h-80 w-full resize-none rounded-md border border-input bg-background p-3 font-mono text-sm"
              value={value.body}
              maxLength={200000}
              disabled={disabled}
              onChange={(e) => edit({ body: e.target.value })}
            />}
            <Button
              disabled={!canSave}
              aria-busy={busy}
              onClick={() => void save()}
            >
              {tx("保存待审核草稿", "Save review draft")}
            </Button>
          </>
        )}
      </div>
      {discard && <SolutionDiscardDialog reload={discard === "reload"} onCancel={() => setDiscard(null)} onDiscard={confirmDiscard} />}
    </Modal>
  );
}
export { SchoolLeaderboard } from "./school-leaderboard";
