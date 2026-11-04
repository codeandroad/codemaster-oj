import { useEffect, useRef } from "react";

type SelectableRow = { id: string; disabled?: boolean };

/** Resolve an additive Shift range in display order. A plain activation sets its starting point. */
export function useRangeSelection(rows: readonly SelectableRow[], scope = "") {
  const anchor = useRef<{ id: string; scope: string } | null>(null);

  useEffect(() => { anchor.current = null; }, [scope]);

  function resetAnchor() {
    anchor.current = null;
  }

  function getRange(id: string, { nativeEvent }: { nativeEvent: Event }): string[] | null {
    const end = rows.findIndex(row => row.id === id && !row.disabled);
    if (end < 0) return null;

    const previous = anchor.current;
    if ("shiftKey" in nativeEvent && nativeEvent.shiftKey && previous?.scope === scope) {
      const start = rows.findIndex(row => row.id === previous.id);
      if (start >= 0) {
        return rows.slice(Math.min(start, end), Math.max(start, end) + 1)
          .filter(row => !row.disabled)
          .map(row => row.id);
      }
    }
    anchor.current = { id, scope };
    return null;
  }

  return { getRange, resetAnchor };
}
