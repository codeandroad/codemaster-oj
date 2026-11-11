"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useLocale } from "@/components/locale-context";

type Choice = { id: string; title: string };
type SearchState = { value: string; query: string | null; open: boolean; active: number };
const resultLimit = 50;
const normalize = (value: string) => value.normalize("NFKC").toLowerCase();

/** A local title picker. The caller supplies only choices the user may manage. */
export function SearchableSelect({ choices, value, onChange, disabled = false, label, placeholder }: {
  choices: readonly Choice[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  placeholder?: string;
}) {
  const { locale } = useLocale();
  const tr = (zh: string, en: string) => locale === "zh" ? zh : en;
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const composing = useRef(false);
  const [search, setSearch] = useState<SearchState>({ value, query: null, open: false, active: -1 });
  const open = !disabled && search.value === value && search.open;
  const query = open ? search.query : null;
  const selected = choices.find(choice => choice.id === value);
  const indexed = useMemo(() => choices.map(choice => ({ choice, searchTitle: normalize(choice.title) })), [choices]);
  const matches = useMemo(() => {
    const keywords = normalize(query ?? "").trim().split(/\s+/).filter(Boolean);
    return indexed.filter(item => keywords.every(keyword => item.searchTitle.includes(keyword))).map(item => item.choice);
  }, [indexed, query]);
  const items = matches.slice(0, resultLimit);
  const active = open ? Math.min(search.active, items.length - 1) : -1;
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active, query]);

  function close() {
    setSearch({ value, query: null, open: false, active: -1 });
  }

  function choose(next: string) {
    if (disabled) return;
    onChange(next);
    setSearch({ value: next, query: null, open: false, active: -1 });
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown"
        ? Math.min(active + 1, items.length - 1)
        : active < 0 ? items.length - 1 : Math.max(0, active - 1);
      setSearch({ value, query, open: true, active: next });
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (items[active]) choose(items[active].id);
    }
  }

  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
    <div className="relative min-w-0">
      <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-muted-foreground" />
      <input id={id} ref={input} type="text" role="combobox" aria-autocomplete="list"
        aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={active >= 0 ? optionId(active) : undefined} aria-describedby={`${id}-hint`}
        className="h-10 w-full min-w-0 rounded-md border border-input bg-background pl-9 pr-20 text-sm outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
        value={query ?? selected?.title ?? ""} disabled={disabled} placeholder={placeholder ?? tr("输入题名或活动名搜索", "Search by problem or activity title")}
        autoComplete="off" spellCheck={false}
        onFocus={event => {
          setSearch({ value, query: null, open: true, active: -1 });
          event.currentTarget.select();
        }}
        onClick={() => { if (!open) setSearch({ value, query: null, open: true, active: -1 }); }}
        onBlur={close} onKeyDown={keyDown}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onChange={event => setSearch({ value, query: event.target.value, open: true, active: 0 })}
      />
      <div className="absolute inset-y-0 right-1 flex items-center">
        {value && <button type="button" disabled={disabled} aria-label={tr(`清除${label}`, `Clear ${label}`)}
          className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none"
          onMouseDown={event => event.preventDefault()} onClick={() => { choose(""); input.current?.focus(); }}>
          <X size={15} aria-hidden="true" />
        </button>}
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={tr("显示选项", "Show choices")}
          className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted disabled:pointer-events-none"
          onMouseDown={event => event.preventDefault()} onClick={() => {
            input.current?.focus();
            setSearch({ value, query: null, open: !open, active: -1 });
          }}>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      {open && <div className="absolute top-full z-30 mt-1 w-full min-w-0 overflow-hidden rounded-md border border-border bg-surface shadow-md">
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto overscroll-contain p-1">
          {items.map((choice, index) => <li key={choice.id} id={optionId(index)} role="option" aria-selected={choice.id === value}
            className={`flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-sm hover:bg-muted ${active === index ? "bg-muted" : ""}`}
            onMouseDown={event => event.preventDefault()} onMouseMove={() => {
              if (active !== index) setSearch({ value, query, open: true, active: index });
            }} onClick={() => choose(choice.id)}>
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{choice.title}</span>
            {choice.id === value && <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />}
          </li>)}
        </ul>
        <p role="status" className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{matches.length > resultLimit
          ? tr(`共 ${matches.length} 个匹配项，显示前 ${resultLimit} 个。请继续输入关键词缩小范围。`, `${matches.length} matches; showing the first ${resultLimit}. Add keywords to narrow the list.`)
          : matches.length
            ? tr(`${matches.length} 个匹配项`, `${matches.length} matching item${matches.length === 1 ? "" : "s"}`)
            : tr("没有匹配项，请换个关键词。", "No matches. Try another keyword.")}</p>
      </div>}
    </div>
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">{tr("按名称关键词搜索，用方向键选择，回车确认。", "Search title keywords, use arrow keys to choose, then press Enter.")}</p>
  </div>;
}
