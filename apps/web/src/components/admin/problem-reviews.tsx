"use client";

import { PublicationGuide } from "@/components/problem-publication-status";
import { useState } from "react";
import { MathContent } from "@/components/math-content";
import { useLocale, type AppLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { productionApi, type ProductionProblem } from "@/lib/production-api";
import { Drawer, Feedback, Loading, Modal, dateLabel, inputClass, useData, useMutation } from "./common";
import { reviewVersionActions, type ReviewStatus } from "./problem-review-policy";

interface ProblemReview {
  problemId: string;
  versionId: string;
  title: string;
  isCurrent: boolean;
  bankId: string;
  bankName: string;
  bankVisibility: "school" | "private";
  ownerName: string;
  publishedAt: string;
  schoolVisibleAt: string | null;
  rankReviewStatus: ReviewStatus;
  rankApprovedAt: string | null;
  rankReviewReason: string | null;
  priorAcCount: number;
  validationStatus: string;
}

interface ReviewBank {
  id: string;
  name: string;
  visibility: "school" | "private";
  isSystem?: boolean;
  problemCount: number;
}

interface ReviewCase {
  input: string;
  expected: string;
  name?: string;
  weight?: number;
  enabled?: boolean;
}

interface ReviewProblemDetail extends Omit<ProductionProblem, "samples" | "tests"> {
  samples: ReviewCase[];
  tests: ReviewCase[];
  referenceLanguage?: string;
  comparator?: string;
  inputDescription?: string;
  outputDescription?: string;
  validationMessage?: string;
}

const statusLabels: Record<ReviewStatus, string> = {
  pending: "待公开审核",
  approved: "已公开",
  rejected: "审核未通过",
  revoked: "已撤下",
};
const MAX_BATCH_APPROVE = 100;

const reviewEnglish: Record<string, string> = {
  "待公开审核": "Awaiting public review", "已公开": "Public", "审核未通过": "Review rejected",
  "待审核": "Pending", "已纳入排名积分": "Eligible for leaderboard points", "未纳入排名积分": "Not eligible", "已撤下": "Withdrawn", "全部": "All",
  "题目排名积分资格审核": "Public problem review",
  "列出校内题库已发布的当前及历史版本。教师可以发布题目供教学使用；只有管理员审核通过的版本，后续首次 AC 才计入全校积分排行榜。": "Review current and past published versions. Teachers may publish problems for teaching; only administrator-approved versions award school leaderboard points for future first accepted submissions.",
  "刷新列表": "Refresh list", "新版本须重新审核；已有 AC 不追溯计分，学生须重新正式提交并通过才获得排名积分。已公开版本（含历史版）可撤下，停止后续公开与新增榜分，历史榜分保留；撤下后如需恢复，请发布新版本。": "Each new version needs review. Earlier accepted submissions receive no retroactive points; students must submit and pass again. Public versions can be withdrawn, while historical leaderboard points remain. Publish a new version to restore access.",
  "审核状态筛选": "Filter review status", "题目 / 版本": "Problem / version", "上传教师": "Teacher", "题库 / 题目可见性": "Bank / visibility", "版本启用时间": "Version released", "积分资格": "Points eligibility", "公开状态": "Public status", "已 AC 人数": "Students with AC", "操作": "Actions",
  "当前版": "Current version", "历史版": "Past version", "全校自由练习可见": "Visible to all school students", "仅指定活动学生可见": "Visible only in assigned activities",
  "已撤下 · 需发布新版": "Withdrawn · publish a new version", "复审通过": "Approve on review", "通过": "Approve", "不通过": "Reject", "撤下": "Withdraw", "历史版不可审核": "Past version cannot be reviewed",
  "当前没有待审核的题目版本。": "No problem versions awaiting review.", "此状态下暂无题目版本。": "No problem versions with this status.",
  "题库可见范围": "Problem bank visibility", "教师新建的题库默认只供维护教师使用。管理员可将题库纳入校内审核范围；此操作不会自动公开题目或发放排名积分，每个已发布版本仍需审核。": "Teacher-created banks are private by default. Administrators can include a bank in school review; this does not publish its problems or award points. Each published version still needs approval.",
  "教师私有题库": "Teacher's private bank", "选择题库": "Choose bank", "题": "problems", "纳入校内审核": "Include in school review", "暂无教师私有题库。": "No private teacher banks.",
  "确认纳入全校排名积分": "Approve leaderboard points?", "确认撤下题目版本": "Withdraw this version?", "确认暂不纳入排名积分": "Reject leaderboard points?",
  "当前版本已有": "This version already has ", "名学生曾 AC；他们需重新正式提交并通过才获得排名积分。审核通过后仍可撤下，但已产生的历史榜分不会重算。": " students with accepted submissions. They must submit and pass again to earn leaderboard points. Approval may later be withdrawn without changing historical points.",
  "撤下原因": "Reason for withdrawal", "不通过原因": "Reason for rejection", "（必填）": " (required)", "说明撤下原因，供审计与教师查看": "Explain the withdrawal for the audit log and teacher", "说明暂不通过的原因，便于教师修订": "Explain the rejection so the teacher can revise the problem",
  "取消": "Cancel", "正在提交…": "Submitting…", "确认撤下": "Confirm withdrawal", "确认审核": "Confirm review",
  "确认调整题库可见范围": "Change bank visibility?", "题库内当前已发布版本会进入题目审核列表。管理员审核通过后，该版本才向全校学生开放自由练习并参与后续首次 AC 排名积分。": "Published versions in this bank enter the review list. Each version becomes freely available school-wide and eligible for future first-AC points only after administrator approval.",
  "确认调整": "Confirm change", "题目已纳入后续首次 AC 排名积分。": "The problem is eligible for future first-AC leaderboard points.",
  "此版本已撤下，后续不再公开或新增排名积分；历史榜分保留。": "This version was withdrawn. It no longer appears publicly or awards new leaderboard points; historical points remain.",
  "题目暂不纳入全校排名积分。": "This problem is not eligible for school leaderboard points.", "题库已纳入校内审核范围。": "The bank is now included in school review.",
  "选择当前列表可通过题目": "Select approvable problems in this list",
  "选择当前列表前 100 道可通过题目": "Select the first 100 approvable problems in this list",
  "选择题目": "Select problem",
  "已选": "Selected",
  "批量通过": "Approve selected",
  "取消选择": "Clear selection",
  "正在通过…": "Approving…",
  "最多选择前 100 道可通过题目；审核后可继续选择下一批。": "Up to the first 100 approvable problems are selected. Select the next batch after approval.",
  "已选版本将从通过时刻起向全校开放并参与后续首次 AC 积分；历史 AC 不追溯。": "Selected versions become school-wide and eligible for future first-AC points from approval. Earlier accepted submissions receive no retroactive points.",
  "参考解未通过验证，暂不可通过": "Reference solution has not passed validation; approval unavailable",
  "旧版已公开题目保留学生访问，但没有自动获得积分资格；当前版本审核不通过会停止公开。新版本仍须审核，历史 AC 不追溯计分。": "Previously public problems remain accessible, but are not automatically eligible for leaderboard points. Rejecting their current version ends public access. New versions still require review, and earlier accepted submissions earn no retroactive points.",
  "待审积分资格 · 旧版已公开": "Points review pending · previously public",
  "历史公开 · 未获积分资格": "Past version public · not points-eligible",
  "历史版 · 未获积分资格": "Past version · not points-eligible",
  "不通过并停止公开": "Reject and stop public access",
};
function useReviewText() {
  const { locale, t: translate } = useLocale();
  return { locale, t: (value: string) => locale === "en" ? reviewEnglish[value] ?? translate(value) : value };
}

function reviewDescription(item: ProblemReview, decision: "rejected" | "revoked", locale: AppLocale) {
  if (locale === "en") {
    if (decision === "revoked") return `Withdrawing this version of “${item.title}” removes it from school-wide free practice and stops new leaderboard points. Assigned activities can still access the fixed version; historical points remain.`;
    return `The current published version of “${item.title}” ${item.schoolVisibleAt ? "stops being public" : "remains restricted to assigned students"} and does not award leaderboard points. Past accepted submissions receive no retroactive points.`;
  }
  if (decision === "revoked") return `撤下“${item.title}”的此版本后，全校自由练习将不可见，后续不再新增排名积分；已分配活动仍可访问此固定版本，历史榜分保留。`;
  return `题目“${item.title}”的当前已发布版本将${item.schoolVisibleAt ? "停止全校自由练习公开，且" : "继续仅供指定活动学生使用，"}不计入排名积分；历史 AC 不追溯。`;
}

export function ProblemReviews() {
  const { locale, t } = useReviewText();
  const reviews = useData<{ items: ProblemReview[] }>("problems/rank-review");
  const banks = useData<{ items: ReviewBank[] }>("problem-banks");
  const action = useMutation();
  const bankAction = useMutation();
  const [filter, setFilter] = useState<ReviewStatus | "all">("all");
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);
  const [approving, setApproving] = useState<string | null>(null);
  const [bankId, setBankId] = useState("");
  const [promote, setPromote] = useState<ReviewBank | null>(null);
  const [candidate, setCandidate] = useState<{ item: ProblemReview; decision: "rejected" | "revoked" } | null>(null);
  const [inspecting, setInspecting] = useState<ProblemReview | null>(null);
  const [reason, setReason] = useState("");
  const items = reviews.data?.items ?? [];
  const matchesFilter = (item: ProblemReview, value: ReviewStatus | "all") => value === "all" ||
    (item.rankReviewStatus === value && (value !== "pending" || item.isCurrent));
  const shown = items.filter((item) => matchesFilter(item, filter));
  const canApprove = (item: ProblemReview) => reviewVersionActions(item).canApprove;
  const approvableShown = shown.filter(canApprove);
  const selectableShown = approvableShown.slice(0, MAX_BATCH_APPROVE);
  const selectedItems = approvableShown.filter((item) => selectedVersionIds.includes(item.versionId));
  const allSelectableShownSelected = selectableShown.length > 0 && selectableShown.every((item) => selectedVersionIds.includes(item.versionId));
  const privateBanks = banks.data?.items.filter((bank) => bank.visibility === "private" && !bank.isSystem) ?? [];

  const close = () => { setCandidate(null); setReason(""); action.clear(); };
  const approve = (item: ProblemReview) => {
    setApproving(item.versionId);
    void action.run(async () => {
      await productionApi(`problems/${encodeURIComponent(item.problemId)}/rank-review`, {
        method: "PATCH",
        body: { versionId: item.versionId, decision: "approved" },
      });
      setSelectedVersionIds((ids) => ids.filter((versionId) => versionId !== item.versionId));
      reviews.reload();
      action.success(t("题目已纳入后续首次 AC 排名积分。"));
    }).finally(() => setApproving(null));
  };
  const approveSelected = () => {
    if (!selectedItems.length || selectedItems.length > MAX_BATCH_APPROVE) return;
    const selected = selectedItems.map((item) => ({ problemId: item.problemId, versionId: item.versionId }));
    setApproving("batch");
    void action.run(async () => {
      const result = await productionApi<{ approvedCount: number }>("problems/rank-review/approve-batch", {
        method: "POST",
        body: { items: selected },
      });
      setSelectedVersionIds([]);
      reviews.reload();
      action.success(locale === "en" ? `${result.approvedCount} problem versions approved.` : `已通过 ${result.approvedCount} 道题目的当前版本。`);
    }).finally(() => setApproving(null));
  };
  const decide = async () => {
    if (!candidate) return;
    await action.run(async () => {
      await productionApi(`problems/${encodeURIComponent(candidate.item.problemId)}/rank-review`, {
        method: "PATCH",
        body: {
          versionId: candidate.item.versionId,
          decision: candidate.decision,
          reason: reason.trim(),
        },
      });
      close();
      reviews.reload();
      action.success(t(candidate.decision === "revoked" ? "此版本已撤下，后续不再公开或新增排名积分；历史榜分保留。" : "题目暂不纳入全校排名积分。"));
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{locale === "en" ? "Public problem review" : "题目公开审核"}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {locale === "en" ? "Approval opens a problem for school-wide practice and future first-AC points. Before approval, a released version is available only to its assigned students." : "审核通过后，题目向全校开放自由练习并参与后续首次 AC 积分。审核前的教学版本仅指定学生可用。"}
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={reviews.loading || action.busy} onClick={() => { setSelectedVersionIds([]); reviews.reload(); }}>{t("刷新列表")}</Button>
      </div>
      <PublicationGuide/>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("审核状态筛选")}>
        {(["all", "pending", "approved", "rejected", "revoked"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={filter === value ? "primary" : "secondary"} aria-pressed={filter === value} disabled={action.busy} onClick={() => { setFilter(value); setSelectedVersionIds([]); }}>
            {t(value === "all" ? "全部" : statusLabels[value])}
            <span className="ml-1 tabular-nums">{items.filter((item) => matchesFilter(item, value)).length}</span>
          </Button>
        ))}
      </div>
      <Loading resource={reviews}>
        <div className="overflow-hidden rounded-md border border-border">
          {selectedItems.length > 0 && <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-subtle px-4 py-3 text-sm">
            <strong>{t("已选")} {selectedItems.length}</strong>
            <Button size="sm" disabled={action.busy} onClick={approveSelected}>{approving === "batch" ? t("正在通过…") : `${t("批量通过")} (${selectedItems.length})`}</Button>
            <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => setSelectedVersionIds([])}>{t("取消选择")}</Button>
            <p className="w-full text-xs leading-5 text-muted-foreground">{t("已选版本将从通过时刻起向全校开放并参与后续首次 AC 积分；历史 AC 不追溯。")}</p>
          </div>}
          {approvableShown.length > MAX_BATCH_APPROVE && <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{t("最多选择前 100 道可通过题目；审核后可继续选择下一批。")}</p>}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-left text-sm">
            <thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>
              <th scope="col" className="w-10 px-4 py-3"><input type="checkbox" aria-label={t(approvableShown.length > MAX_BATCH_APPROVE ? "选择当前列表前 100 道可通过题目" : "选择当前列表可通过题目")} checked={allSelectableShownSelected} disabled={!selectableShown.length || action.busy} onChange={(event) => setSelectedVersionIds(event.target.checked ? selectableShown.map((item) => item.versionId) : [])} /></th>
              {["题目 / 版本", "上传教师", "题库 / 题目可见性", "版本启用时间", "公开状态", "已 AC 人数", "操作"].map((label) => <th key={label} scope="col" className="px-4 py-3">{t(label)}</th>)}
            </tr></thead>
            <tbody>
              {shown.map((item) => {
                const actions = reviewVersionActions(item);
                const status = item.rankReviewStatus === "pending"
                  ? item.schoolVisibleAt
                    ? item.isCurrent ? "待审积分资格 · 旧版已公开" : "历史公开 · 未获积分资格"
                    : item.isCurrent ? statusLabels.pending : "历史版 · 未获积分资格"
                  : statusLabels[item.rankReviewStatus];
                return <tr key={item.versionId} className="border-t border-border">
                <td className="px-4 py-3">{canApprove(item) && <input type="checkbox" aria-label={`${t("选择题目")} ${item.title}`} checked={selectedVersionIds.includes(item.versionId)} disabled={action.busy || (selectedVersionIds.length >= MAX_BATCH_APPROVE && !selectedVersionIds.includes(item.versionId))} onChange={(event) => setSelectedVersionIds((ids) => event.target.checked ? [...ids, item.versionId] : ids.filter((versionId) => versionId !== item.versionId))} />}</td>
                <td className="px-4 py-3">
                  <button type="button" className="text-left font-semibold text-primary hover:underline focus-visible:underline" onClick={() => setInspecting(item)}>{item.title}</button>
                  <p className="mt-1 font-mono text-xs text-muted-foreground" title={item.versionId}>{t(item.isCurrent ? "当前版" : "历史版")} · {item.versionId.slice(0, 8)}</p>
                </td>
                <td className="px-4 py-3">{item.ownerName}</td>
                <td className="px-4 py-3">{item.bankName}<p className="mt-1 text-xs text-muted-foreground">{t(item.schoolVisibleAt ? "全校自由练习可见" : "仅指定活动学生可见")}</p></td>
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{dateLabel(item.publishedAt)}</td>
                <td className="px-4 py-3"><span className="font-medium">{t(status)}</span>{item.rankReviewReason && <p className="mt-1 max-w-60 text-xs leading-5 text-muted-foreground">{item.rankReviewReason}</p>}</td>
                <td className="px-4 py-3 tabular-nums">{item.priorAcCount}</td>
                <td className="px-4 py-3">
                  {item.rankReviewStatus === "revoked" ? <span className="text-xs text-muted-foreground">{t("已撤下 · 需发布新版")}</span>
                    : <div className="flex gap-2">
                      {(actions.canApprove || actions.canReject) && <>
                        {actions.canApprove
                          ? <Button size="sm" disabled={action.busy} onClick={() => approve(item)}>{approving === item.versionId ? t("正在通过…") : t(item.rankReviewStatus === "rejected" ? "复审通过" : "通过")}</Button>
                          : <span className="text-xs text-muted-foreground">{t("参考解未通过验证，暂不可通过")}</span>}
                        {actions.canReject && <Button size="sm" variant="secondary" disabled={action.busy} onClick={() => { action.clear(); setReason(""); setCandidate({ item, decision: "rejected" }); }}>{t(item.schoolVisibleAt ? "不通过并停止公开" : "不通过")}</Button>}
                      </>}
                      {actions.canWithdraw && <Button size="sm" variant="secondary" disabled={action.busy} onClick={() => { action.clear(); setReason(""); setCandidate({ item, decision: "revoked" }); }}>{t("撤下")}</Button>}
                      {!item.isCurrent && !item.schoolVisibleAt && <span className="text-xs text-muted-foreground">{t("历史版不可审核")}</span>}
                    </div>}
                </td>
              </tr>;})}
              {!shown.length && !reviews.loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">{t(filter === "pending" ? "当前没有待审核的题目版本。" : "此状态下暂无题目版本。")}</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      </Loading>
      {(action.error || action.message) && !candidate && <div className="pointer-events-none fixed right-4 top-20 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-3 shadow-lg" role={action.error ? "alert" : "status"}>
        <div className="pointer-events-auto flex items-start gap-3">
          <div className="min-w-0 flex-1 text-sm leading-6">{action.error ? <span className="text-destructive">{t(action.error)}</span> : <span className="text-success">{t(action.message)}</span>}</div>
          <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={locale === "en" ? "Dismiss message" : "关闭提示"} onClick={action.clear}>×</button>
        </div>
      </div>}
      <section className="border-t border-border pt-5">
        <h3 className="font-semibold">{t("题库可见范围")}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("教师新建的题库默认只供维护教师使用。管理员可将题库纳入校内审核范围；此操作不会自动公开题目或发放排名积分，每个已发布版本仍需审核。")}</p>
        <Loading resource={banks}>
          {privateBanks.length ? <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium">{t("教师私有题库")}
              <select value={bankId} onChange={(event) => setBankId(event.target.value)} className={`${inputClass} mt-1 min-w-64`}>
                <option value="">{t("选择题库")}</option>
                {privateBanks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name} · {bank.problemCount} {t("题")}</option>)}
              </select>
            </label>
            <Button size="sm" variant="secondary" disabled={!bankId || bankAction.busy} onClick={() => setPromote(privateBanks.find((bank) => bank.id === bankId) ?? null)}>{t("纳入校内审核")}</Button>
          </div> : <p className="mt-3 text-sm text-muted-foreground">{t("暂无教师私有题库。")}</p>}
        </Loading>
        <Feedback action={bankAction} />
      </section>
      {candidate && <Modal
        title={t(candidate.decision === "revoked" ? "确认撤下题目版本" : "确认暂不纳入排名积分")}
        description={reviewDescription(candidate.item, candidate.decision, locale)}
        onClose={close}
      >
        {candidate.decision !== "revoked" && <p className="text-sm text-muted-foreground">{t("当前版本已有")} {candidate.item.priorAcCount} {t("名学生曾 AC；他们需重新正式提交并通过才获得排名积分。审核通过后仍可撤下，但已产生的历史榜分不会重算。")}</p>}
        <label className="mt-4 block text-sm font-medium" htmlFor="rank-review-reason">{t(candidate.decision === "revoked" ? "撤下原因" : "不通过原因")}{t("（必填）")}</label>
        <textarea id="rank-review-reason" className={`${inputClass} mt-2 h-auto py-2`} rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t(candidate.decision === "revoked" ? "说明撤下原因，供审计与教师查看" : "说明暂不通过的原因，便于教师修订")} />
        <Feedback action={action} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>{t("取消")}</Button>
          <Button disabled={action.busy || !reason.trim()} onClick={() => void decide()}>{t(action.busy ? "正在提交…" : candidate.decision === "revoked" ? "确认撤下" : "确认审核")}</Button>
        </div>
      </Modal>}
      {promote && <Modal title={t("确认调整题库可见范围")} description={locale === "en" ? `Include “${promote.name}” in school review. This will not immediately publish problems or change existing points.` : `将“${promote.name}”纳入校内审核范围。此操作不会立即公开题目或改变已有积分。`} onClose={() => setPromote(null)}>
        <p className="text-sm leading-6 text-muted-foreground">{t("题库内当前已发布版本会进入题目审核列表。管理员审核通过后，该版本才向全校学生开放自由练习并参与后续首次 AC 排名积分。")}</p>
        <Feedback action={bankAction} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPromote(null)}>{t("取消")}</Button>
          <Button disabled={bankAction.busy} onClick={() => void bankAction.run(async () => {
            await productionApi(`problem-banks/${encodeURIComponent(promote.id)}`, { method: "PATCH", body: { visibility: "school" } });
            setPromote(null);
            setBankId("");
            banks.reload();
            reviews.reload();
            bankAction.success(t("题库已纳入校内审核范围。"));
          })}>{t("确认调整")}</Button>
        </div>
      </Modal>}
      {inspecting && <ReviewProblemDrawer key={inspecting.versionId} item={inspecting} onClose={() => setInspecting(null)} />}
    </div>
  );
}

function ReviewProblemDrawer({ item, onClose }: { item: ProblemReview; onClose: () => void }) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const detail = useData<ReviewProblemDetail>(`problems/${encodeURIComponent(item.problemId)}?versionId=${encodeURIComponent(item.versionId)}`);
  const problem = detail.data;
  return <Drawer title={item.title} eyebrow={tr("题目审核 · 只读详情", "REVIEW · READ-ONLY DETAILS")} onClose={onClose} wide>
    <Loading resource={detail}>{problem && (problem.versionId !== item.versionId
      ? <p role="alert" className="text-sm text-destructive">{tr("题目版本已变化，请关闭并刷新审核列表。", "Problem version changed. Close and refresh the review list.")}</p>
      : <div className="space-y-5 text-sm">
        <div className="rounded-md border border-border bg-surface-subtle p-3">
          <p className="font-medium">{item.bankName} · {item.ownerName}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{tr("当前查看版本", "Selected version")}: {item.versionId}</p>
          <p className="mt-2 text-xs text-muted-foreground">{tr("验证状态", "Validation")}: {problem.validationStatus ?? "—"}{problem.validationMessage ? ` · ${problem.validationMessage}` : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tr("题型", "Mode")}: {problem.mode === "function" ? tr("函数题", "Function") : tr("标准输入输出", "Standard I/O")} · {tr("时间", "Time")}: {problem.timeLimitMs} ms · {tr("内存", "Memory")}: {problem.memoryLimitMb} MB</p>
          {problem.mode === "function" && problem.functionName && <p className="mt-1 text-xs text-muted-foreground">{tr("函数名", "Function")}: <code>{problem.functionName}</code></p>}
        </div>
        <section><h3 className="font-semibold">{tr("题目描述", "Problem statement")}</h3><div className="mt-2 rounded-md border border-border p-4 leading-6"><MathContent content={problem.statement || tr("暂无题面", "No statement")} /></div></section>
        {(problem.inputDescription || problem.outputDescription) && <div className="grid gap-3 sm:grid-cols-2">{problem.inputDescription && <section><h3 className="font-semibold">{tr("输入说明", "Input")}</h3><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{problem.inputDescription}</p></section>}{problem.outputDescription && <section><h3 className="font-semibold">{tr("输出说明", "Output")}</h3><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{problem.outputDescription}</p></section>}</div>}
        <ReviewCases title={tr("公开样例", "Public samples")} cases={problem.samples ?? []} mode={problem.mode} locale={locale} />
        <ReviewCases title={tr("正式测试", "Formal tests")} cases={problem.tests ?? []} mode={problem.mode} locale={locale} formal />
        <section><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{tr("参考解答", "Reference solution")}</h3><span className="text-xs text-muted-foreground">{problem.referenceLanguage || "Python"}</span></div><pre className="mt-2 max-h-80 overflow-auto rounded-md border border-border bg-surface-subtle p-3 font-mono text-xs leading-5">{problem.referenceCode || tr("未提供", "Unavailable")}</pre></section>
      </div>)}</Loading>
  </Drawer>;
}

function ReviewCases({ title, cases, mode, locale, formal = false }: { title: string; cases: ReviewCase[]; mode: ReviewProblemDetail["mode"]; locale: AppLocale; formal?: boolean }) {
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  return <section><h3 className="font-semibold">{title} · {cases.length}</h3>{cases.length ? <div className="mt-2 space-y-3">{cases.map((test, index) => <div key={index} className="rounded-md border border-border p-3">
    <div className="flex flex-wrap items-center gap-2 font-medium"><span>{test.name || `${tr("用例", "Case")} ${index + 1}`}</span>{test.enabled === false && <span className="text-xs text-muted-foreground">{tr("已停用", "Disabled")}</span>}{formal && <span className="text-xs text-muted-foreground">{tr("权重", "Weight")}: {test.weight ?? "—"}</span>}</div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">{mode === "function" ? tr("参数", "Arguments") : tr("输入", "Input")}</p><pre className="mt-1 max-h-40 min-h-12 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-subtle p-2 font-mono text-xs">{test.input || "∅"}</pre></div><div><p className="text-xs text-muted-foreground">{mode === "function" ? tr("期望返回值", "Expected return") : tr("期望输出", "Expected output")}</p><pre className="mt-1 max-h-40 min-h-12 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-subtle p-2 font-mono text-xs">{test.expected || "∅"}</pre></div></div>
  </div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">{tr("暂无测试用例", "No test cases")}</p>}</section>;
}
