"use client";

import { useId, useState } from "react";
import { Loading, useData } from "@/components/admin/common";
import { useLocale } from "@/components/locale-context";
import { Button } from "@/components/ui/button";
import { ApiError, apiMessage, productionApi } from "@/lib/production-api";

type SolutionPrice = {
  price: number | null;
  defaultPrice: number;
  effectivePrice: number;
  revision: number;
};

export function AcslSolutionPrice({ schoolId, paperId }: { schoolId: string; paperId: string }) {
  const path = `schools/${schoolId}/acsl/manage/${encodeURIComponent(paperId)}/solution-price`;
  const resource = useData<SolutionPrice>(path);
  return (
    <Loading resource={resource}>
      {resource.data && <PriceForm key={`${path}:${resource.data.revision}`} path={path} initial={resource.data} reload={resource.reload} />}
    </Loading>
  );
}

function PriceForm({ path, initial, reload }: { path: string; initial: SolutionPrice; reload: () => void }) {
  const { locale } = useLocale();
  const tx = (en: string, zh: string) => locale === "en" ? en : zh;
  const inputId = useId();
  const [policy, setPolicy] = useState(initial);
  const [value, setValue] = useState(initial.price === null ? "" : String(initial.price));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const price = value === "" ? null : Number(value);
  const dirty = price !== policy.price;

  async function save() {
    if (busy || !dirty) return;
    setError("");
    setSaved(false);
    setConflict(false);
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 1000)) {
      setError(tx("Enter a whole number from 0 to 1000, or leave blank for the default.", "请输入 0–1000 的整数，或留空使用默认金额。"));
      return;
    }
    setBusy(true);
    try {
      const updated = await productionApi<SolutionPrice>(path, {
        method: "PATCH",
        body: { price, expectedRevision: policy.revision },
      });
      setPolicy(updated);
      setValue(updated.price === null ? "" : String(updated.price));
      setSaved(true);
    } catch (cause) {
      setError(apiMessage(cause));
      setConflict(cause instanceof ApiError && cause.status === 409);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-6" data-od-id="acsl-solution-price">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{tx("Solution unlock cost", "参考实现与解析的查看金额")}</h3>
        <p className="text-sm text-muted-foreground" data-od-id="acsl-solution-current-price">
          {tx(`Current: ${policy.effectivePrice} scholarship`, `当前：${policy.effectivePrice} 奖学金`)}
        </p>
      </div>
      <p id={`${inputId}-help`} className="text-sm text-muted-foreground">
        {tx(`ACSL defaults to ${policy.defaultPrice} scholarship. Leave blank to use the default; set 0 for free access.`, `ACSL 默认 ${policy.defaultPrice} 奖学金。留空使用默认金额，设为 0 可免费查看。`)}
      </p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor={inputId} className="min-w-0 basis-full space-y-1 text-sm font-medium sm:flex-1 sm:basis-0">
          <span>{tx("Cost (scholarship)", "查看金额（奖学金）")}</span>
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            step={1}
            value={value}
            placeholder={String(policy.defaultPrice)}
            disabled={busy}
            aria-describedby={`${inputId}-help`}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            onChange={event => { setValue(event.target.value); setSaved(false); }}
            data-od-id="acsl-solution-price-input"
          />
        </label>
        <Button type="button" variant="secondary" disabled={busy || value === ""} onClick={() => { setValue(""); setSaved(false); }}>
          {tx("Use default", "使用默认金额")}
        </Button>
        <Button type="submit" disabled={busy || !dirty} data-od-id="acsl-solution-price-save">
          {busy ? tx("Saving…", "正在保存…") : tx("Save cost", "保存金额")}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        {tx("Applies to this problem for all students in this school. Paid translation costs are credited toward the solution. Existing purchases are not charged again; students who pass a formal submission can view it free.", "对本校所有学生的这道编程题生效。已付翻译费用可抵扣，已购买的学生不再补扣；正式提交通过后可免费查看。")}
      </p>
      {error && <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">{error}</p>
        {conflict && <Button type="button" variant="secondary" size="sm" onClick={reload}>{tx("Load latest cost", "加载最新金额")}</Button>}
      </div>}
      {saved && <p role="status" className="text-sm text-success">{tx("Cost saved.", "查看金额已保存。")}</p>}
    </section>
  );
}
