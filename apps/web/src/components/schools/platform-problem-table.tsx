"use client";
import { RowActionButton } from "@/components/ui/row-action";
import { useLocale } from "@/components/locale-context";
import { problemReviewTarget, problemValidation, problemVisibility, type PlatformProblemRow } from "./platform-problem-model";
import type { ProblemBatchOperation } from "./platform-problem-batch-dialog";

export function PlatformProblemTable({ rows, selected, busy, canManage, onSelect, onEdit, onReview, onGrant, onBatch }: {
  rows: PlatformProblemRow[]; selected: string[]; busy: boolean; canManage: boolean;
  onSelect: (ids: string[]) => void; onEdit: (id: string) => void; onReview: (row: PlatformProblemRow) => void;
  onGrant: (rows: PlatformProblemRow[]) => void; onBatch: (operation: ProblemBatchOperation) => void;
}) {
  const { locale } = useLocale(), tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const selectable = rows.filter(row => row.source || problemReviewTarget(row)).map(row => row.id), all = selectable.length > 0 && selectable.every(id => selected.includes(id));
  const visibility = { public: tx("已公开", "Public"), pending: tx("待审核", "Pending review"), rejected: tx("已驳回", "Rejected"), private: tx("未公开", "Not public") };
  const validation = { passed: tx("已通过", "Passed"), running: tx("验证中", "Validating"), incomplete: tx("待完善", "Incomplete"), failed: tx("未通过", "Failed"), unknown: "—" };
  return <div className="overflow-auto rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:outline-primary" role="region" aria-label={tx("平台公开题库", "Platform problem library")} tabIndex={0}>
    <table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-surface-subtle text-xs text-muted-foreground"><tr>
      {canManage && <th scope="col" className="w-10 px-3 py-3"><input type="checkbox" aria-label={tx("选择本页题目", "Select problems on this page")} checked={all} disabled={busy || !selectable.length || (!all && selected.length >= 100)} onChange={() => onSelect(all ? selected.filter(id => !selectable.includes(id)) : [...new Set([...selected, ...selectable])].slice(0, 100))} /></th>}
      {[tx("题目", "Problem"), tx("来源", "Source"), tx("分类", "Category"), tx("公开状态", "Visibility"), tx("验证状态", "Validation"), tx("操作", "Actions")].map(label => <th scope="col" key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}
    </tr></thead><tbody>{rows.map(row => {
      const deleted = !!row.source?.archivedAt, reviewable = !!(row.publication?.schoolId ?? (row.source?.published ? row.source.schoolId : undefined));
      return <tr key={row.id} className="border-t border-border">
        {canManage && <td className="px-3 py-3">{(row.source || problemReviewTarget(row)) && <input type="checkbox" aria-label={tx(`选择 ${row.title}`, `Select ${row.title}`)} checked={selected.includes(row.id)} disabled={busy || !selected.includes(row.id) && selected.length >= 100} onChange={event => onSelect(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} />}</td>}
        <th scope="row" className="min-w-56 max-w-md break-words px-3 py-3 font-normal">{row.source && !deleted ? <button type="button" className="text-left font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => onEdit(row.id)}>{row.title}</button> : row.title}<p className="mt-1 font-mono text-xs text-muted-foreground">{row.id.slice(0, 8)}</p></th>
        <td className="max-w-40 break-words px-3 py-3">{row.source ? <span className="inline-flex rounded border border-border px-1.5 py-0.5 text-xs font-semibold">CodeMaster</span> : row.publication?.schoolName}</td>
        <td className="max-w-44 break-words px-3 py-3">{(row.source ? row.source.bankName : row.publication?.bankName) || tx("未分类", "Unclassified")}</td>
        <td className="min-w-32 px-3 py-3"><p>{deleted ? tx("已删除", "Deleted") : visibility[problemVisibility(row)]}</p>{row.source && !deleted && <p className="mt-1 text-xs text-muted-foreground">{row.source.published ? tx("当前版本已发布", "Current version published") : tx("有未发布草稿", "Unpublished draft")}</p>}</td>
        <td className="whitespace-nowrap px-3 py-3">{validation[problemValidation(row)]}</td>
        <td className="w-px whitespace-nowrap px-3 py-3"><div className="flex items-center gap-2">
          {row.source && !deleted && <RowActionButton type="button" disabled={busy} onClick={() => onEdit(row.id)}>{tx("编辑", "Edit")}</RowActionButton>}
          {row.source && canManage && <RowActionButton type="button" disabled={busy} onClick={() => onBatch({ action: "move", rows: [row] })}>{tx("分类", "Category")}</RowActionButton>}
          {row.source && canManage && !deleted && <RowActionButton type="button" disabled={busy} onClick={() => onGrant([row])}>{tx("授权", "Editors")}</RowActionButton>}
          {reviewable && !deleted && <RowActionButton type="button" disabled={busy} onClick={() => onReview(row)}>{tx("预览与审核", "Preview & review")}</RowActionButton>}
          {row.source && canManage && <RowActionButton type="button" disabled={busy} onClick={() => onBatch({ action: deleted ? "restore" : "archive", rows: [row] })}>{deleted ? tx("恢复", "Restore") : tx("删除", "Delete")}</RowActionButton>}
        </div></td>
      </tr>;
    })}</tbody></table>
    {!rows.length && <p className="p-6 text-center text-sm text-muted-foreground">{tx("暂无匹配的题目，请调整筛选条件。", "No matching problems. Adjust the filters to see more.")}</p>}
  </div>;
}
