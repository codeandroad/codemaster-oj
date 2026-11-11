"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Empty,
  Feedback,
  Field,
  State,
  Table,
  area,
  input,
  localInput,
  panel,
  useAction,
  useData,
} from "@/components/teacher/shared";
import { date, LessonContent } from "@/components/student/shared";
import { ApiError, productionApi, type Assignment } from "@/lib/production-api";
import type {
  Paper4Paper,
  Paper4PaperSummary,
} from "@/components/paper4/model";
import type { AssistanceKind } from "./assistance";
import { ScholarshipBatchPrices } from "./batch-prices";
import { ScholarshipBatchReview } from "./batch-review";
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
} from "./solution-alternatives-editor";

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
interface Content extends SolutionDraft {
  id: string;
  versionId: string;
  kind: AssistanceKind;
  language: string;
  status: string;
  contentHash?: string;
  hasPendingSolutions?: boolean;
  publishedAt?: string;
}
interface ContentResponse {
  items: Content[];
  originalSolution?: OriginalSolution;
  inheritedSolution?: InheritedSolution;
  versions?: { versionId: string; title: string; createdAt: string; current: boolean; solutionStatus: string | null; hasPendingSolutions: boolean; courseCount?: number }[];
}
interface Policy {
  id: string | null;
  targetType: TargetType;
  targetId: string;
  kind: AssistanceKind;
  mode: "disabled" | "paid" | "free";
  opensAt: string | null;
  price: number | null;
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
  const tx = useText(),
    search = useSearchParams();
  const [targetType, setTargetType] = useState<TargetType>(
    ((["batch", "review"].includes(search.get("mode") ?? "")
      ? ["problem", "paper4"]
      : ["problem", "paper4", "assignment", "timed", "paper4_activity"]).includes(
      search.get("targetType") ?? "",
    )
      ? search.get("targetType")
      : "problem") as TargetType,
  );
  const [targetId, setTargetId] = useState(search.get("targetId") ?? ""),
    [questionKey, setQuestionKey] = useState(search.get("questionKey") ?? "");
  const [mode, setMode] = useState<"single" | "batch" | "review">(
    search.get("mode") === "review" ? "review" : search.get("mode") === "batch" ? "batch" : "single",
  ), [policyRevision, setPolicyRevision] = useState(0);
  const [contentPending, setContentPending] = useState(false);
  const [versionChoice, setVersionChoice] = useState<{ problemId: string; versionId: string }>();
  const [contentKind, setContentKind] = useState<AssistanceKind>(admin || search.get("kind") === "FULL_SOLUTION" ? "FULL_SOLUTION" : "FULL_TRANSLATION");
  const single = mode === "single";
  function changeMode(next: "single" | "batch" | "review") {
    setMode(next);
    if (next !== "single" && targetType !== "paper4" && targetType !== "problem") {
      setTargetType("problem");
      setTargetId("");
      setQuestionKey("");
    }
  }
  const problems = useData<{ items: { targetId: string; title: string; versionId: string }[] }>(
    targetType === "problem" ? "scholarship/contents/review?targetType=problem" : null,
  );
  const papers = useData<{ items: Paper4PaperSummary[] }>(
    targetType === "paper4" || targetType === "paper4_activity"
      ? `paper4/papers?scope=${targetType === "paper4" ? "catalog" : "activities"}`
      : null,
  );
  const activities = useData<{ items: Activity[] }>(
    targetType === "assignment"
      ? "assignments"
      : targetType === "timed"
        ? "timed-practices"
        : null,
  );
  const paper = useData<Paper4Paper>(
    targetType === "paper4" && targetId
      ? `paper4/papers/${encodeURIComponent(targetId)}`
      : null,
  );
  const problem = problems.data?.items.find((item) => item.targetId === targetId);
  const selectedQuestion = questionKey || paper.data?.questions[0]?.key || "";
  const requestedVersion = targetId === search.get("targetId") && targetType === search.get("targetType")
    ? search.get("versionId")
    : null;
  const versionId = (targetType === "problem" && versionChoice?.problemId === targetId ? versionChoice.versionId : null) || requestedVersion ||
    (targetType === "problem" ? problem?.versionId : paper.data?.versionId);
  const choices =
    targetType === "problem"
      ? problems.data?.items.map(item => ({ id: item.targetId, title: item.title }))
      : targetType === "paper4" || targetType === "paper4_activity"
        ? papers.data?.items.filter((item) => item.canManage !== false)
        : activities.data?.items;
  const picker =
    targetType === "problem"
      ? problems
      : targetType === "paper4" || targetType === "paper4_activity"
        ? papers
        : activities;
  const contentTarget =
    targetType === "problem" && targetId && versionId
      ? { problemId: targetId, versionId }
      : targetType === "paper4" && targetId && versionId && selectedQuestion
        ? { paperId: targetId, versionId, questionKey: selectedQuestion }
        : null;
  return (
    <div className="space-y-4">
      {!admin && <h1 className="text-lg font-bold">
        {tx("奖学金管理", "Scholarship management")}
      </h1>}
      <p className="text-sm text-muted-foreground">
        {tx(
          "先选择负责的题目或活动。内容审核发布与活动开放规则分别管理；奖学金不改变原有成绩或榜分。",
          "Select a problem or activity you manage. Reviewed content and activity access rules are managed separately; scholarship does not change existing grades or ranking points.",
        )}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={tx("管理方式", "Management mode")}>
        <Button size="sm" variant={single ? "primary" : "secondary"} disabled={contentPending} aria-pressed={single} onClick={() => changeMode("single")}>{tx("单项内容与规则", "Content and rules")}</Button>
        <Button size="sm" variant={mode === "batch" ? "primary" : "secondary"} disabled={contentPending} aria-pressed={mode === "batch"} onClick={() => changeMode("batch")}>{tx("批量解锁价格", "Batch unlock prices")}</Button>
        <Button size="sm" variant={mode === "review" ? "primary" : "secondary"} disabled={contentPending} aria-pressed={mode === "review"} onClick={() => changeMode("review")}>{tx("批量审核题解", "Batch solution review")}</Button>
      </div>
      <section
        className={`${panel} grid gap-3 p-4 sm:grid-cols-[200px_minmax(0,1fr)]`}
      >
        <Field label={tx("管理对象", "Manage")}>
          <select
            className={input}
            disabled={contentPending}
            value={targetType}
            onChange={(event) => {
              setTargetType(event.target.value as TargetType);
              setTargetId("");
              setQuestionKey("");
            }}
          >
            <option value="problem">{tx("普通题目", "Problem")}</option>
            <option value="paper4">Paper 4 {tx("试卷", "paper")}</option>
            {single && <option value="assignment">{tx("作业", "Assignment")}</option>}
            {single && <option value="timed">{tx("限时练习", "Timed practice")}</option>}
            {single && <option value="paper4_activity">
              Paper 4 {tx("活动", "activity")}
            </option>}
          </select>
        </Field>
        {single && <SearchableSelect label={tx("选择题目或活动", "Select problem or activity")}
          choices={choices ?? []} disabled={contentPending || picker.loading} value={targetId}
          onChange={value => {
            setTargetId(value);
            setQuestionKey("");
            setVersionChoice(undefined);
          }} />}
        {mode !== "review" && <State resource={picker} />}
        {single && targetType === "paper4" && targetId && (
          <>
            <State resource={paper} />
            <Field label={tx("大题", "Question")}>
              <select
                className={input}
                disabled={contentPending}
                value={selectedQuestion}
                onChange={(event) => setQuestionKey(event.target.value)}
              >
                {paper.data?.questions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.key} · {item.title}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </section>
      {single && !targetId && <section className={`${panel} space-y-1 p-4`}>
        <h2 className="font-semibold">{tx("内容录入与发布", "Author and publish content")}</h2>
        <p className="text-sm text-muted-foreground">{tx("请先在上方选择题目或试卷，然后在这里编辑学生看到的译文、原有题解和新增解法。", "Choose a problem or paper above, then edit student translations, existing solutions and additional approaches here.")}</p>
      </section>}
      {mode === "batch" && (targetType === "problem" || targetType === "paper4") && !picker.loading && !picker.error && <ScholarshipBatchPrices key={targetType} targetType={targetType} choices={choices ?? []} initialIds={(search.get("ids") ?? "").split(",").filter(Boolean)} onSaved={() => setPolicyRevision(value => value + 1)}/>}
      {mode === "review" && (targetType === "problem" || targetType === "paper4") && <ScholarshipBatchReview key={targetType} targetType={targetType} admin={admin}/>}
      {single && contentTarget && (
        <ContentEditor
          key={JSON.stringify(contentTarget)}
          target={contentTarget}
          kind={contentKind}
          onKindChange={setContentKind}
          contentPending={contentPending}
          onPendingChange={setContentPending}
          onVersionChange={versionId => setVersionChoice({ problemId: targetId, versionId })}
        />
      )}
      {single && targetId && (
        <>
          <PolicyEditor
            key={`${targetType}:${targetId}:${policyRevision}`}
            targetType={targetType}
            targetId={targetId}
          />
          {["assignment", "timed", "paper4_activity"].includes(targetType) && (
            <ActivityRewardEditor
              key={`reward:${targetType}:${targetId}`}
              activityType={targetType as ActivityType}
              activityId={targetId}
            />
          )}
          <UsageList
            key={`usage:${targetType}:${targetId}`}
            targetType={targetType}
            targetId={targetId}
          />
        </>
      )}
    </div>
  );
}

function ContentEditor({
  target,
  kind,
  onKindChange,
  contentPending,
  onPendingChange,
  onVersionChange,
}: {
  target:
    | { problemId: string; versionId: string }
    | { paperId: string; versionId: string; questionKey: string };
  kind: AssistanceKind;
  onKindChange: (kind: AssistanceKind) => void;
  contentPending: boolean;
  onPendingChange: (pending: boolean) => void;
  onVersionChange: (versionId: string) => void;
}) {
  const tx = useText(),
    contents = useData<ContentResponse>(
      `scholarship/contents?${new URLSearchParams(target)}`,
    );
  const content = contents.data?.items.find(
    (item) =>
      item.kind === kind &&
      item.language === (kind === "FULL_TRANSLATION" ? "zh-CN" : ""),
  );
  return (
    <section className={`${panel} space-y-3 p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">
          {tx("内容录入与发布", "Author and publish content")}
        </h2>
        <select
          aria-label={tx("辅助类型", "Assistance type")}
          className={`${input} max-w-64`}
          disabled={contentPending}
          value={kind}
          onChange={(event) => onKindChange(event.target.value as AssistanceKind)}
        >
          {kinds.map((value) => (
            <option key={value} value={value}>
              {kindName(value, tx)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">
        {tx(
          "只发布面向学生的译文或题解；不要粘贴隐藏测试、判题驱动或教师私有批注。每个版本单独审核，未发布内容不会收费。",
          "Publish student-facing translations or explanations only. Do not include hidden tests, judge drivers, or private teacher notes. Each version is reviewed separately; unpublished content is never charged.",
        )}
      </p>
      <State resource={contents} />
      {"problemId" in target && contents.data?.versions && <Field label={tx("题目版本", "Problem version")}>
        <select aria-label={tx("题目版本", "Problem version")} className={input} value={target.versionId} disabled={contentPending || contents.loading} onChange={event => onVersionChange(event.target.value)}>
          {contents.data.versions.map(version => <option key={version.versionId} value={version.versionId}>
            {version.versionId.slice(0, 8)} · {date(version.createdAt)}{version.current ? tx(" · 当前教学版本", " · Current teaching version") : ""}{version.courseCount ? tx(" · 课程使用中", " · Used by courses") : ""} · {version.hasPendingSolutions ? tx("题解更新待审核", "Solution updates awaiting review") : version.solutionStatus === "published" ? tx("题解已发布", "Solution published") : version.solutionStatus === "draft" ? tx("题解草稿", "Solution draft") : tx("未发布题解", "No published solution")}
          </option>)}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">{tx("课程和活动可能使用历史版本。要修改学生看到的题解，请选择对应版本。", "Courses and activities may use an earlier version. Select that version to edit the solution students see.")}</p>
      </Field>}
      {contents.data && (
        <ContentForm
          key={kind}
          kind={kind}
          target={target}
          content={content}
          originalSolution={contents.data.originalSolution}
          inheritedSolution={contents.data.inheritedSolution}
          onVersionChange={onVersionChange}
          disabled={contents.loading || Boolean(contents.error)}
          reload={contents.reload}
          onPendingChange={onPendingChange}
          onSaved={next => contents.setData(previous => ({
            ...previous,
            items: [...(previous?.items.filter(item => item.id !== next.id) ?? []), next],
            versions: previous?.versions?.map(version => version.versionId === target.versionId ? {
              ...version, solutionStatus: next.kind === "FULL_SOLUTION" ? next.status : version.solutionStatus,
              hasPendingSolutions: next.kind === "FULL_SOLUTION" ? Boolean(next.hasPendingSolutions) : version.hasPendingSolutions,
            } : version),
          }))}
        />
      )}
    </section>
  );
}

function ContentForm({
  target,
  kind,
  content,
  originalSolution,
  inheritedSolution,
  onVersionChange,
  disabled,
  reload,
  onPendingChange,
  onSaved,
}: {
  target: { problemId?: string; versionId: string };
  kind: AssistanceKind;
  content?: Content;
  originalSolution?: OriginalSolution;
  inheritedSolution?: InheritedSolution;
  onVersionChange: (versionId: string) => void;
  disabled: boolean;
  reload: () => void;
  onPendingChange: (pending: boolean) => void;
  onSaved: (content: Content) => void;
}) {
  const tx = useText(),
    [draft, setDraft] = useState<SolutionDraft | null>(null),
    [reviewed, setReviewed] = useState(false),
    [preview, setPreview] = useState(false),
    [conflict, setConflict] = useState(false),
    [discard, setDiscard] = useState(false),
    action = useAction();
  const inFlight = useRef(false);
  const saved = content ?? { body: "" };
  const multiple = kind === "FULL_SOLUTION" && Boolean(target.problemId);
  const inherited = multiple && !content ? inheritedSolution : undefined;
  const initial = inherited
    ? { body: inherited.body, solutions: inherited.solutions ?? [{ title: tx("原有题解", "Existing solution"), body: inherited.body }] }
    : multiple && !content && originalSolution
    ? referenceSolutionDraft(originalSolution, tx("原参考题解", "Reference solution"))
    : saved;
  const value = draft ?? initial;
  const dirty = !sameSolutionDraft(value, saved);
  const unsavedEdits = draft !== null && dirty;
  const published = content?.status === "published";
  const unavailable = disabled || action.busy;
  const canEdit = !unavailable && (!published || multiple);
  const canSave = canEdit && dirty && !conflict && !solutionDraftError(value);
  useSolutionDraftNavigation(unsavedEdits || action.busy);
  useEffect(() => {
    onPendingChange(unsavedEdits || action.busy);
    return () => onPendingChange(false);
  }, [unsavedEdits, action.busy, onPendingChange]);

  function edit(next: SolutionDraft) {
    setDraft(next);
    setReviewed(false);
    if (!conflict) action.clear();
  }

  function commit(operation: () => Promise<Content>, message: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    void action.run(async () => {
      try {
        const next = await operation();
        onSaved(next);
        setDraft(null);
        setReviewed(false);
        return message;
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) setConflict(true);
        throw cause;
      }
    }).finally(() => { inFlight.current = false; });
  }

  function reset() {
    setDiscard(false);
    setDraft(null);
    setReviewed(false);
    action.clear();
    if (conflict) reload();
    setConflict(false);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {tx("\u7248\u672c", "Version")}{" "}
        <code>{target.versionId.slice(0, 8)}</code>
        {published && !multiple &&
          tx(
            " \u00b7 \u5df2\u53d1\u5e03\u5185\u5bb9\u5df2\u51bb\u7ed3\uff0c\u4fee\u6539\u9700\u8981\u65b0\u9898\u76ee\u7248\u672c\u5e76\u91cd\u65b0\u5ba1\u6838\u3002",
            " \u00b7 Published content is frozen. Use a new problem version and review changes again.",
          )}
      </p>
      <p className="text-xs text-muted-foreground">
        {tx("当前状态：", "Status: ")}
        {content?.hasPendingSolutions
          ? tx("已发布 · 更新待审核", "Published · updates awaiting review")
          : published
          ? tx("已发布", "Published")
          : content?.status === "draft"
            ? tx("草稿", "Draft")
            : (content?.status ?? tx("尚未录入", "Not authored"))}
      </p>
      {inherited && <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-sm">{tx(`已从版本 ${inherited.versionId.slice(0, 8)} 带入全部已发布题解，尚未保存到此版本。请核对新题面、接口和参考代码后保存并审核发布。`, `All published solutions from version ${inherited.versionId.slice(0, 8)} are carried forward into this unsaved draft. Check them against the new statement, interface and reference code, then save and review for publication.`)}</p>
        <Button type="button" size="sm" variant="secondary" disabled={unsavedEdits || unavailable} onClick={() => onVersionChange(inherited.versionId)}>{tx("打开原版本已发布题解", "Open the original published solutions")}</Button>
      </div>}
      {multiple && !content && !inherited && originalSolution && <p className="text-sm text-muted-foreground">{tx("已用此版本的原参考题解准备首篇草稿。请核对后保存、审核发布，再向学生开放；其他解法可继续追加。", "The first draft is prepared from this version’s reference solution. Review, save and publish it for students; add other approaches alongside it.")}</p>}
      {multiple ? <SolutionAlternativesEditor value={value} onChange={edit} disabled={!canEdit} originalSolution={originalSolution} /> : <Field
        label={tx(
          "内容（Markdown，可包含代码块）",
          "Content (Markdown with code blocks)",
        )}
      >
        <textarea
          className={`${area} min-h-56 resize-none font-mono`}
          value={value.body}
          maxLength={200000}
          onChange={(event) => edit({ body: event.target.value })}
          disabled={!canEdit}
        />
      </Field>}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!canSave}
          aria-busy={action.busy}
          onClick={() => commit(() => productionApi<Content>("scholarship/contents", {
            method: "POST",
            body: {
              ...target,
              ...value,
              kind,
              language: kind === "FULL_TRANSLATION" ? "zh-CN" : "",
              expectedHash: content?.contentHash,
            },
          }), published
            ? tx("更新已保存为草稿，等待审核。", "Updates saved for review.")
            : tx("草稿已保存，审核发布后学生才能获取。", "Draft saved. Students can access it after review and publication."))}
        >
          {tx("保存草稿", "Save draft")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!value.body.trim()}
          onClick={() => setPreview(!preview)}
        >
          {preview ? tx("收起预览", "Hide preview") : tx("预览", "Preview")}
        </Button>
        {(unsavedEdits || conflict) && <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => unsavedEdits ? setDiscard(true) : reset()}>
          {conflict ? tx("重新载入", "Reload") : tx("放弃修改", "Discard changes")}
        </Button>}
      </div>
      {preview && (
        <div className="rounded-md border border-border p-4">
          {kind === "FULL_SOLUTION" ? <SolutionDraftPreview draft={value} /> : <LessonContent content={value.body} />}
        </div>
      )}
      {content && (!published || content.hasPendingSolutions) && !dirty && !conflict && (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              className="mt-1 accent-primary"
              type="checkbox"
              checked={reviewed}
              disabled={unavailable}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            {tx(
              "已核对题目版本、内容准确性，并确认不包含私有批注或隐藏测试。",
              "I reviewed the problem version and accuracy and confirmed there are no private notes or hidden tests.",
            )}
          </label>
          <Button
            size="sm"
            disabled={unavailable || !reviewed}
            aria-busy={action.busy}
            onClick={() => commit(() => productionApi<Content>(`scholarship/contents/${encodeURIComponent(content.id)}/publish`, {
              method: "POST", body: { reviewed: true, expectedHash: content.contentHash },
            }), tx("内容已审核发布。", "Content reviewed and published."))}
          >
            {tx("审核并发布", "Review and publish")}
          </Button>
        </>
      )}
      <Feedback action={action} />
      {dirty && <p className="text-xs text-muted-foreground">{tx("保存或放弃修改后可切换题目和辅助类型。", "Save or discard edits to switch problems or assistance type.")}</p>}
      {discard && <SolutionDiscardDialog reload={conflict} onCancel={() => setDiscard(false)} onDiscard={reset} />}
    </div>
  );
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
          return (
            <PolicyForm
              key={`${kind}:${policy?.ruleVersion ?? 0}`}
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
  policy?: Policy;
  locked: boolean;
  reload: () => void;
}) {
  const tx = useText(),
    [mode, setMode] = useState(
      policy?.mode ??
        (targetType === "timed" || targetType === "paper4_activity"
          ? "disabled"
          : "paid"),
    ),
    [opensAt, setOpensAt] = useState(localInput(policy?.opensAt ?? undefined)),
    [price, setPrice] = useState(policy?.price == null ? "" : String(policy.price)),
    action = useAction();
  return (
    <form
      className="border-t border-border pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          await productionApi("scholarship/policies", {
            method: "POST",
            body: {
              targetType,
              targetId,
              kind,
              mode,
              opensAt: opensAt ? new Date(opensAt).toISOString() : null,
              ...(["problem", "paper4"].includes(targetType) ? { price: price === "" ? null : Number(price) } : {}),
            },
          });
          reload();
        });
      }}
    >
      <fieldset
        disabled={locked || action.busy}
        className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(160px,1fr)_120px_minmax(150px,1fr)_minmax(180px,1fr)_auto]"
      >
        <strong className="pb-2 text-sm">{kindName(kind, tx)}</strong>
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
        {["problem", "paper4"].includes(targetType) && <Field label={tx("解锁价格（奖学金；留空默认）", "Unlock cost (scholarship; blank = default)")}><input className={input} type="number" min={0} max={1000} step={1} value={price} onChange={event => setPrice(event.target.value)} placeholder={tx("全校默认", "School default")}/></Field>}
        <Field label={tx("开放时间（可选）", "Opens at (optional)")}>
          <input
            type="datetime-local"
            className={input}
            value={opensAt}
            onChange={(event) => setOpensAt(event.target.value)}
          />
        </Field>
        <Button type="submit" size="sm" disabled={action.busy}>
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
