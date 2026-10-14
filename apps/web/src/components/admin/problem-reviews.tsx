"use client";

import { useState } from "react";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { Feedback, Loading, Modal, dateLabel, inputClass, useData, useMutation } from "./common";

type ReviewStatus = "pending" | "approved" | "rejected" | "revoked";

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
}

interface ReviewBank {
  id: string;
  name: string;
  visibility: "school" | "private";
  isSystem?: boolean;
  problemCount: number;
}

const statusLabels: Record<ReviewStatus, string> = {
  pending: "待审核",
  approved: "已纳入排名积分",
  rejected: "未纳入排名积分",
  revoked: "已撤下",
};

function reviewDescription(item: ProblemReview, decision: "approved" | "rejected" | "revoked") {
  if (decision === "revoked") return `撤下“${item.title}”的此版本后，全校自由练习将不可见，后续不再新增排名积分；已分配活动仍可访问此固定版本，历史榜分保留。`;
  if (decision === "approved") return `题目“${item.title}”的当前已发布版本将${item.schoolVisibleAt ? "继续向全校开放，并从此刻起" : "从此刻起向全校开放，"}参与首次 AC 排名积分；历史 AC 不追溯。`;
  return `题目“${item.title}”的当前已发布版本将${item.schoolVisibleAt ? "停止全校自由练习公开，且" : "继续仅供指定活动学生使用，"}不计入排名积分；历史 AC 不追溯。`;
}

export function ProblemReviews() {
  const reviews = useData<{ items: ProblemReview[] }>("problems/rank-review");
  const banks = useData<{ items: ReviewBank[] }>("problem-banks");
  const action = useMutation();
  const bankAction = useMutation();
  const [filter, setFilter] = useState<ReviewStatus | "all">("pending");
  const [bankId, setBankId] = useState("");
  const [promote, setPromote] = useState<ReviewBank | null>(null);
  const [candidate, setCandidate] = useState<{ item: ProblemReview; decision: "approved" | "rejected" | "revoked" } | null>(null);
  const [reason, setReason] = useState("");
  const items = reviews.data?.items ?? [];
  const shown = filter === "all" ? items : items.filter((item) => item.rankReviewStatus === filter);
  const privateBanks = banks.data?.items.filter((bank) => bank.visibility === "private" && !bank.isSystem) ?? [];

  const close = () => { setCandidate(null); setReason(""); action.clear(); };
  const decide = async () => {
    if (!candidate) return;
    await action.run(async () => {
      await productionApi(`problems/${encodeURIComponent(candidate.item.problemId)}/rank-review`, {
        method: "PATCH",
        body: {
          versionId: candidate.item.versionId,
          decision: candidate.decision,
          ...(candidate.decision !== "approved" ? { reason: reason.trim() } : {}),
        },
      });
      close();
      reviews.reload();
      action.success(candidate.decision === "approved" ? "题目已纳入后续首次 AC 排名积分。" : candidate.decision === "revoked" ? "此版本已撤下，后续不再公开或新增排名积分；历史榜分保留。" : "题目暂不纳入全校排名积分。");
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">题目排名积分资格审核</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            列出校内题库已发布的当前及历史版本。教师可以发布题目供教学使用；只有管理员审核通过的版本，后续首次 AC 才计入全校积分排行榜。
          </p>
        </div>
        <Button variant="secondary" size="sm" disabled={reviews.loading} onClick={reviews.reload}>刷新列表</Button>
      </div>
      <p className="rounded-md border border-border bg-surface-subtle px-4 py-3 text-xs leading-5 text-muted-foreground">
        新版本须重新审核；已有 AC 不追溯计分，学生须重新正式提交并通过才获得排名积分。已公开版本（含历史版）可撤下，停止后续公开与新增榜分，历史榜分保留；撤下后如需恢复，请发布新版本。
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="审核状态筛选">
        {(["pending", "all", "approved", "rejected", "revoked"] as const).map((value) => (
          <Button key={value} type="button" size="sm" variant={filter === value ? "primary" : "secondary"} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === "all" ? "全部" : statusLabels[value]}
            <span className="ml-1 tabular-nums">{value === "all" ? items.length : items.filter((item) => item.rankReviewStatus === value).length}</span>
          </Button>
        ))}
      </div>
      <Loading resource={reviews}>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>
              {["题目 / 版本", "上传教师", "题库 / 题目可见性", "发布时间", "积分资格", "已 AC 人数", "操作"].map((label) => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}
            </tr></thead>
            <tbody>
              {shown.map((item) => <tr key={item.versionId} className="border-t border-border">
                <td className="px-4 py-3">
                  <AppLink href={`/teacher/problems/${encodeURIComponent(item.problemId)}/edit?${new URLSearchParams({ versionId: item.versionId, returnTo: "/admin/settings?tab=problem-reviews" })}`} className="font-semibold text-primary hover:underline focus-visible:underline">{item.title}</AppLink>
                  <p className="mt-1 font-mono text-xs text-muted-foreground" title={item.versionId}>{item.isCurrent ? "当前版" : "历史版"} · {item.versionId.slice(0, 8)}</p>
                </td>
                <td className="px-4 py-3">{item.ownerName}</td>
                <td className="px-4 py-3">{item.bankName}<p className="mt-1 text-xs text-muted-foreground">{item.schoolVisibleAt ? "全校自由练习可见" : "仅指定活动学生可见"}</p></td>
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{dateLabel(item.publishedAt)}</td>
                <td className="px-4 py-3"><span className="font-medium">{statusLabels[item.rankReviewStatus]}</span>{item.rankReviewReason && <p className="mt-1 max-w-60 text-xs leading-5 text-muted-foreground">{item.rankReviewReason}</p>}</td>
                <td className="px-4 py-3 tabular-nums">{item.priorAcCount}</td>
                <td className="px-4 py-3">
                  {item.rankReviewStatus === "revoked" ? <span className="text-xs text-muted-foreground">已撤下 · 需发布新版</span>
                    : <div className="flex gap-2">
                      {item.isCurrent && item.rankReviewStatus !== "approved" && <>
                        <Button size="sm" onClick={() => { action.clear(); setReason(""); setCandidate({ item, decision: "approved" }); }}>{item.rankReviewStatus === "rejected" ? "复审通过" : "通过"}</Button>
                        {item.rankReviewStatus === "pending" && <Button size="sm" variant="secondary" onClick={() => { action.clear(); setReason(""); setCandidate({ item, decision: "rejected" }); }}>不通过</Button>}
                      </>}
                      {item.schoolVisibleAt && <Button size="sm" variant="secondary" onClick={() => { action.clear(); setReason(""); setCandidate({ item, decision: "revoked" }); }}>撤下</Button>}
                      {!item.isCurrent && !item.schoolVisibleAt && <span className="text-xs text-muted-foreground">历史版不可审核</span>}
                    </div>}
                </td>
              </tr>)}
              {!shown.length && !reviews.loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{filter === "pending" ? "当前没有待审核的题目版本。" : "此状态下暂无题目版本。"}</td></tr>}
            </tbody>
          </table>
        </div>
      </Loading>
      <Feedback action={action} />
      <section className="border-t border-border pt-5">
        <h3 className="font-semibold">题库可见范围</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">教师新建的题库默认只供维护教师使用。管理员可将题库纳入校内审核范围；此操作不会自动公开题目或发放排名积分，每个已发布版本仍需单独审核。</p>
        <Loading resource={banks}>
          {privateBanks.length ? <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium">教师私有题库
              <select value={bankId} onChange={(event) => setBankId(event.target.value)} className={`${inputClass} mt-1 min-w-64`}>
                <option value="">选择题库</option>
                {privateBanks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name} · {bank.problemCount} 题</option>)}
              </select>
            </label>
            <Button size="sm" variant="secondary" disabled={!bankId || bankAction.busy} onClick={() => setPromote(privateBanks.find((bank) => bank.id === bankId) ?? null)}>纳入校内审核</Button>
          </div> : <p className="mt-3 text-sm text-muted-foreground">暂无教师私有题库。</p>}
        </Loading>
        <Feedback action={bankAction} />
      </section>
      {candidate && <Modal
        title={candidate.decision === "approved" ? "确认纳入全校排名积分" : candidate.decision === "revoked" ? "确认撤下题目版本" : "确认暂不纳入排名积分"}
        description={reviewDescription(candidate.item, candidate.decision)}
        onClose={close}
      >
        {candidate.decision !== "revoked" && <p className="text-sm text-muted-foreground">当前版本已有 {candidate.item.priorAcCount} 名学生曾 AC；他们需重新正式提交并通过才获得排名积分。审核通过后仍可撤下，但已产生的历史榜分不会重算。</p>}
        {candidate.decision !== "approved" && <>
          <label className="mt-4 block text-sm font-medium" htmlFor="rank-review-reason">{candidate.decision === "revoked" ? "撤下原因" : "不通过原因"}（必填）</label>
          <textarea id="rank-review-reason" className={`${inputClass} mt-2 h-auto py-2`} rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={candidate.decision === "revoked" ? "说明撤下原因，供审计与教师查看" : "说明暂不通过的原因，便于教师修订"} />
        </>}
        <Feedback action={action} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>取消</Button>
          <Button disabled={action.busy || (candidate.decision !== "approved" && !reason.trim())} onClick={() => void decide()}>{action.busy ? "正在提交…" : candidate.decision === "revoked" ? "确认撤下" : "确认审核"}</Button>
        </div>
      </Modal>}
      {promote && <Modal title="确认调整题库可见范围" description={`将“${promote.name}”纳入校内审核范围。此操作不会立即公开题目或改变已有积分。`} onClose={() => setPromote(null)}>
        <p className="text-sm leading-6 text-muted-foreground">题库内当前已发布版本会进入题目审核列表。管理员逐题审核通过后，该版本才向全校学生开放自由练习并参与后续首次 AC 排名积分。</p>
        <Feedback action={bankAction} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPromote(null)}>取消</Button>
          <Button disabled={bankAction.busy} onClick={() => void bankAction.run(async () => {
            await productionApi(`problem-banks/${encodeURIComponent(promote.id)}`, { method: "PATCH", body: { visibility: "school" } });
            setPromote(null);
            setBankId("");
            banks.reload();
            reviews.reload();
            bankAction.success("题库已纳入校内审核范围。");
          })}>确认调整</Button>
        </div>
      </Modal>}
    </div>
  );
}
