"use client";

import { useLocale } from "@/components/locale-context";

interface ProblemGroupFilterProps {
  groups: readonly { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ProblemGroupFilter({ groups, value, onChange, disabled }: ProblemGroupFilterProps) {
  const { locale } = useLocale();
  const text = (zh: string, en: string) => locale === "zh" ? zh : en;
  return (
    <select
      aria-label={text("分组", "Groups")}
      className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60 sm:w-52"
      disabled={disabled}
      value={value}
      onChange={event => onChange(event.target.value)}
    >
      <option value="">{text("全部分组", "All groups")}</option>
      <option value="ungrouped">{text("未分组", "Ungrouped")}</option>
      {value && value !== "ungrouped" && !groups.some(group => group.id === value) && (
        <option value={value} disabled>{text("分组已不可用", "Group unavailable")}</option>
      )}
      {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
    </select>
  );
}
