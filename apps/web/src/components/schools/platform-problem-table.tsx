"use client";
import { RowActionButton } from "@/components/ui/row-action";
import { useLocale } from "@/components/locale-context";
import { problemReviewTarget, problemValidation, problemVisibility, type PlatformProblemRow } from "./platform-problem-model";
import type { ProblemBatchOperation } from "./platform-problem-batch-dialog";

export function PlatformProblemTable({ rows, selected, busy, delegated, onSelect, onEdit, onReview, onGrant, onBatch }: {
  rows: PlatformProblemRow[]; selected: string[]; busy: boolean; delegated: boolean;
  onSelect: (ids: string[]) => void; onEdit: (id: string, tab?: "publication" | "solutions") => void; onReview: (row: PlatformProblemRow) => void;
  onGrant: (rows: PlatformProblemRow[]) => void; onBatch: (operation: ProblemBatchOperation) => void;
}) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const selectable = rows.filter(row => row.source || problemReviewTarget(row)).map(row => row.id), all = selectable.length > 0 && selectable.every(id => selected.includes(id));
  const visibility = { public: tx("全平台公开", "Platform-wide"), pending: tx("公开申请待审", "Access request pending"), rejected: tx("公开申请已驳回", "Access request rejected"), private: tx("未向全平台公开", "Not platform-wide") };
  const validation = { passed: tx("已通过", "Passed"), running: tx("验证中", "Validating"), incomplete: tx("待完善", "Incomplete"), failed: tx("未通过", "Failed"), unknown: "—" };
  return <div className="overflow-auto rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:outline-primary" role="region" aria-label={tx("平台题库", "Platform problem library")} tabIndex={0}>
    <table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>
      <th scope="col" className="w-10 px-3 py-3"><input type="checkbox" aria-label={tx("选择本页题目", "Select problems on this page")} checked={all} disabled={busy || !selectable.length} onChange={() => onSelect(all ? [] : selectable)} /></th>
      {[tx("题目", "Problem"), tx("来源", "Source"), tx("分类", "Category"), delegated ? tx("草稿状态", "Draft status") : tx("全平台公开状态", "Platform-wide access"), tx("验证状态", "Validation"), tx("操作", "Actions")].map(label => <th scope="col" key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}
    </tr></thead><tbody>{rows.map(row => {
      const deleted = !!row.source?.archivedAt, reviewable = !!(row.publication?.schoolId ?? (row.source?.published ? row.source.schoolId : undefined));
      const editable = row.source?.canEdit === true && !deleted;
      return <tr key={row.id} className="border-t border-border">
        <td className="px-3 py-3">{(row.source || problemReviewTarget(row)) && <input type="checkbox" aria-label={tx(`选择 ${row.title}`, `Select ${row.title}`)} checked={selected.includes(row.id)} disabled={busy} onChange={event => onSelect(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} />}</td>
        <th scope="row" className="min-w-56 max-w-md break-words px-3 py-3 font-normal">{editable ? <button type="button" className="text-left font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onEdit(row.id)}>{row.title}</button> : row.title}<p className="mt-1 font-mono text-xs text-muted-foreground">{row.id.slice(0, 8)}</p></th>
        <td className="max-w-40 break-words px-3 py-3">{row.source ? <span className="inline-flex rounded border border-border px-1.5 py-0.5 text-xs font-semibold">CodeMaster</span> : row.publication?.schoolName}</td>
        <td className="max-w-44 break-words px-3 py-3">{(row.source ? row.source.bankName : row.publication?.bankName) || tx("未分类", "Unclassified")}</td>
        <td className="min-w-32 px-3 py-3">{!delegated && <p>{deleted ? tx("已删除", "Deleted") : visibility[problemVisibility(row)]}</p>}{row.source && !deleted && <>
          {row.source.draftReviewStatus === "pending" && editable
            ? <button type="button" className="mt-1 block text-left text-xs text-primary underline" onClick={() => onEdit(row.id, "publication")}>{tx("审核题目草稿", "Review problem draft")}</button>
            : <p className="mt-1 text-xs text-muted-foreground">{row.source.hasDraftChanges || !row.source.published ? tx("有未发布草稿", "Unpublished draft") : tx("题目已发布", "Problem published")}</p>}
          {!delegated && row.source.hasSolutionDraft && editable && <button type="button" className="mt-1 block text-left text-xs text-primary underline" onClick={() => onEdit(row.id, "solutions")}>{tx("审核题解草稿", "Review solution draft")}</button>}
        </>}</td>
        <td className="whitespace-nowrap px-3 py-3">{validation[problemValidation(row)]}</td>
        <td className="w-px whitespace-nowrap px-3 py-3"><div className="flex items-center gap-2">
          {editable && <RowActionButton type="button" disabled={busy} onClick={() => onEdit(row.id)}>{tx("编辑", "Edit")}</RowActionButton>}
          {!delegated && row.source && <RowActionButton type="button" disabled={busy} onClick={() => onBatch({ action: "move", rows: [row] })}>{tx("分类", "Category")}</RowActionButton>}
          {!delegated && row.source && !deleted && <RowActionButton type="button" disabled={busy} onClick={() => onGrant([row])}>{tx("授权", "Editors")}</RowActionButton>}
          {!delegated && reviewable && !deleted && <RowActionButton type="button" disabled={busy} onClick={() => onReview(row)}>{tx("预览并管理全平台公开", "Preview & manage platform-wide access")}</RowActionButton>}
          {!delegated && row.source && <RowActionButton type="button" disabled={busy} onClick={() => onBatch({ action: deleted ? "restore" : "archive", rows: [row] })}>{deleted ? tx("恢复", "Restore") : tx("删除", "Delete")}</RowActionButton>}
        </div></td>
      </tr>;
    })}</tbody></table>
    {!rows.length && <p className="p-6 text-center text-sm text-muted-foreground">{tx("暂无匹配的题目，请调整筛选条件。", "No matching problems. Adjust the filters to see more.")}</p>}
  </div>;
}
