"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { inputClass } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";
import { usePlatformError } from "./platform-ui";

export type PlatformAccountCandidate = {
  accountId: string;
  name: string;
  username: string;
};

type SearchResult =
  | { term: string; items: PlatformAccountCandidate[] }
  | { term: string; error: unknown };

export function PlatformAccountPicker({
  value,
  onChange,
}: {
  value: PlatformAccountCandidate | null;
  onChange: (value: PlatformAccountCandidate | null) => void;
}) {
  const text = useSchoolText();
  const localError = usePlatformError();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(-1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const term = query.trim();
  const searching = open && !value && !composing && term.length >= 2;
  const current = result?.term === term && !value && !composing ? result : null;
  const items = searching && current && "items" in current ? current.items : [];
  const error = current && "error" in current ? current : null;
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term });
        const { items } = await productionApi<{ items: PlatformAccountCandidate[] }>(
          `platform/school-admin-candidates?${params}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setResult({ term, items });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ term, error });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [revision, searching, term]);

  function select(account: PlatformAccountCandidate) {
    onChange(account);
    setQuery("");
    setOpen(false);
    setActive(-1);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing || event.keyCode === 229) return;
    if (event.key === "Escape" && searching) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Enter" && !value) {
      event.preventDefault();
      if (items[active]) select(items[active]);
    } else if (!value && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setOpen(true);
      if (!items.length) return;
      const next = event.key === "ArrowDown"
        ? Math.min(active + 1, items.length - 1)
        : active < 0 ? items.length - 1 : Math.max(0, active - 1);
      setActive(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {text("School administrator", "学校管理员")}
      </label>
      <div className="relative mt-1">
        <Search aria-hidden="true" size={16} className="pointer-events-none absolute top-3 left-3 text-muted-foreground" />
        <input
          id={id}
          ref={input}
          role="combobox"
          aria-autocomplete="list"
          aria-required="true"
          aria-expanded={items.length > 0}
          aria-controls={items.length ? `${id}-results` : undefined}
          aria-activedescendant={items[active] ? optionId(active) : undefined}
          aria-describedby={value ? `${id}-username ${id}-hint` : `${id}-hint`}
          data-account-search-open={searching ? "" : undefined}
          className={`${inputClass} pl-9`}
          value={value?.name ?? query}
          placeholder={text("Search by name or username", "按姓名或用户名搜索")}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={100}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => { setOpen(false); setActive(-1); }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={handleKey}
          onChange={(event) => {
            onChange(null);
            setQuery(event.target.value);
            setResult(null);
            setActive(-1);
            setOpen(true);
          }}
        />
      </div>
      {value && <p id={`${id}-username`} className="mt-1 break-all text-xs text-muted-foreground">@{value.username}</p>}
      {items.length > 0 && (
        <ul id={`${id}-results`} role="listbox" aria-label={text("Matching accounts", "匹配的账号")}
          className="mt-1 max-h-40 overflow-y-auto rounded-md border border-input bg-surface p-1">
          {items.map((account, index) => (
            <li key={account.accountId} id={optionId(index)} role="option"
              aria-selected={index === active}
              className="cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-muted aria-selected:bg-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(account)}>
              <span className="block break-words font-medium">{account.name}</span>
              <span className="block break-all text-xs text-muted-foreground">@{account.username}</span>
            </li>
          ))}
        </ul>
      )}
      <div role="status" className="text-sm text-muted-foreground">
        {searching && !current && <p className="mt-1 px-1 py-2">{text("Searching accounts…", "正在搜索账号…")}</p>}
        {searching && current && "items" in current && !items.length && (
          <p className="mt-1 px-1 py-2">{text("No matching accounts. Try a different name or username.", "没有匹配的账号，请换个姓名或用户名试试。")}</p>
        )}
        {items.length > 0 && <span className="sr-only">{text(`${items.length} matching accounts`, `找到 ${items.length} 个匹配账号`)}</span>}
      </div>
      {error && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2">
          <p role="alert" className="text-sm text-destructive">{localError(error.error).message}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => {
            setResult(null);
            setRevision((previous) => previous + 1);
            input.current?.focus();
          }}>{text("Retry search", "重试搜索")}</Button>
        </div>
      )}
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
        {text(
          "Enter at least 2 characters. Personal accounts can be selected before they join a school.",
          "输入至少 2 个字符。自由注册的个人账号无需先加入学校。",
        )}
      </p>
    </div>
  );
}
