"use client";

import { Bookmark } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { StatusPill } from "@/components/page-chrome";
import problemStyles from "./problems-page.module.css";

export type LearnerProblemRow = {
  id: string;
  title: string;
  bankName?: string | null;
  tags?: string[];
  difficulty?: string | null;
  status: string;
  href?: string;
};

export function LearnerProblemTable({ rows, onOpen, empty, bookmark }: {
  rows: LearnerProblemRow[];
  onOpen?: (id: string) => void;
  empty: string;
  bookmark?: {
    savedIds: readonly string[];
    disabled: boolean;
    onToggle: (id: string) => void;
  };
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "zh" ? zh : en;
  const savedIds = new Set(bookmark?.savedIds);
  const titleClass = `${problemStyles.title} max-w-full text-left font-semibold text-primary hover:underline focus-visible:underline`;
  const openClass = `${problemStyles.open} font-semibold text-primary hover:underline focus-visible:underline`;
  const headers = [tx("完成状态", "Your status"), "ID", tx("题目", "Title"), tx("专题", "Topic"), tx("难度", "Level"), tx("题库", "Bank"), tx("操作", "Action")];

  return <div className={problemStyles.tableWrap} tabIndex={0} role="region" aria-label={tx("题目列表", "Problems")}>
    <table className={problemStyles.table} data-od-id="learner-problem-table">
      <caption className="sr-only">{tx("题目列表", "Problems")}</caption>
      <colgroup>
        {[4, 12, 8, 29, 17, 7, 16, 7].map((width, index) => <col key={index} style={{ width: `${width}%` }}/>) }
      </colgroup>
      <thead><tr><th scope="col"><span className="sr-only">{tx("收藏", "Bookmark")}</span></th>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
      <tbody>{rows.map(problem => {
        const saved = savedIds.has(problem.id);
        const bank = problem.bankName || "—";
        const tags = problem.tags?.join(" · ") || "—";
        const difficulty = problem.difficulty || "—";
        const openLabel = tx(`打开 ${problem.title}`, `Open ${problem.title}`);
        return <tr key={problem.id} data-problem-id={problem.id}>
          <td>{bookmark && <button type="button"
            aria-label={saved ? tx(`取消收藏 ${problem.title}`, `Remove bookmark ${problem.title}`) : tx(`收藏 ${problem.title}`, `Bookmark ${problem.title}`)}
            aria-pressed={saved} disabled={bookmark.disabled} onClick={() => bookmark.onToggle(problem.id)}
            className={`${problemStyles.bookmark} ${saved ? "text-primary" : "text-muted-foreground"}`}>
            <Bookmark size={15} fill={saved ? "currentColor" : "none"} aria-hidden="true"/>
          </button>}</td>
          <td><StatusPill status={problem.status}/></td>
          <td title={problem.id} className="font-mono text-xs font-semibold">{problem.id.slice(0, 8)}</td>
          <td>{problem.href
            ? <AppLink href={problem.href} title={problem.title} className={titleClass}>{problem.title}</AppLink>
            : <button type="button" title={problem.title} className={titleClass} disabled={!onOpen} onClick={() => onOpen?.(problem.id)}>{problem.title}</button>}
          </td>
          <td title={tags}><span className={`${problemStyles.truncate} text-muted-foreground`}>{tags}</span></td>
          <td title={difficulty}><span className={`${problemStyles.truncate} text-muted-foreground`}>{difficulty}</span></td>
          <td title={bank}><span className={`${problemStyles.truncate} text-muted-foreground`}>{bank}</span></td>
          <td>
            {problem.href
              ? <AppLink href={problem.href} aria-label={openLabel} className={openClass}>{tx("打开", "Open")}</AppLink>
              : <button type="button" aria-label={openLabel} className={openClass} disabled={!onOpen} onClick={() => onOpen?.(problem.id)}>{tx("打开", "Open")}</button>}
          </td>
        </tr>;
      })}</tbody>
    </table>
    {!rows.length && <div className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</div>}
  </div>;
}
