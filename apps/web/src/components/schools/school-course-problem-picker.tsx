"use client";
import { useState, type ChangeEvent } from "react";
import { useData, Loading, inputClass } from "@/components/admin/common";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRangeSelection } from "@/components/ui/use-range-selection";
import { useSchoolText } from "./school-ui";
import type { Problem } from "./school-practice-types";
import type { CourseProblem } from "./school-courses-model";

export function SchoolCourseProblemPicker({
  schoolId,
  selected,
  onChange,
}: {
  schoolId: string;
  selected: CourseProblem[];
  onChange: (items: CourseProblem[]) => void;
}) {
  const text = useSchoolText();
  const resource = useData<{ items: Problem[] }>(
    `schools/${schoolId}/problems`,
  );
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const available = (resource.data?.items ?? []).filter(
    (p) => p.published && p.versionId,
  );
  const filtered = available.filter((p) =>
    `${p.title} ${p.bankName}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selection = useRangeSelection(filtered, search);
  function toggle(id: string, event: ChangeEvent<HTMLInputElement>) {
    const range = selection.getRange(id, event);
    const ids = range ?? [id];
    const checked = !!range || event.target.checked;
    const keys = new Set(selected.map((p) => p.problemId));
    for (const key of ids) {
      if (checked) keys.add(key);
      else keys.delete(key);
    }
    onChange(
      [...keys].map((key) => {
        const p = available.find((p) => p.id === key);
        return p
          ? { problemId: key, versionId: p.versionId!, title: p.title }
          : selected.find((p) => p.problemId === key)!;
      }),
    );
  }
  return (
    <section className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {text(
            `Practice (${selected.length})`,
            `配套练习（${selected.length}）`,
          )}
        </h4>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? text("Done", "完成") : text("Choose problems", "选择题目")}
        </Button>
      </div>
      {selected.length > 0 && (
        <ol className="mt-2 space-y-1 text-sm">
          {selected.map((p, i) => (
            <li
              key={p.problemId}
              className="flex items-center justify-between gap-2"
            >
              <span>
                {i + 1}.{" "}
                {available.find((x) => x.id === p.problemId)?.title ??
                  p.title ??
                  p.problemId}
              </span>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={i === 0}
                  aria-label={text("Move problem up", "上移题目")}
                  onClick={() => {
                    const next = [...selected];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    onChange(next);
                  }}
                >
                  <ArrowUp size={13} />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={i === selected.length - 1}
                  aria-label={text("Move problem down", "下移题目")}
                  onClick={() => {
                    const next = [...selected];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    onChange(next);
                  }}
                >
                  <ArrowDown size={13} />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange(
                      selected.filter((x) => x.problemId !== p.problemId),
                    )
                  }
                >
                  {text("Remove", "移除")}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {open && (
        <div className="mt-2 space-y-2">
          <input
            aria-label={text("Search problems", "搜索题目")}
            placeholder={text("Search problems or banks", "搜索题目或题库")}
            className={`${inputClass} h-9`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Loading resource={resource}>
            <div className="max-h-56 overflow-auto divide-y divide-border rounded-md border border-border">
              {filtered.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.some((x) => x.problemId === p.id)}
                    onChange={(e) => toggle(p.id, e)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {p.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.bankName}
                    </span>
                  </span>
                </label>
              ))}
              {!filtered.length && (
                <p className="p-3 text-sm text-muted-foreground">
                  {text(
                    "No published problems match.",
                    "没有符合条件的已发布题目。",
                  )}
                </p>
              )}
            </div>
          </Loading>
        </div>
      )}
    </section>
  );
}
