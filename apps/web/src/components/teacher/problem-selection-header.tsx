"use client";

import type { Dispatch, SetStateAction } from "react";
import { useLocale } from "@/components/locale-context";

export function ProblemSelectionHeader({ rows, checked, setChecked, busy }: {
  rows: readonly { id: string }[];
  checked: string[];
  setChecked: Dispatch<SetStateAction<string[]>>;
  busy: boolean;
}) {
  const { locale } = useLocale();
  const selected = new Set(checked);
  const selectedCount = rows.filter(row => selected.has(row.id)).length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;
  const label = locale === "zh" ? "全选当前页" : "Select all on this page";

  return <input type="checkbox" aria-label={label} title={label} checked={allSelected}
    disabled={busy || rows.length === 0}
    ref={element => { if (element) element.indeterminate = selectedCount > 0 && !allSelected; }}
    onChange={event => {
      const select = event.currentTarget.checked;
      const rowIds = new Set(rows.map(row => row.id));
      setChecked(ids => select ? [...new Set([...ids, ...rowIds])] : ids.filter(id => !rowIds.has(id)));
    }} />;
}
