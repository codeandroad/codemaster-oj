import { useState, type ChangeEvent, type SetStateAction } from "react";
import { useRangeSelection } from "@/components/ui/use-range-selection";

export function useProblemSelection(rows: readonly { id: string }[], scope: string) {
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope, ids: [] });
  const checked = selection.scope === scope ? selection.ids : [];
  const { getRange, resetAnchor } = useRangeSelection(rows, scope);

  function updateChecked(next: SetStateAction<string[]>) {
    setSelection(current => ({ scope, ids: typeof next === "function" ? next(current.scope === scope ? current.ids : []) : next }));
  }

  function setChecked(next: SetStateAction<string[]>) {
    resetAnchor();
    updateChecked(next);
  }

  function changeRow(id: string, event: ChangeEvent<HTMLInputElement>) {
    const isChecked = event.currentTarget.checked;
    const range = getRange(id, event);
    updateChecked((ids) => range || isChecked
      ? [...new Set([...ids, ...(range ?? [id])])]
      : ids.filter((checkedId) => checkedId !== id));
  }

  return { checked, setChecked, changeRow };
}
