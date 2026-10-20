"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Wallet } from "lucide-react";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import {
  Empty,
  Feedback,
  Field,
  Modal,
  State,
  Table,
  input,
  panel,
  useAction,
  useData,
} from "@/components/teacher/shared";
import { StudentAudienceSelector } from "@/components/teacher/student-audience-selector";
import {
  apiMessage,
  productionApi,
  productionId,
  type Person,
  type SchoolClass,
} from "@/lib/production-api";

export interface LuqEntry {
  id: string;
  identityId: string;
  delta: number;
  balanceAfter: number;
  kind: string;
  reason: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  refundOf?: string | null;
  refunded?: boolean;
}
interface LuqAccount {
  balance: number;
  items: LuqEntry[];
  total: number;
  page: number;
  pageSize: number;
}
interface LuqSettings {
  initialGrant: number;
  firstAcReward: number;
  translationPrice: number;
  solutionPrice: number;
  activityRewardCap: number;
}
function useText() {
  const { locale } = useLocale();
  return (zh: string, en: string) => (locale === "en" ? en : zh);
}

export function LuqBalance({ identityId }: { identityId: string }) {
  const tx = useText(),
    [account, setAccount] = useState<LuqAccount | null>(null),
    [notice, setNotice] = useState("");
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    seen.current = undefined;
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await productionApi<LuqAccount>("luq/me");
        if (!alive) return;
        const latest = next.items?.[0]?.id ?? null;
        if (seen.current !== undefined && latest !== seen.current) {
          const index = next.items.findIndex(
            (item) => item.id === seen.current,
          );
          const arrived = (
            index < 0 ? next.items.slice(0, 1) : next.items.slice(0, index)
          ).filter((item) => item.delta > 0);
          const amount = arrived.reduce((sum, item) => sum + item.delta, 0);
          if (amount) setNotice(`+${amount} Luq`);
        }
        seen.current = latest;
        setAccount(next);
      } catch {
        /* The ledger page exposes actionable errors; the badge must not interrupt editing. */
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const refreshEvent = () => void refresh();
    window.addEventListener("focus", refreshEvent);
    window.addEventListener("campus-judge:luq-changed", refreshEvent);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refreshEvent);
      window.removeEventListener("campus-judge:luq-changed", refreshEvent);
    };
  }, [identityId]);
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <AppLink
        href="/student/luq"
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2 font-semibold hover:bg-surface-subtle"
        aria-label={tx("Luq 余额与流水", "Luq balance and history")}
      >
        <Wallet size={14} aria-hidden="true" />
        {account ? account.balance : "—"} Luq
      </AppLink>
      {notice && (
        <button
          type="button"
          onClick={() => setNotice("")}
          className="text-success"
          aria-label={tx("奖励到账，点击关闭提示", "Reward received; dismiss")}
        >
          <span role="status">{notice}</span>
        </button>
      )}
    </span>
  );
}

function Ledger({
  entries,
  names,
  onRefund,
}: {
  entries: LuqEntry[];
  names?: Map<string, string>;
  onRefund?: (entry: LuqEntry) => void;
}) {
  const tx = useText();
  const kindLabels: Record<string, string> = {
    initial_grant: tx("学生初始发放", "Initial student allowance"),
    admin_grant: tx("管理员发放", "Administrator grant"),
    admin_adjustment: tx("管理员调整", "Administrator adjustment"),
    purchase: tx("辅助内容解锁", "Assistance unlock"),
    refund: tx("消费退款", "Purchase refund"),
    first_ac: tx("首次 AC 奖励", "First-AC reward"),
    activity: tx("活动额外奖励", "Activity reward"),
  };
  return (
    <Table
      min={650}
      headers={[
        tx("时间", "Time"),
        ...(names ? [tx("学生", "Student")] : []),
        tx("事项", "Reason"),
        tx("变动", "Change"),
        tx("余额", "Balance"),
        ...(onRefund ? [tx("操作", "Action")] : []),
      ]}
    >
      {entries.map((entry) => (
        <tr key={entry.id}>
          <td className="whitespace-nowrap text-xs text-muted-foreground">
            {new Date(entry.createdAt).toLocaleString()}
          </td>
          {names && (
            <td>
              {names.get(entry.identityId) ?? entry.identityId.slice(0, 8)}
            </td>
          )}
          <td>
            <span>{entry.reason || kindLabels[entry.kind] || entry.kind}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {kindLabels[entry.kind] ?? entry.kind}
            </span>
          </td>
          <td
            className={`whitespace-nowrap font-semibold tabular-nums ${entry.delta > 0 ? "text-success" : "text-foreground"}`}
          >
            {entry.delta > 0 ? "+" : ""}
            {entry.delta}
          </td>
          <td className="tabular-nums">{entry.balanceAfter}</td>
          {onRefund && (
            <td>
              {entry.refunded ? (
                <span className="text-xs text-muted-foreground">
                  {tx("已退款", "Refunded")}
                </span>
              ) : entry.kind === "purchase" && entry.delta < 0 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onRefund(entry)}
                >
                  {tx("退款", "Refund")}
                </Button>
              ) : null}
            </td>
          )}
        </tr>
      ))}
      {!entries.length && (
        <Empty columns={5 + (names ? 1 : 0) + (onRefund ? 1 : 0)}>
          {tx("暂无 Luq 流水。", "No Luq transactions yet.")}
        </Empty>
      )}
    </Table>
  );
}

function LedgerPager({
  page,
  pageSize,
  total,
  loading,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onChange: (page: number) => void;
}) {
  const tx = useText();
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border p-3 text-sm">
      <Button
        size="sm"
        variant="secondary"
        disabled={page <= 1 || loading}
        onClick={() => onChange(page - 1)}
      >
        {tx("上一页", "Previous")}
      </Button>
      <span>{page}</span>
      <Button
        size="sm"
        variant="secondary"
        disabled={loading || page * pageSize >= total}
        onClick={() => onChange(page + 1)}
      >
        {tx("下一页", "Next")}
      </Button>
    </div>
  );
}

export function StudentLuqPage() {
  const tx = useText(),
    [page, setPage] = useState(1),
    resource = useData<LuqAccount>(`luq/me?page=${page}`);
  return (
    <div className="space-y-4">
      <section
        className={`${panel} flex flex-wrap items-center justify-between gap-3 p-4`}
      >
        <div>
          <h1 className="text-lg font-bold">{tx("我的 Luq", "My Luq")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx(
              "独立的可消费助学点，不影响成绩、个人积分和排行榜。",
              "Spendable learning credits, separate from grades, personal points, and the leaderboard.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <strong className="text-2xl tabular-nums">
            {resource.data?.balance ?? "—"} <span className="text-sm">Luq</span>
          </strong>
          <Button size="sm" variant="secondary" onClick={resource.reload}>
            <RefreshCw size={14} />
            {tx("刷新", "Refresh")}
          </Button>
        </div>
      </section>
      <State resource={resource} />
      <section className={`${panel} overflow-hidden`}>
        <h2 className="border-b border-border px-4 py-3 font-semibold">
          {tx("收支明细", "Transaction history")}
        </h2>
        <Ledger entries={resource.data?.items ?? []} />
        <LedgerPager
          page={page}
          pageSize={resource.data?.pageSize ?? 50}
          total={resource.data?.total ?? 0}
          loading={resource.loading}
          onChange={setPage}
        />
      </section>
      <p className="text-xs leading-6 text-muted-foreground">
        {tx(
          "学生按初始发放规则一次性领取 Luq，同一身份不重复发放。历史积分不兑换，历史 AC 不补发。首次正式 AC 可计奖题目按规则奖励；同题不重复。中文翻译不影响首次 AC Luq，提交前查看完整答案会影响该奖励。",
          "Students receive the configured starting Luq allowance once per identity. Historical points and accepted work are not converted. Eligible first formal ACs earn a once-per-problem reward. Translation does not affect first-AC Luq; viewing a full solution before submission does.",
        )}
      </p>
    </div>
  );
}

export function AdminLuqPage() {
  const tx = useText(),
    [tab, setTab] = useState("grant"),
    [ids, setIds] = useState<string[]>([]),
    [amount, setAmount] = useState(4),
    [reason, setReason] = useState("");
  const [adjustment, setAdjustment] = useState(false),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(1),
    [refund, setRefund] = useState<LuqEntry | null>(null);
  const people = useData<{ items: Person[] }>("people?kind=student"),
    classes = useData<{ items: SchoolClass[] }>("classes"),
    settings = useData<LuqSettings>("luq/settings");
  const ledger = useData<{
    items: LuqEntry[];
    total: number;
    page: number;
    pageSize: number;
  }>(
    `luq/ledger?${new URLSearchParams({ page: String(page), ...(filter ? { identityId: filter } : {}) })}`,
  );
  const action = useAction(),
    request = useRef<string | null>(null);
  const students = (people.data?.items ?? [])
    .filter((person) => person.kind === "student")
    .map((person) => ({
      ...person,
      classIds:
        classes.data?.items
          .filter((item) => item.studentIds.includes(person.id))
          .map((item) => item.id) ?? [],
    }));
  const names = new Map(
    students.map((student) => [
      student.id,
      `${student.name} · ${student.number}`,
    ]),
  );
  function change() {
    request.current = null;
    action.clear();
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">
          {tx("Luq 管理", "Luq administration")}
        </h1>
        {[
          ["grant", tx("发放与调整", "Grants & adjustments")],
          ["audit", tx("流水与退款", "Audit & refunds")],
          ["settings", tx("价格与额度", "Prices & limits")],
        ].map(([value, label]) => (
          <Button
            key={value}
            variant={tab === value ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              setTab(value);
              action.clear();
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === "grant" && (
        <section className={`${panel} space-y-4 p-4`}>
          <p className="text-sm text-muted-foreground">
            {tx(
              "可按班级筛选并选择全班，也可跨班级选择单人。流水绑定稳定学生身份；同一批次重试不会重复入账。",
              "Filter and select a whole class, or choose individuals across classes. Entries use stable student identities; retrying a batch does not duplicate it.",
            )}
          </p>
          <StudentAudienceSelector
            students={students}
            classes={classes.data?.items ?? []}
            selectedIds={ids}
            onChange={(value) => {
              setIds(value);
              change();
            }}
            loading={people.loading || classes.loading}
            error={people.error || classes.error}
            onReload={() => {
              people.reload();
              classes.reload();
            }}
            disabled={action.busy}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={tx("操作类型", "Operation")}>
              <select
                className={input}
                value={adjustment ? "adjustment" : "grant"}
                onChange={(event) => {
                  setAdjustment(event.target.value === "adjustment");
                  change();
                }}
              >
                <option value="grant">{tx("发放", "Grant")}</option>
                <option value="adjustment">
                  {tx("有原因的调整", "Adjustment with reason")}
                </option>
              </select>
            </Field>
            <Field label={tx("每人 Luq", "Luq per student")}>
              <input
                type="number"
                step={1}
                min={adjustment ? undefined : 1}
                className={input}
                value={amount}
                onChange={(event) => {
                  setAmount(Number(event.target.value));
                  change();
                }}
              />
            </Field>
            <Field label={tx("原因（必填）", "Reason (required)")}>
              <input
                className={input}
                value={reason}
                maxLength={500}
                onChange={(event) => {
                  setReason(event.target.value);
                  change();
                }}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            {tx(
              `将为 ${ids.length} 人各${amount >= 0 ? "增加" : "扣减"} ${Math.abs(amount)} Luq。调整不覆盖余额；余额不足时不会扣成负数。`,
              `${ids.length} students × ${amount} Luq. Adjustments append ledger entries and never create negative balances.`,
            )}
          </p>
          <Button
            disabled={
              action.busy ||
              !ids.length ||
              !reason.trim() ||
              !Number.isSafeInteger(amount) ||
              amount === 0 ||
              (!adjustment && amount < 0)
            }
            onClick={() =>
              void action.run(async () => {
                request.current ??= productionId();
                await productionApi(
                  `luq/${adjustment ? "adjustments" : "grants"}`,
                  {
                    method: "POST",
                    body: {
                      requestId: request.current,
                      identityIds: ids,
                      amount,
                      reason: reason.trim(),
                    },
                  },
                );
                request.current = null;
                setIds([]);
                ledger.reload();
                return tx("批次已记入流水。", "Batch recorded in the ledger.");
              })
            }
          >
            {action.busy
              ? tx("处理中…", "Processing…")
              : tx("确认记账", "Confirm entries")}
          </Button>
          <Feedback action={action} />
        </section>
      )}
      {tab === "audit" && (
        <section className={`${panel} overflow-hidden`}>
          <div className="flex flex-wrap gap-2 p-3">
            <label className="flex items-center gap-2 text-sm">
              {tx("学生", "Student")}
              <select
                className={`${input} max-w-72`}
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">{tx("全部", "All")}</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {names.get(student.id)}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" variant="secondary" onClick={ledger.reload}>
              {tx("刷新", "Refresh")}
            </Button>
          </div>
          <State resource={ledger} />
          <Ledger
            entries={ledger.data?.items ?? []}
            names={names}
            onRefund={setRefund}
          />
          <div className="flex items-center justify-end gap-3 border-t border-border p-3 text-sm">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1 || ledger.loading}
              onClick={() => setPage((value) => value - 1)}
            >
              {tx("上一页", "Previous")}
            </Button>
            <span>{page}</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                ledger.loading ||
                !ledger.data ||
                page * ledger.data.pageSize >= ledger.data.total
              }
              onClick={() => setPage((value) => value + 1)}
            >
              {tx("下一页", "Next")}
            </Button>
          </div>
        </section>
      )}
      {tab === "audit" && <RejudgeReviews />}
      {tab === "settings" && (
        <>
          <State resource={settings} />
          {settings.data && (
            <SettingsForm
              key={JSON.stringify(settings.data)}
              initial={settings.data}
              onSaved={settings.reload}
            />
          )}
        </>
      )}
      {refund && (
        <RefundDialog
          entry={refund}
          onClose={() => setRefund(null)}
          onSaved={() => {
            setRefund(null);
            ledger.reload();
          }}
        />
      )}
    </div>
  );
}

function SettingsForm({
  initial,
  onSaved,
}: {
  initial: LuqSettings;
  onSaved: () => void;
}) {
  const tx = useText(),
    [values, setValues] = useState(initial),
    action = useAction();
  const labels: [keyof LuqSettings, string][] = [
    ["initialGrant", tx("每位学生一次性初始发放", "One-time initial student allowance")],
    ["firstAcReward", tx("首次 AC 奖励", "First-AC reward")],
    ["translationPrice", tx("中文题面价格", "Translation price")],
    ["solutionPrice", tx("完整题解价格", "Solution price")],
    [
      "activityRewardCap",
      tx("每学生每活动额外奖励上限", "Extra reward cap per student/activity"),
    ],
  ];
  return (
    <form
      className={`${panel} space-y-4 p-4`}
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          await productionApi("luq/settings", {
            method: "PATCH",
            body: values,
          });
          onSaved();
          return tx(
            "配置已保存，新规则将使用新配置。",
            "Settings saved for new rules.",
          );
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {labels.map(([key, label]) => (
          <Field key={key} label={`${label} · Luq`}>
            <input
              className={input}
              type="number"
              min={0}
              step={1}
              required
              value={values[key]}
              onChange={(event) =>
                setValues({ ...values, [key]: Number(event.target.value) })
              }
            />
          </Field>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {tx(
          "初始发放按稳定学生身份只记一次，修改额度只影响尚未领取的新身份；设为 0 仍会记录已领取，之后不补发。已冻结的活动规则及已有权益保持原记录。Luq 不兑换历史积分，也不进入排行榜。",
          "The initial allowance is recorded once per stable student identity. Changes affect only identities not yet enrolled; zero is recorded as claimed with no later top-up. Frozen activity rules and entitlements retain their records. Luq neither converts historical points nor enters the leaderboard.",
        )}
      </p>
      <Button
        type="submit"
        disabled={
          action.busy ||
          labels.some(
            ([key]) => !Number.isSafeInteger(values[key]) || values[key] < 0,
          )
        }
      >
        {tx("保存配置", "Save settings")}
      </Button>
      <Feedback action={action} />
    </form>
  );
}

function RefundDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: LuqEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tx = useText(),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    key = useRef<string | null>(null),
    lock = useRef(false);
  return (
    <Modal
      title={tx("退回消费 Luq", "Refund Luq purchase")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="mb-4 text-sm">
        {tx(
          `退回 ${Math.abs(entry.delta)} Luq，关联原消费且最多退款一次。已购买的权益保留。`,
          `Return ${Math.abs(entry.delta)} Luq, once per original purchase. The unlocked entitlement is retained.`,
        )}
      </p>
      <Field label={tx("退款原因", "Refund reason")}>
        <input
          className={input}
          required
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {tx("取消", "Cancel")}
        </Button>
        <Button
          disabled={busy || !reason.trim()}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              key.current ??= productionId();
              await productionApi("luq/refunds", {
                method: "POST",
                body: {
                  requestId: key.current,
                  ledgerId: entry.id,
                  reason: reason.trim(),
                },
              });
              onSaved();
            } catch (cause) {
              setError(apiMessage(cause));
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          {tx("确认退款", "Confirm refund")}
        </Button>
      </div>
    </Modal>
  );
}

function RejudgeReviews() {
  const tx = useText(),
    reviews = useData<{
      items: {
        id: string;
        identityId: string;
        subjectKey: string;
        reason: string;
        createdAt: string;
      }[];
    }>("luq/reviews");
  return (
    <section className={`${panel} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-border p-3">
        <h2 className="font-semibold">
          {tx("重判异常核查", "Rejudge review queue")}
        </h2>
        <Button size="sm" variant="secondary" onClick={reviews.reload}>
          {tx("刷新", "Refresh")}
        </Button>
      </div>
      <p className="px-4 py-2 text-xs text-muted-foreground">
        {tx(
          "重判异常保留核查记录，不自动追回已发 Luq。需要调整时请在发放与调整页注明核查原因。",
          "Rejudge anomalies are recorded for review; awarded Luq is not automatically clawed back. Record the review reason when making an adjustment.",
        )}
      </p>
      <State resource={reviews} />
      <Table
        min={600}
        headers={[
          tx("时间", "Time"),
          tx("学生身份", "Student identity"),
          tx("题目", "Problem"),
          tx("原因", "Reason"),
        ]}
      >
        {reviews.data?.items.map((item) => (
          <tr key={item.id}>
            <td>{new Date(item.createdAt).toLocaleString()}</td>
            <td className="font-mono text-xs">{item.identityId}</td>
            <td className="text-xs">{item.subjectKey}</td>
            <td>{item.reason}</td>
          </tr>
        ))}
        {!reviews.data?.items.length && (
          <Empty columns={4}>
            {tx("暂无待核查记录。", "No review records.")}
          </Empty>
        )}
      </Table>
    </section>
  );
}
