"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { apiMessage, productionApi } from "@/lib/production-api";
import { paper4ShortTitle, type Paper4Paper } from "./model";

export function Paper4ShortTitleEditor({ paper, disabled, onSaved }: { paper: Paper4Paper; disabled: boolean; onSaved: () => void }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [value, setValue] = useState(paper.shortTitle ?? ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { setValue(paper.shortTitle ?? ""); }, [paper.id, paper.shortTitle]);
  async function save() {
    setBusy(true); setError("");
    try { const updated = await productionApi<Paper4Paper>(`paper4/papers/${encodeURIComponent(paper.id)}/metadata`, { method: "PATCH", body: { shortTitle: value.trim() } }); setValue(updated.shortTitle ?? ""); onSaved(); }
    catch (reason) { setError(apiMessage(reason)); } finally { setBusy(false); }
  }
  return <section className="mt-4 rounded-lg border border-border bg-surface p-4 panel-shadow" aria-label={tx("试卷显示名称", "Paper display name")}>
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm font-semibold">{tx("导航短标题", "Navigation short title")}<input maxLength={60} value={value} disabled={disabled || busy} placeholder={paper4ShortTitle({ ...paper, shortTitle: "" })} className="mt-1.5 min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60" onChange={event => setValue(event.target.value)}/></label><Button variant="secondary" disabled={disabled || busy || value === (paper.shortTitle ?? "")} onClick={() => void save()}><Save size={15} aria-hidden="true"/>{busy ? tx("保存中…", "Saving…") : tx("保存短标题", "Save short title")}</Button></div>
    <p className="mt-2 text-xs text-muted-foreground">{disabled ? tx("请先保存正文修改，或恢复已归档的试卷。", "Save content edits first, or restore the archived paper.") : tx("用于答题页顶部，最多 60 字；清空可恢复自动名称，修改不会建立试卷修订。", "Used in the workspace header, up to 60 characters. Clear it to restore the automatic name; this does not create a paper revision.")}</p>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </section>;
}
