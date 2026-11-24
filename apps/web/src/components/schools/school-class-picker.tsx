"use client";

import { useState } from "react";
import { Loading, useData } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { useRangeSelection } from "@/components/ui/use-range-selection";
import { useSchoolText } from "./school-ui";

export function SchoolClassPicker({
  schoolId,
  selected,
  maxSelected,
  onChange,
}: {
  schoolId: string;
  selected: string[];
  maxSelected?: number;
  onChange: (classIds: string[]) => void;
}) {
  const text = useSchoolText();
  const [page, setPage] = useState(1);
  const count = maxSelected === undefined
    ? selected.length
    : `${selected.length}/${maxSelected}`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          {text(`Selected classes: ${count}`, `已选班级：${count}`)}
        </span>
        {selected.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange([])}
          >
            {text("Clear selection", "清空选择")}
          </Button>
        )}
      </div>
      <ClassPickerPage
        key={`${schoolId}:${page}`}
        schoolId={schoolId}
        page={page}
        selected={selected}
        maxSelected={maxSelected}
        onChange={onChange}
        onPage={setPage}
      />
    </div>
  );
}

function ClassPickerPage({
  schoolId,
  page,
  selected,
  maxSelected,
  onChange,
  onPage,
}: {
  schoolId: string;
  page: number;
  selected: string[];
  maxSelected?: number;
  onChange: (classIds: string[]) => void;
  onPage: (page: number) => void;
}) {
  const text = useSchoolText();
  const resource = useData<{ items: { id: string; name: string }[]; hasMore: boolean }>(
    `schools/${schoolId}/classes?page=${page}`,
  );
  const range = useRangeSelection(
    resource.data?.items ?? [],
    `${schoolId}:${page}`,
  );
  const [limitReached, setLimitReached] = useState(false);
  return (
    <Loading resource={resource}>
      <div className="max-h-40 overflow-y-auto rounded-md border border-border">
        {(resource.data?.items ?? []).map((item) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-muted"
          >
            <input
              type="checkbox"
              name="classIds"
              value={item.id}
              checked={selected.includes(item.id)}
              onChange={(event) => {
                const ids = range.getRange(item.id, event) ?? [item.id];
                const next = event.currentTarget.checked
                  ? [...new Set([...selected, ...ids])]
                  : selected.filter((id) => !ids.includes(id));
                if (maxSelected !== undefined && next.length > maxSelected) {
                  setLimitReached(true);
                  return;
                }
                setLimitReached(false);
                onChange(next);
              }}
            />
            <span className="min-w-0 break-words">{item.name}</span>
          </label>
        ))}
        {!resource.data?.items.length && (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            {text(
              "No classes are available on this page.",
              "本页没有可选班级。",
            )}
          </p>
        )}
      </div>
      {limitReached && (
        <p role="alert" className="text-xs text-destructive">
          {text(`Select up to ${maxSelected} classes.`, `最多选择 ${maxSelected} 个班级。`)}
        </p>
      )}
      {(page > 1 || resource.data?.hasMore) && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            {text("Previous", "上一页")}
          </Button>
          <span>{text(`Page ${page}`, `第 ${page} 页`)}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!resource.data?.hasMore}
            onClick={() => onPage(page + 1)}
          >
            {text("Next", "下一页")}
          </Button>
        </div>
      )}
    </Loading>
  );
}
