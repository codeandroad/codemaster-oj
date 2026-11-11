"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppLink } from "@/components/navigation";
import { contentAuthoringHref } from "./authoring-links";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Empty,
  Feedback,
  Field,
  State,
  Table,
  input,
  localInput,
  panel,
  useAction,
  useData,
} from "@/components/teacher/shared";
import { date } from "@/components/student/shared";
import { productionApi, type Assignment } from "@/lib/production-api";
import type {
  Paper4PaperSummary,
} from "@/components/paper4/model";
import type { AssistanceKind } from "./assistance";
import { ScholarshipBatchPrices } from "./batch-prices";
import { assistancePricePayload, parseAssistancePrice, type AssistancePriceIntent } from "./assistance-price";

type TargetType =
  | "problem"
  | "paper4"
  | "assignment"
  | "timed"
  | "paper4_activity";
type ActivityType = "assignment" | "timed" | "paper4_activity";
interface Activity {
  id: string;
  title: string;
}
interface Policy {
  id: string | null;
  targetType: TargetType;
  targetId: string;
  kind: AssistanceKind;
  mode: "disabled" | "paid" | "free";
  opensAt: string | null;
  price: number | null;
  defaultPrice: number;
  effectivePrice: number;
  ruleVersion: number;
}
interface PolicyResponse {
  items: Policy[];
  canManage: boolean;
  frozen: boolean;
}
export interface RewardRule {
  id?: string;
  amount: number;
  minimumAc: number;
  minimumScore: number;
  requireAll: boolean;
  taskKind: "challenge" | "learning" | "correction";
  allowSolutionAssisted: boolean;
  version: number;
}
export interface RuleResponse {
  rule: RewardRule;
  frozen: boolean;
  canManage: boolean;
  cap: number;
}
interface Usage {
  id: string;
  identityId: string;
  studentName: string;
  kind: AssistanceKind;
  language: string;
  contextType: string;
  contextId: string;
  providedAt: string;
}
const kinds: AssistanceKind[] = ["FULL_TRANSLATION", "FULL_SOLUTION"];
function useText() {
  const { locale } = useLocale();
  return (zh: string, en: string) => (locale === "en" ? en : zh);
}
function kindName(
  kind: AssistanceKind,
  tx: (zh: string, en: string) => string,
) {
  return kind === "FULL_TRANSLATION"
    ? tx("中文题面", "Chinese translation")
    : tx("完整题解与参考代码", "Full solution and reference code");
}

export function TeacherScholarshipPage({ admin = false }: { admin?: boolean }) {
  const search = useSearchParams(), router = useRouter(), tx = useText();
  const targetType = search.get("targetType"), targetId = search.get("targetId");
  const authoring = (targetType === "problem" || targetType === "paper4") && targetId && search.has("kind")
    ? contentAuthoringHref({ targetType, targetId, versionId: search.get("versionId") ?? undefined,
        questionKey: search.get("questionKey") ?? undefined,
        kind: search.get("kind") === "FULL_TRANSLATION" ? "FULL_TRANSLATION" : "FULL_SOLUTION" }, admin)
    : search.get("mode") === "review" ? `/${admin ? "admin" : "teacher"}/problems/solutions-review?targetType=${targetType === "paper4" ? "paper4" : "problem"}` : null;
  useEffect(() => { if (authoring) router.replace(authoring); }, [authoring, router]);
  if (authoring) return <p role="status" className="text-sm text-muted-foreground">{tx("正在打开题目内容编辑页…", "Opening the content editor…")}</p>;
  return <ScholarshipPolicyPage admin={admin} />;
}

function ScholarshipPolicyPage({ admin }: { admin: boolean }) {
  const tx = useText(), search = useSearchParams();
  const [targetType, setTargetType] = useState<TargetType>(
    ((search.get("mode") === "batch" ? ["problem", "paper4"] : ["problem", "paper4", "assignment", "timed", "paper4_activity"])
      .includes(search.get("targetType") ?? "") ? search.get("targetType") : "problem") as TargetType,
  );
  const [targetId, setTargetId] = useState(search.get("targetId") ?? "");
  const [mode, setMode] = useState<"single" | "batch">(search.get("mode") === "batch" ? "batch" : "single");
  const [policyRevision, setPolicyRevision] = useState(0);
  const single = mode === "single";
  const problems = useData<{ items: { targetId: string; title: string }[] }>(
    targetType === "problem" ? "scholarship/contents/review?targetType=problem" : null,
  );
  const papers = useData<{ items: Paper4PaperSummary[] }>(targetType === "paper4" || targetType === "paper4_activity"
    ? `paper4/papers?scope=${targetType === "paper4" ? "catalog" : "activities"}` : null);
  const activities = useData<{ items: Activity[] }>(targetType === "assignment" ? "assignments" : targetType === "timed" ? "timed-practices" : null);
  const choices = targetType === "problem" ? problems.data?.items.map(item => ({ id: item.targetId, title: item.title }))
    : targetType === "paper4" || targetType === "paper4_activity" ? papers.data?.items.filter(item => item.canManage !== false) : activities.data?.items;
  const picker = targetType === "problem" ? problems : targetType === "paper4" || targetType === "paper4_activity" ? papers : activities;
  return <div className="space-y-4">
    {!admin && <h1 className="text-lg font-bold">{tx("奖学金管理", "Scholarship management")}</h1>}
    <p className="text-sm text-muted-foreground">{tx("设置题目或活动的价格与开放规则。题解和译文在对应的题目或试卷编辑页维护。", "Set prices and access rules for problems or activities. Edit solutions and translations in the problem or paper editor.")}</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label={tx("管理方式", "Management mode")}>
      <Button size="sm" variant={single ? "primary" : "secondary"} aria-pressed={single} onClick={() => setMode("single")}>{tx("单项价格与规则", "Prices and access rules")}</Button>
      <Button size="sm" variant={!single ? "primary" : "secondary"} aria-pressed={!single} onClick={() => {
        setMode("batch");
        if (targetType !== "problem" && targetType !== "paper4") { setTargetType("problem"); setTargetId(""); }
      }}>{tx("批量解锁价格", "Batch unlock prices")}</Button>
    </div>
    <section className={`${panel} grid gap-3 p-4 sm:grid-cols-[200px_minmax(0,1fr)]`}>
      <Field label={tx("管理对象", "Manage")}><select className={input} value={targetType} onChange={event => { setTargetType(event.target.value as TargetType); setTargetId(""); }}>
        <option value="problem">{tx("普通题目", "Problem")}</option>
        <option value="paper4">Paper 4 {tx("试卷", "paper")}</option>
        {single && <><option value="assignment">{tx("作业", "Assignment")}</option><option value="timed">{tx("限时练习", "Timed practice")}</option><option value="paper4_activity">Paper 4 {tx("活动", "activity")}</option></>}
      </select></Field>
      {single && <SearchableSelect label={tx("选择题目或活动", "Select problem or activity")} choices={choices ?? []} disabled={picker.loading} value={targetId} onChange={setTargetId} />}
      <State resource={picker} />
    </section>
    {single && !targetId && <p className="text-sm text-muted-foreground">{tx("请选择题目或活动，查看并调整价格与开放规则。", "Choose a problem or activity to view and adjust its prices and access rules.")}</p>}
    {!single && (targetType === "problem" || targetType === "paper4") && !picker.loading && !picker.error && <ScholarshipBatchPrices key={targetType} targetType={targetType} choices={choices ?? []} initialIds={(search.get("ids") ?? "").split(",").filter(Boolean)} onSaved={() => setPolicyRevision(value => value + 1)} />}
    {single && targetId && <>
      {(targetType === "problem" || targetType === "paper4") && <AppLink className="inline-block text-sm font-medium text-primary hover:underline" href={contentAuthoringHref({ targetType, targetId }, admin)}>{tx("编辑题目与题解", "Edit problem and solutions")}</AppLink>}
      <PolicyEditor key={`${targetType}:${targetId}:${policyRevision}`} targetType={targetType} targetId={targetId} />
      {["assignment", "timed", "paper4_activity"].includes(targetType) && <ActivityRewardEditor key={`reward:${targetType}:${targetId}`} activityType={targetType as ActivityType} activityId={targetId} />}
      <UsageList key={`usage:${targetType}:${targetId}`} targetType={targetType} targetId={targetId} />
    </>}
  </div>;
}

function PolicyEditor({
  targetType,
  targetId,
}: {
  targetType: TargetType;
  targetId: string;
}) {
  const tx = useText(),
    policies = useData<PolicyResponse>(
      `scholarship/policies?${new URLSearchParams({ targetType, targetId })}`,
    );
  return (
    <section className={`${panel} space-y-3 p-4`}>
      <h2 className="font-semibold">
        {tx("辅助开放规则", "Assistance access rules")}
      </h2>
      <p className="text-xs text-muted-foreground">
        {tx(
          "题目权限和考核限制优先于购买权益。活动中的免费开放不会产生永久付费权益。",
          "Problem access and assessment restrictions take priority over purchased entitlements. Free access within an activity does not create a permanent entitlement.",
        )}
      </p>
      <State resource={policies} />
      {policies.data?.frozen && (
        <p className="text-xs text-muted-foreground">
          {tx(
            "活动辅助规则已冻结，不能修改。",
            "Activity assistance rules are frozen and cannot be changed.",
          )}
        </p>
      )}
      {!policies.loading &&
        !policies.error &&
        kinds.map((kind) => {
          const policy = policies.data?.items.find(
            (item) => item.kind === kind,
          );
          if (!policy) return null;
          return (
            <PolicyForm
              key={`${kind}:${policy.ruleVersion}:${policy.defaultPrice}:${policy.effectivePrice}`}
              kind={kind}
              policy={policy}
              targetType={targetType}
              targetId={targetId}
              locked={policies.data?.frozen || !policies.data?.canManage}
              reload={policies.reload}
            />
          );
        })}
    </section>
  );
}
function PolicyForm({
  targetType,
  targetId,
  kind,
  policy,
  locked,
  reload,
}: {
  targetType: TargetType;
  targetId: string;
  kind: AssistanceKind;
  policy: Policy;
  locked: boolean;
  reload: () => void;
}) {
  const tx = useText(),
    [mode, setMode] = useState(
      policy.mode ??
        (targetType === "timed" || targetType === "paper4_activity"
          ? "disabled"
          : "paid"),
    ),
    [opensAt, setOpensAt] = useState(localInput(policy.opensAt ?? undefined)),
    [price, setPrice] = useState(String(policy.effectivePrice)),
    [priceIntent, setPriceIntent] = useState<AssistancePriceIntent>("unchanged"),
    action = useAction();
  const configurablePrice = ["problem", "paper4"].includes(targetType);
  const validPrice = parseAssistancePrice(price) !== undefined;
  const usingDefault = priceIntent === "default" || priceIntent === "unchanged" && policy.price === null;
  const priceDescriptionId = `policy-price-${targetType}-${targetId}-${kind}`;
  return (
    <form
      className="border-t border-border pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (locked || action.busy || configurablePrice && !validPrice) return;
        void action.run(async () => {
          await productionApi("scholarship/policies", {
            method: "POST",
            body: {
              targetType,
              targetId,
              kind,
              mode,
              opensAt: opensAt ? new Date(opensAt).toISOString() : null,
              ...(configurablePrice ? assistancePricePayload(priceIntent, price) : {}),
            },
          });
          reload();
          return tx("开放规则已保存。", "Access rules saved.");
        });
      }}
    >
      <fieldset
        disabled={locked || action.busy}
        className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(160px,1fr)_120px_minmax(150px,1fr)_minmax(180px,1fr)_auto]"
      >
        <strong className="pb-2 text-sm sm:pt-7">{kindName(kind, tx)}</strong>
        <Field label={tx("开放方式", "Access")}>
          <select
            className={input}
            value={mode}
            onChange={(event) => setMode(event.target.value as Policy["mode"])}
          >
            <option value="disabled">{tx("禁用", "Disabled")}</option>
            <option value="paid">{tx("付费", "Paid")}</option>
            <option value="free">{tx("免费", "Free")}</option>
          </select>
        </Field>
        {configurablePrice && <div className="space-y-1.5">
          <Field label={tx("解锁价格（奖学金）", "Unlock cost (scholarship)")}>
            <input className={input} type="number" min={0} max={1000} step={1} required value={price}
              aria-invalid={!validPrice} aria-describedby={priceDescriptionId}
              onChange={event => { setPrice(event.target.value); setPriceIntent("custom"); }} />
          </Field>
          <div id={priceDescriptionId} className="space-y-1 text-xs text-muted-foreground">
            <p>{usingDefault
              ? tx(`全校默认：${policy.defaultPrice}，随全校配置更新。`, `School default: ${policy.defaultPrice}. Follows school settings.`)
              : `${targetType === "paper4" ? tx("本卷自定义", "Custom paper price") : tx("本题自定义", "Custom problem price")} · ${tx(`全校默认 ${policy.defaultPrice}`, `School default ${policy.defaultPrice}`)}`}</p>
            {!validPrice && <p role="status" className="text-destructive">{tx("请输入 0–1000 的整数，价格不能为空。", "Enter an integer from 0 to 1000. A price is required.")}</p>}
            {mode === "free" && <p>{tx("当前免费开放；此价格仅在付费开放时使用。", "Access is currently free. This price applies only in paid mode.")}</p>}
          </div>
          <Button type="button" size="sm" variant="ghost" disabled={usingDefault && validPrice} className="h-auto min-h-8 whitespace-normal px-0 text-left"
            onClick={() => { setPrice(String(policy.defaultPrice)); setPriceIntent("default"); }}>
            {tx("恢复全校默认", "Restore school default")}
          </Button>
        </div>}
        <Field label={tx("开放时间（可选）", "Opens at (optional)")}>
          <input
            type="datetime-local"
            className={input}
            value={opensAt}
            onChange={(event) => setOpensAt(event.target.value)}
          />
        </Field>
        <Button type="submit" size="sm" className="sm:mt-7" disabled={action.busy || configurablePrice && !validPrice}>
          {tx("保存", "Save")}
        </Button>
      </fieldset>
      <Feedback action={action} />
    </form>
  );
}

export function ActivityRewardEditor({
  activityType,
  activityId,
}: {
  activityType: ActivityType;
  activityId: string;
}) {
  const tx = useText(),
    rules = useData<RuleResponse>(
      `scholarship/reward-rules?${new URLSearchParams({ activityType, activityId })}`,
    );
  return (
    <section className={`${panel} space-y-3 p-4`}>
      <h2 className="font-semibold">
        {activityType === "assignment" ? tx("作业完成奖学金", "Assignment completion scholarship") : tx("活动额外奖学金奖励", "Extra activity scholarship reward")}
      </h2>
      <State resource={rules} />
      {rules.data && (
        <RewardForm
          key={rules.data.rule.version}
          activityType={activityType}
          activityId={activityId}
          data={rules.data}
          reload={rules.reload}
        />
      )}
    </section>
  );
}
function RewardForm({
  activityType,
  activityId,
  data,
  reload,
}: {
  activityType: ActivityType;
  activityId: string;
  data: RuleResponse;
  reload: () => void;
}) {
  const tx = useText(),
    [rule, setRule] = useState({
      ...data.rule,
      requireAll: data.rule.requireAll || (activityType === "assignment" && !data.frozen && data.rule.version === 0),
    }),
    action = useAction(),
    locked = data.frozen || !data.canManage;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          await productionApi("scholarship/reward-rules", {
            method: "POST",
            body: {
              ...rule,
              activityType,
              activityId,
              expectedVersion: data.rule.version,
            },
          });
          reload();
          return tx("奖学金规则已保存。", "Scholarship rule saved.");
        });
      }}
    >
      <p className="text-xs text-muted-foreground">
        {data.frozen
          ? tx(
              "规则已冻结，不能修改。",
              "The rule is frozen and cannot be changed.",
            )
          : tx(
              "须在任务开始前公示并冻结。默认额外奖励为 0，不按速度或尝试次数奖励。",
              "Publish and freeze the rule before the activity starts. Extra rewards default to zero and are not based on speed or attempt count.",
            )}{" "}
        {tx(
          `管理员上限 ${data.cap} 奖学金 / 人 / 活动。`,
          `Administrator cap: ${data.cap} scholarship per student/activity.`,
        )}
      </p>
      <fieldset
        disabled={locked || action.busy}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ActivityRewardFields activityType={activityType} rule={rule} onChange={setRule} amountCap={data.cap} />
      </fieldset>
      <p className="text-xs text-muted-foreground">
        {tx(
          "全部达标条件须同时满足；每学生每活动一次，可与首次 AC 奖学金叠加。限时考核在首次公布成绩后结算。",
          "All conditions must be met. Awarded once per student/activity, and can stack with first-AC scholarship. Timed assessments settle after the first result publication.",
        )}
      </p>
      {activityType === "assignment" && (
        <p className="text-xs text-muted-foreground">
          {tx("奖励按本作业截止前收到的有效正式提交计算。达标后自动发放，并通过站内通知告知学生。", "Eligible formal submissions received in this assignment by the deadline count toward the reward. Qualifying students receive it automatically with an in-app notification.")}
        </p>
      )}
      {!locked && (
        <Button type="submit" size="sm" disabled={action.busy}>
          {tx("保存奖励规则", "Save reward rule")}
        </Button>
      )}
      <Feedback action={action} />
    </form>
  );
}

export function ActivityRewardFields({
  activityType,
  rule,
  onChange,
  amountCap,
}: {
  activityType: ActivityType;
  rule: RewardRule;
  onChange: (rule: RewardRule) => void;
  amountCap?: number;
}) {
  const tx = useText();
  return (
    <>
      <Field label={tx("任务类型", "Task type")}>
        <select
          className={input}
          value={rule.taskKind}
          onChange={(event) =>
            onChange({
              ...rule,
              taskKind: event.target.value as RewardRule["taskKind"],
              allowSolutionAssisted:
                event.target.value === "challenge"
                  ? false
                  : rule.allowSolutionAssisted,
            })
          }
        >
          <option value="challenge">{tx("挑战", "Challenge")}</option>
          <option value="learning">{tx("学习", "Learning")}</option>
          <option value="correction">{tx("订正", "Correction")}</option>
        </select>
      </Field>
      {amountCap !== undefined && (
        <Field label={tx("额外奖学金", "Extra scholarship")}>
          <input
            className={input}
            type="number"
            min={0}
            max={amountCap}
            step={1}
            value={rule.amount}
            onChange={(event) =>
              onChange({ ...rule, amount: Number(event.target.value) })
            }
          />
        </Field>
      )}
      {activityType === "assignment" && (
        <Field label={tx("发放条件", "Award condition")}>
          <select className={input} value={rule.requireAll ? "complete" : "threshold"} onChange={event => onChange({ ...rule, requireAll: event.target.value === "complete" })}>
            <option value="complete">{tx("通过全部必做题", "Pass every required problem")}</option>
            <option value="threshold">{tx("达到指定题数和得分", "Meet a problem and score threshold")}</option>
          </select>
        </Field>
      )}
      {!rule.requireAll && (<>
        <Field label={tx("至少 AC 题数", "Minimum accepted problems")}>
          <input
            className={input}
            type="number"
            min={1}
            max={50}
            step={1}
            value={rule.minimumAc}
            onChange={(event) =>
              onChange({ ...rule, minimumAc: Number(event.target.value) })
            }
          />
        </Field>
        <Field
          label={
            activityType === "paper4_activity"
              ? tx(
                  "\u6700\u4f4e\u5927\u9898 AC \u6bd4\u4f8b\uff08%\uff09",
                  "Minimum accepted-question percentage",
                )
              : tx(
                  "\u6700\u4f4e\u5f97\u5206\u767e\u5206\u6bd4",
                  "Minimum score (%)",
                )
          }
        >
          <input
            className={input}
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={rule.minimumScore}
            onChange={(event) =>
              onChange({ ...rule, minimumScore: Number(event.target.value) })
            }
          />
        </Field>
      </>)}
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          className="accent-primary"
          disabled={rule.taskKind === "challenge"}
          checked={rule.allowSolutionAssisted}
          onChange={(event) =>
            onChange({ ...rule, allowSolutionAssisted: event.target.checked })
          }
        />
        {tx(
          "允许已获得本站完整答案的提交参与活动奖励（仅学习 / 订正）",
          "Allow solution-assisted submissions for this activity reward (learning/correction only)",
        )}
      </label>
    </>
  );
}

function UsageList({
  targetType,
  targetId,
}: {
  targetType: TargetType;
  targetId: string;
}) {
  const tx = useText(),
    usage = useData<{ items: Usage[] }>(
      `scholarship/usage?${new URLSearchParams({ targetType, targetId })}`,
    );
  return (
    <section className={`${panel} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-border p-3">
        <h2 className="font-semibold">
          {tx("学生辅助使用记录", "Student assistance deliveries")}
        </h2>
        <Button size="sm" variant="secondary" onClick={usage.reload}>
          {tx("刷新", "Refresh")}
        </Button>
      </div>
      <State resource={usage} />
      <Table
        min={600}
        headers={[
          tx("学生", "Student"),
          tx("内容", "Content"),
          tx("场景", "Context"),
          tx("提供时间", "Provided at"),
        ]}
      >
        {usage.data?.items.map((item) => (
          <tr key={item.id}>
            <td>{item.studentName}</td>
            <td>{kindName(item.kind, tx)}</td>
            <td>
              {(
                {
                  free: tx("自由练习", "Free practice"),
                  assignment: tx("作业", "Assignment"),
                  timed: tx("限时练习", "Timed practice"),
                  paper4_activity: tx("Paper 4 活动", "Paper 4 activity"),
                } as Record<string, string>
              )[item.contextType] ?? item.contextType}
            </td>
            <td>{new Date(item.providedAt).toLocaleString()}</td>
          </tr>
        ))}
        {!usage.data?.items.length && (
          <Empty columns={4}>
            {tx(
              "暂无内容提供记录；购买与提供分别记账。",
              "No delivery records. Purchases and content deliveries are tracked separately.",
            )}
          </Empty>
        )}
      </Table>
    </section>
  );
}

export function StudentScholarshipRule({
  activityType,
  activityId,
  assignmentContext,
}: {
  activityType: ActivityType;
  activityId: string;
  assignmentContext?: Pick<Assignment, "title" | "dueAt">;
}) {
  const { locale } = useLocale();
  const tx = useText(),
    rule = useData<RuleResponse>(
      `scholarship/reward-rules?${new URLSearchParams({ activityType, activityId })}`,
    );
  const r = rule.data?.rule;
  if (rule.loading || rule.error || !r || r.amount <= 0) return assignmentContext?.title ?? null;
  const deadline = assignmentContext && (
    <time dateTime={assignmentContext.dueAt}>{date(assignmentContext.dueAt, locale)}</time>
  );
  return (
    <details key={`${activityType}:${activityId}`} className={assignmentContext ? "text-xs leading-5" : "my-1 text-xs leading-5 text-muted-foreground"}>
      <summary className={`w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${assignmentContext ? "" : "py-1"}`}>
        {assignmentContext ? (
          <>
            {assignmentContext.title}{tx("（", " (")}
            <strong className="font-semibold">
              {locale === "en"
                ? <>{r.requireAll ? "Complete by " : "Qualify by "}{deadline} for +{r.amount} scholarship</>
                : <>{deadline}{r.requireAll ? "前完成" : "前达标"} +{r.amount} 奖学金</>}
            </strong>
            {tx("）", ")")}
          </>
        ) : (
          <>
            <span className="font-semibold text-foreground">{r.requireAll ? tx("作业完成奖励", "Completion reward") : tx("额外奖励", "Extra reward")} +{r.amount} {tx("奖学金", "scholarship")}</span>
            <span className="ml-2">{tx("奖励条件", "Conditions")}</span>
          </>
        )}
      </summary>
      <p className="mt-1 text-muted-foreground">
        {r.requireAll
          ? tx("在截止前通过本作业全部必做题的正式判题。", "Pass every required problem through formal submissions received in this assignment by the deadline.")
          : <>
            {tx(`至少 ${r.minimumAc} 题 AC`, `At least ${r.minimumAc} accepted problem${r.minimumAc === 1 ? "" : "s"}`)}
            {r.minimumScore > 0 && tx(`，得分至少 ${r.minimumScore}%`, ` and ${r.minimumScore}% score`)}
            {"."}
          </>}
        {" "}{tx("每人每活动一次。", "Awarded once per student and activity.")}{" "}
        {r.allowSolutionAssisted
          ? tx("允许答案辅助后的提交参与奖励。", "Solution-assisted submissions qualify for this reward.")
          : tx("提交前获得完整答案的提交不参与奖励。", "Submissions made after receiving the full solution do not qualify.")}{" "}
        {activityType === "paper4_activity" && r.minimumScore > 0 && tx(
          "百分比按整道大题 AC 比例计算。",
          "The percentage measures accepted whole questions.",
        )}{" "}
        {activityType !== "assignment" && tx("首次公布成绩后结算。", "Settled after the first result publication.")}
      </p>
    </details>
  );
}
