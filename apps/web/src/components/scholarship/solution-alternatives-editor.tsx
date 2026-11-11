"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { useNavigationBlocker } from "@/components/navigation";
import { area, input, Modal } from "@/components/teacher/shared";
import { Button } from "@/components/ui/button";
import { SolutionBundle, type SolutionArticle } from "./solution-content";

type DraftArticle = Omit<SolutionArticle, "id"> & { id?: string };
export type SolutionDraft = { body: string; solutions?: DraftArticle[] };

const maxSolutions = 10;
const maxTitleLength = 120;
const maxBodyLength = 200_000;

export function sameSolutionDraft(a: SolutionDraft, b: SolutionDraft) {
  if (a.body !== b.body || a.solutions?.length !== b.solutions?.length) return false;
  return a.solutions?.every((item, index) => {
    const other = b.solutions?.[index];
    return item.id === other?.id && item.title === other?.title && item.body === other?.body;
  }) ?? true;
}

export function solutionDraftError(draft: SolutionDraft) {
  if (!draft.body.trim() || draft.solutions?.some(item => !item.title.trim() || !item.body.trim())) return "required";
  if (draft.solutions) {
    const [primary, ...other] = draft.solutions;
    if (!primary) return "required";
    const alternatives = other.map(({ id, title, body }) => ({
      id: id ?? "00000000-0000-0000-0000-000000000000",
      title: title.trim(),
      body,
    }));
    const canonical = { body: draft.body, details: { primaryTitle: primary.title.trim(), alternatives } };
    if (new TextEncoder().encode(JSON.stringify(canonical)).length > 512 * 1024) return "size";
  }
  return null;
}

export function SolutionDraftPreview({ draft }: { draft: SolutionDraft }) {
  return <SolutionBundle body={draft.body} solutions={draft.solutions?.map((item, index) => ({
    ...item,
    id: item.id ?? `draft-${index}`,
  }))} />;
}

export function useSolutionDraftNavigation(block: boolean) {
  useNavigationBlocker(block);
  useEffect(() => {
    if (!block) return;
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [block]);
}

export function SolutionDiscardDialog({ onCancel, onDiscard, reload = false }: {
  onCancel: () => void;
  onDiscard: () => void;
  reload?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  return <Modal title={tx("放弃未保存的修改？", "Discard unsaved changes?")} onClose={onCancel}>
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>{tx("继续编辑", "Keep editing")}</Button>
      <Button type="button" variant="danger" onClick={onDiscard}>{reload ? tx("放弃并重新载入", "Discard and reload") : tx("放弃修改", "Discard changes")}</Button>
    </div>
  </Modal>;
}

export function SolutionAlternativesEditor({ value, onChange, disabled, lockPrimaryBody }: {
  value: SolutionDraft;
  onChange: (value: SolutionDraft) => void;
  disabled: boolean;
  lockPrimaryBody?: boolean;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const id = useId();
  const [requested, setRequested] = useState(0);
  const [removing, setRemoving] = useState(false);
  const titleField = useRef<HTMLInputElement>(null);
  const firstSolution = useRef<HTMLButtonElement>(null);
  const focusTitle = useRef(false);
  const items = value.solutions?.length ? value.solutions : [{ title: tx("主要解法", "Main approach"), body: value.body }];
  const active = Math.min(requested, items.length - 1);
  const current = items[active];
  const error = solutionDraftError(value);
  const validate = Boolean(value.solutions || value.body);

  useEffect(() => {
    if (!focusTitle.current) return;
    focusTitle.current = false;
    titleField.current?.focus();
  }, [active]);

  const update = (solutions: DraftArticle[]) => onChange({ body: solutions[0].body, solutions });
  const edit = (patch: Partial<DraftArticle>) => update(items.map((item, index) => index === active ? { ...item, ...patch } : item));
  function move(offset: -1 | 1) {
    const solutions = [...items];
    const next = active + offset;
    [solutions[active], solutions[next]] = [solutions[next], solutions[active]];
    setRequested(next);
    update(solutions);
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{tx("解法与阅读顺序", "Solutions and reading order")}</h3>
      <Button type="button" size="sm" variant="secondary" disabled={disabled || items.length >= maxSolutions} onClick={() => {
        focusTitle.current = true;
        setRequested(items.length);
        update([...items, { title: "", body: "" }]);
      }}><Plus size={14} aria-hidden="true" />{tx("添加解法", "Add solution")}</Button>
    </div>
    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)]">
      <ol className="min-w-0 space-y-1 self-start rounded-md border border-border p-1" aria-label={tx("解法列表", "Solution list")}>
        {items.map((item, index) => <li key={index}>
          <Button type="button" ref={index === 0 ? firstSolution : undefined} variant={index === active ? "secondary" : "ghost"} aria-pressed={index === active}
            disabled={disabled} className="h-auto min-h-8 w-full min-w-0 justify-start gap-2 whitespace-normal px-2 py-1.5 text-left text-xs"
            onClick={() => setRequested(index)}>
            <span aria-hidden="true" className="shrink-0 tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{item.title.trim() || tx("未命名解法", "Untitled solution")}</span>
          </Button>
        </li>)}
      </ol>
      <div className="min-w-0 space-y-3">
        <label className="block space-y-1.5 text-sm font-semibold">
          <span>{tx("解法标题", "Solution title")}</span>
          <input ref={titleField} className={`${input} font-normal`} value={current.title} maxLength={maxTitleLength}
            required disabled={disabled} aria-invalid={validate && !current.title.trim()} aria-describedby={validate && error ? id : undefined}
            onChange={event => edit({ title: event.target.value })} />
        </label>
        <label className="block space-y-1.5 text-sm font-semibold">
          <span>{tx("解法正文（Markdown，可包含代码块）", "Solution body (Markdown with code blocks)")}</span>
          <textarea className={`${area} block min-h-56 max-h-[55dvh] resize-none field-sizing-content font-mono font-normal`}
            rows={10} value={current.body} maxLength={maxBodyLength} disabled={disabled} readOnly={active === 0 && lockPrimaryBody}
            required aria-invalid={validate && !current.body.trim()} aria-describedby={validate && error ? id : undefined}
            onChange={event => edit({ body: event.target.value })} />
        </label>
        {active === 0 && lockPrimaryBody && <p className="text-xs text-muted-foreground">{tx("主要解法的正文已发布。可更新标题或补充其他解法。", "The main solution body is published. You can edit its title or add other approaches.")}</p>}
        {active > 0 && <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={disabled || active === 1} onClick={() => move(-1)}><ArrowUp size={14} aria-hidden="true" />{tx("上移", "Move up")}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || active === items.length - 1} onClick={() => move(1)}><ArrowDown size={14} aria-hidden="true" />{tx("下移", "Move down")}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setRemoving(true)}>{tx("移除解法", "Remove solution")}</Button>
        </div>}
      </div>
    </div>
    {validate && error && <p id={id} className="text-xs text-destructive" role="status">{error === "required"
      ? tx("请为每种解法填写标题和正文。", "Enter a title and body for each solution.")
      : tx("整组题解过长，请缩短正文后保存。", "This solution set is too long. Shorten the text before saving.")}</p>}
    {removing && <Modal title={tx("移除此解法？", "Remove this solution?")} onClose={() => setRemoving(false)}>
      <p className="break-words text-sm text-muted-foreground">{current.title.trim() || tx("未命名解法", "Untitled solution")}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setRemoving(false)}>{tx("取消", "Cancel")}</Button>
        <Button type="button" variant="danger" onClick={() => {
          setRemoving(false);
          setRequested(0);
          update(items.filter((_, index) => index !== active));
          requestAnimationFrame(() => firstSolution.current?.focus());
        }}>{tx("移除解法", "Remove solution")}</Button>
      </div>
    </Modal>}
  </div>;
}
