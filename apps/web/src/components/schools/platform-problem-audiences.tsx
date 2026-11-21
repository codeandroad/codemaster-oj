"use client";

import { useState } from "react";
import { Feedback, Loading, inputClass, useData, useMutation } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

type Target = { kind: "school" | "account"; id: string; name: string; handle: string; active: boolean; count?: number };
const targetKey = (target: Target) => `${target.kind}:${target.id}`;
const endpoint = "platform/problem-audiences";

export function PlatformProblemAudiences({ problemIds, onClose }: { problemIds: string[]; onClose: () => void }) {
  const text = useSchoolText(), action = useMutation();
  const [kind, setKind] = useState<Target["kind"]>("school");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Target[]>([]);
  const [revoking, setRevoking] = useState<Target | null>(null);
  const current = useData<{ items: Target[] }>(`${endpoint}?${new URLSearchParams({ problemIds: problemIds.join(",") })}`);
  const search = query.trim();
  const candidates = useData<{ items: Target[] }>(kind === "school" || search.length >= 2
    ? `platform/problem-audience-targets?${new URLSearchParams({ kind, q: search })}` : null);
  const currentByKey = new Map(current.data?.items.map(target => [targetKey(target), target]));
  const kindLabel = (value: Target["kind"]) => value === "school" ? text("School", "学校") : text("Account", "用户");
  function toggle(target: Target) {
    setSelected(previous => previous.some(item => targetKey(item) === targetKey(target))
      ? previous.filter(item => targetKey(item) !== targetKey(target)) : [...previous, target]);
  }
  function save(operation: "grant" | "revoke", targets: Target[]) {
    void action.run(async () => {
      await productionApi(endpoint, { method: "POST", body: {
        operation, problemIds, targets: targets.map(({ kind, id }) => ({ kind, id })),
      } });
      setRevoking(null);
      if (operation === "grant") setSelected([]);
      current.reload();
      action.success(text("Practice access updated.", "练习开放范围已更新。"));
    });
  }
  return <Dialog open onOpenChange={open => { if (!open && !action.busy) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
      <DialogTitle>{text("Manage practice access", "管理开放范围")}</DialogTitle>
      <DialogDescription>{text(
        `Open ${problemIds.length} selected problems for individual accounts or current and future students at selected schools.`,
        `为所选 ${problemIds.length} 道题开放练习资格。选择学校后，该校现有及新加入的学生均可练习。`,
      )}</DialogDescription>
      <div aria-live="polite"><Feedback action={action}/></div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{text("Current audiences", "当前开放对象")}</h3>
        <Loading resource={{ ...current, loading: current.pending }}>
          <ul className="max-h-48 divide-y divide-border overflow-y-auto">
            {current.data?.items.map(target => <li key={targetKey(target)} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0 break-words">
                <div>{target.name} · {target.handle}</div>
                <div className="text-xs text-muted-foreground">{kindLabel(target.kind)} · {target.count}/{problemIds.length}{!target.active && text(" · Inactive", " · 已失效")}</div>
              </div>
              <Button type="button" size="sm" variant="ghost" disabled={action.busy} onClick={() => setRevoking(target)}>{text("Revoke", "撤销开放")}</Button>
            </li>)}
          </ul>
          {!current.data?.items.length && <p className="text-sm text-muted-foreground">{text("No schools or accounts selected yet.", "尚未向指定学校或用户开放。")}</p>}
        </Loading>
        {revoking && <div className="flex flex-wrap items-center gap-2 rounded border border-border p-3 text-sm">
          <p className="basis-full">{text(`Revoke access for ${revoking.name} on the selected problems?`, `确认撤销「${revoking.name}」对所选题目的练习资格？`)}</p>
          <Button type="button" size="sm" variant="secondary" disabled={action.busy} onClick={() => setRevoking(null)}>{text("Cancel", "取消")}</Button>
          <Button type="button" size="sm" disabled={action.busy} onClick={() => save("revoke", [revoking])}>{text("Confirm revocation", "确认撤销")}</Button>
        </div>}
      </section>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!action.busy && selected.length) save("grant", selected); }}>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{text("Add audiences", "添加开放对象")}</legend>
          <div className="flex gap-4">
            {(["school", "account"] as const).map(value => <label key={value} className="inline-flex min-h-10 items-center gap-2 text-sm">
              <input type="radio" className="accent-primary" name="audience-kind" value={value} checked={kind === value}
                onChange={() => { setKind(value); setQuery(""); }}/>
              {kindLabel(value)}
            </label>)}
          </div>
          <search>
            <label className="grid gap-1 text-sm">
              {kind === "school" ? text("Search school name", "搜索学校名称") : text("Search name or username (at least 2 characters)", "搜索姓名或用户名（至少 2 个字符）")}
              <input type="search" name="audience-query" className={inputClass} value={query} maxLength={100}
                onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
                onChange={event => setQuery(event.target.value)}/>
            </label>
          </search>
          {(kind === "school" || search.length >= 2) && <Loading resource={{ ...candidates, loading: candidates.pending }}>
            <div className="max-h-48 overflow-y-auto">
              {candidates.data?.items.map(target => {
                const key = targetKey(target);
                const alreadyGranted = currentByKey.get(key)?.count === problemIds.length;
                const checked = selected.some(item => targetKey(item) === key);
                return <label key={key} className="flex min-h-11 items-center gap-2 border-b border-border p-2 text-sm">
                  <input type="checkbox" className="accent-primary" name="audience-target" value={key} checked={checked || alreadyGranted}
                    disabled={alreadyGranted || (!checked && selected.length >= 50) || action.busy} onChange={() => toggle(target)}/>
                  <span className="break-words">{target.name} · {target.handle}{alreadyGranted && text(" · Open", " · 已开放")}</span>
                </label>;
              })}
              {!candidates.data?.items.length && <p className="text-sm text-muted-foreground">{text("No matches.", "没有匹配的开放对象。")}</p>}
            </div>
          </Loading>}
        </fieldset>
        {selected.length > 0 && <ul className="flex flex-wrap gap-2" aria-label={text("Selected audiences", "已选开放对象")}>
          {selected.map(target => <li key={targetKey(target)}><Button type="button" size="sm" variant="secondary" disabled={action.busy}
            aria-label={text(`Remove ${target.name}`, `取消选择 ${target.name}`)} onClick={() => toggle(target)}>{target.name} ×</Button></li>)}
        </ul>}
        <Button type="submit" disabled={action.busy || current.pending || !!current.error || !selected.length}>{text("Confirm access", "确认开放")}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
