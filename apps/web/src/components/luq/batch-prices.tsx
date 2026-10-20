"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { Feedback, Field, input, panel, useAction } from "@/components/teacher/shared";
import { productionApi } from "@/lib/production-api";
import type { AssistanceKind } from "./assistance";

type PublicationStatus = {
  kind: AssistanceKind;
  total: number;
  published: number;
  draft: number;
  withdrawn: number;
  missing: number;
  firstUnpublished: { targetId: string; questionKey?: string } | null;
};

export function LuqBatchPrices({ targetType, choices, initialIds = [], onSaved }: {
  targetType: "problem" | "paper4";
  choices: { id: string; title: string }[];
  initialIds?: string[];
  onSaved?: () => void;
}) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [selected, setSelected] = useState(initialIds), [query, setQuery] = useState("");
  const [translation, setTranslation] = useState(true), [solution, setSolution] = useState(true);
  const [translationPrice, setTranslationPrice] = useState(""), [solutionPrice, setSolutionPrice] = useState("");
  const [publication, setPublication] = useState<PublicationStatus[] | null>(null);
  const action = useAction(), pending = useRef<{ signature: string; requestId: string } | null>(null);
  const filtered = choices.filter(item => item.title.toLowerCase().includes(query.toLowerCase()));
  const selectedIds = choices.filter(item => selected.includes(item.id)).map(item => item.id).sort();
  const allVisible = filtered.length > 0 && filtered.every(item => selected.includes(item.id));
  return <section className={`${panel} space-y-3 p-3`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">{tx("批量设置解锁价格", "Batch unlock prices")}</h2>
      <span className="text-xs text-muted-foreground">{tx(`已选 ${selectedIds.length} 项`, `${selectedIds.length} selected`)}</span>
    </div>
    <p className="text-xs text-muted-foreground">{targetType === "paper4"
      ? tx("每道大题分别按所设价格解锁。批量定价保留现有开放方式和时间，已购买权益继续有效。", "Each question uses the selected price. Existing access rules, opening times and purchased entitlements are retained.")
      : tx("批量定价保留现有开放方式和时间，已购买权益继续有效。", "Existing access rules, opening times and purchased entitlements are retained.")}</p>
    <p className="text-xs text-muted-foreground">{tx("设置价格不会发布内容；对应题目版本的译文或题解须先录入、审核并发布，学生才能解锁。", "Setting a price does not publish content. Author, review and publish the translation or solution for the matching problem version before students can unlock it.")}</p>
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label={tx("搜索批量配置对象", "Search batch targets")} placeholder={tx("搜索名称、年份或考季", "Search title, year or session")} className={`${input} max-w-sm`} value={query} onChange={e => setQuery(e.target.value)}/>
      <Button size="sm" variant="secondary" disabled={!filtered.length || action.busy} onClick={() => setSelected(current => allVisible ? current.filter(id => !filtered.some(item => item.id === id)) : [...new Set([...current, ...filtered.map(item => item.id)])])}>{allVisible ? tx("取消当前筛选", "Deselect filtered") : tx("全选当前筛选", "Select filtered")}</Button>
      <Button size="sm" variant="ghost" disabled={!selected.length || action.busy} onClick={() => setSelected([])}>{tx("清空选择", "Clear selection")}</Button>
    </div>
    <div className="max-h-64 overflow-y-auto rounded-md border border-border">
      {filtered.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-surface-subtle">
        <input type="checkbox" checked={selected.includes(item.id)} disabled={action.busy} onChange={e => setSelected(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/>
        <span className="min-w-0 break-words">{item.title}</span>
      </label>)}
      {!filtered.length && <p className="p-3 text-sm text-muted-foreground">{tx("没有匹配项", "No matching items")}</p>}
    </div>
    <form onSubmit={event => {
      event.preventDefault();
      void action.run(async () => {
        setPublication(null);
        const prices: Partial<Record<AssistanceKind, number | null>> = {};
        if (translation) prices.FULL_TRANSLATION = translationPrice === "" ? null : Number(translationPrice);
        if (solution) prices.FULL_SOLUTION = solutionPrice === "" ? null : Number(solutionPrice);
        const body = { targetType, targetIds: selectedIds, prices }, signature = JSON.stringify(body);
        if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
        const result = await productionApi<{ count: number; publication?: PublicationStatus[] }>("luq/policies/batch-prices", { method: "POST", body: { ...body, requestId: pending.current.requestId } });
        pending.current = null;
        setPublication(result.publication ?? null);
        onSaved?.();
        return tx(`已更新 ${result.count} 项的解锁价格，内容发布状态未改变。`, `Updated unlock prices for ${result.count} items. Content publication status was not changed.`);
      });
    }}>
      <fieldset disabled={action.busy} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={translation} onChange={e => setTranslation(e.target.checked)}/>{tx("设置中文题面价格", "Set translation price")}</label>
          <Field label={tx("翻译 Luq（留空使用全校默认）", "Translation Luq (blank = school default)")}><input className={input} type="number" min={0} max={1000} step={1} disabled={!translation} value={translationPrice} onChange={e => setTranslationPrice(e.target.value)} placeholder={tx("全校默认", "School default")}/></Field>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={solution} onChange={e => setSolution(e.target.checked)}/>{tx("设置完整题解价格", "Set solution price")}</label>
          <Field label={tx("题解 Luq（留空使用全校默认）", "Solution Luq (blank = school default)")}><input className={input} type="number" min={0} max={1000} step={1} disabled={!solution} value={solutionPrice} onChange={e => setSolutionPrice(e.target.value)} placeholder={tx("全校默认", "School default")}/></Field>
        </div>
        <Button type="submit" size="sm" disabled={action.busy || !selectedIds.length || (!translation && !solution)}>{tx(`应用到 ${selectedIds.length} 项`, `Apply to ${selectedIds.length} items`)}</Button>
      </fieldset>
      <p className="mt-2 text-xs text-muted-foreground">{tx("0 Luq 表示免费提供，不产生永久购买权益；禁用和考核限制仍然生效。", "0 Luq provides free access without a permanent purchase. Disabled access and assessment restrictions still apply.")}</p>
      <Feedback action={action}/>
      {publication && <div className="mt-2 space-y-1 text-xs" role="status">
        <p className="text-muted-foreground">{tx("本次保存时的当前版本内容；课程或活动中固定的旧版本需单独审核。", "Current-version content at the time of this save; older versions pinned in courses or activities need their own review.")}</p>
        {publication.map(item => <div key={item.kind} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{item.kind === "FULL_TRANSLATION" ? tx("中文题面", "Chinese translation") : tx("完整题解", "Full solution")} · {tx(`已发布 ${item.published}/${item.total} · 待审核草稿 ${item.draft} · 未录入 ${item.missing}${item.withdrawn ? ` · 已撤回 ${item.withdrawn}` : ""}`, `Published ${item.published}/${item.total} · Draft ${item.draft} · Missing ${item.missing}${item.withdrawn ? ` · Withdrawn ${item.withdrawn}` : ""}`)}</span>
          {item.firstUnpublished && <a className="font-medium text-primary hover:underline" href={`/teacher/luq?${new URLSearchParams({ targetType, targetId: item.firstUnpublished.targetId, kind: item.kind, ...(item.firstUnpublished.questionKey ? { questionKey: item.firstUnpublished.questionKey } : {}) })}`}>{tx("录入并审核内容", "Author and review content")}</a>}
        </div>)}
      </div>}
    </form>
  </section>;
}
