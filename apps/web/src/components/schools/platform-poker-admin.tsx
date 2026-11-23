"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Save, Spade } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatChips,
  type PokerSettings,
  type PokerTableSummary,
} from "@/components/poker/poker-types";
import { apiMessage, productionApi } from "@/lib/production-api";
import { useSchoolText } from "./school-ui";

interface PlatformPokerResponse {
  settings: PokerSettings;
  tables: PokerTableSummary[];
  stats: {
    activePlayers: number;
    todayHands: number;
    todayBuyInCents: number;
  };
}

interface TableFormState {
  id?: string;
  name: string;
  useDefaultBlinds: boolean;
  smallBlindScholarship: string;
  bigBlindScholarship: string;
  maxSeats: string;
  enabled: boolean;
}

const inputCls =
  "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-primary";

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2);
}

function inputToCents(raw: string): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return -1;
  return Math.round(num * 100);
}

export function PlatformPokerAdmin() {
  const text = useSchoolText();

  const [data, setData] = useState<PlatformPokerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Settings form state
  const [enabled, setEnabled] = useState(false);
  const [initialUnlockAc, setInitialUnlockAc] = useState("32");
  const [acPerBatch, setAcPerBatch] = useState("5");
  const [buyinsPerBatch, setBuyinsPerBatch] = useState("3");
  const [defaultSb, setDefaultSb] = useState("0.10");
  const [defaultBb, setDefaultBb] = useState("0.20");
  const [minBuyInBb, setMinBuyInBb] = useState("20");
  const [maxBuyInBb, setMaxBuyInBb] = useState("100");
  const [timeoutSec, setTimeoutSec] = useState("25");
  const [dailyBuyIn, setDailyBuyIn] = useState("50.00");
  const [dailyLoss, setDailyLoss] = useState("20.00");
  const [dailyWin, setDailyWin] = useState("20.00");

  // Table dialog state
  const [tableForm, setTableForm] = useState<TableFormState | null>(null);

  const syncSettingsToForm = useCallback((s: PokerSettings) => {
    setEnabled(s.enabled);
    setInitialUnlockAc(String(s.initialUnlockAcProblems));
    setAcPerBatch(String(s.acPerBuyinBatch));
    setBuyinsPerBatch(String(s.buyinsPerBatch));
    setDefaultSb(centsToInput(s.defaultSmallBlindCents));
    setDefaultBb(centsToInput(s.defaultBigBlindCents));
    setMinBuyInBb(String(s.minBuyInBb));
    setMaxBuyInBb(String(s.maxBuyInBb));
    setTimeoutSec(String(s.turnTimeoutSeconds));
    setDailyBuyIn(centsToInput(s.dailyBuyInLimitCents));
    setDailyLoss(centsToInput(s.dailyNetLossLimitCents));
    setDailyWin(centsToInput(s.dailyNetWinLimitCents));
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await productionApi<PlatformPokerResponse>("platform/poker");
      setData(next);
      syncSettingsToForm(next.settings);
      setError("");
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setLoading(false);
    }
  }, [syncSettingsToForm]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    const sbCents = inputToCents(defaultSb);
    const bbCents = inputToCents(defaultBb);
    const dailyBuyInCents = inputToCents(dailyBuyIn);
    const dailyLossCents = inputToCents(dailyLoss);
    const dailyWinCents = inputToCents(dailyWin);

    if (sbCents < 1 || bbCents < sbCents * 2) {
      setError(text("Big blind must be at least 2× small blind (min 0.01 / 0.02).", "默认大盲必须至少为小盲的 2 倍（最小 0.01 / 0.02）。"));
      return;
    }
    if (dailyBuyInCents < 0 || dailyLossCents < 0 || dailyWinCents < 0) {
      setError(text("Daily risk caps must be non-negative numbers (0 for unlimited).", "每日风控上限须为非负数（0 表示不限）。"));
      return;
    }

    setSaving(true);
    try {
      await productionApi("platform/poker/settings", {
        method: "PATCH",
        body: {
          enabled,
          initialUnlockAcProblems: Number(initialUnlockAc),
          acPerBuyinBatch: Number(acPerBatch),
          buyinsPerBatch: Number(buyinsPerBatch),
          defaultSmallBlindCents: sbCents,
          defaultBigBlindCents: bbCents,
          minBuyInBb: Number(minBuyInBb),
          maxBuyInBb: Number(maxBuyInBb),
          turnTimeoutSeconds: Number(timeoutSec),
          dailyBuyInLimitCents: dailyBuyInCents,
          dailyNetLossLimitCents: dailyLossCents,
          dailyNetWinLimitCents: dailyWinCents,
        },
      });
      await load();
      setMessage(text("Texas Hold'em settings saved.", "德州扑克全局配置已保存。"));
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveTable(event: React.FormEvent) {
    event.preventDefault();
    if (!tableForm) return;
    setError("");
    setMessage("");

    const sbCents = inputToCents(tableForm.smallBlindScholarship);
    const bbCents = inputToCents(tableForm.bigBlindScholarship);
    if (!tableForm.useDefaultBlinds && (sbCents < 1 || bbCents < sbCents * 2)) {
      setError(text("Big blind must be at least 2× small blind.", "大盲金额至少为小盲金额的 2 倍。"));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: tableForm.name.trim(),
        useDefaultBlinds: tableForm.useDefaultBlinds,
        ...(tableForm.useDefaultBlinds ? {} : { smallBlindCents: sbCents, bigBlindCents: bbCents }),
        maxSeats: Number(tableForm.maxSeats),
        enabled: tableForm.enabled,
      };
      if (tableForm.id) {
        await productionApi(`platform/poker/tables/${tableForm.id}`, {
          method: "PATCH",
          body: payload,
        });
        setMessage(text("Poker table updated.", "牌桌配置已更新。"));
      } else {
        await productionApi("platform/poker/tables", {
          method: "POST",
          body: payload,
        });
        setMessage(text("Poker table created.", "公共牌桌已创建。"));
      }
      setTableForm(null);
      await load();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <p role="status" className="rounded-lg border border-border bg-surface p-6 text-sm text-muted-foreground">
        {text("Loading Texas Hold'em administration…", "正在加载德州扑克管理配置…")}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Spade size={18} className="text-primary" />
            {text("Open Platform Texas Hold'em", "开放平台德州扑克管理")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {text(
              "Disabled by default. Configure AC unlock milestones, buy-in allowances, SB/BB amounts, daily risk caps, and public tables.",
              "默认不对任何用户开放。可在此控制总开关、初次解锁 AC 门槛、每批买入机会、SB/BB 盲注、每日风控上限与公共牌桌。",
            )}
          </p>
        </div>
        <Button size="sm" variant="secondary" disabled={saving} onClick={() => void load()}>
          <RefreshCw size={14} /> {text("Refresh", "刷新")}
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">
          {message}
        </div>
      )}

      {/* Live Stats */}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface p-3.5">
            <p className="text-xs text-muted-foreground">{text("Current status", "当前开放状态")}</p>
            <p className="mt-1 text-base font-semibold">
              {data.settings.enabled
                ? text("Enabled (AC-gated)", "已开放（按 AC 门槛解锁）")
                : text("Closed (default)", "已关闭（默认不对任何人开放）")}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3.5">
            <p className="text-xs text-muted-foreground">{text("Players seated now", "当前在桌人数")}</p>
            <p className="mt-1 text-base font-semibold tabular-nums">{data.stats.activePlayers}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3.5">
            <p className="text-xs text-muted-foreground">{text("Today hands / buy-in", "今日对局数 / 总买入")}</p>
            <p className="mt-1 text-base font-semibold tabular-nums">
              {data.stats.todayHands} · {formatChips(data.stats.todayBuyInCents)} {text("sch.", "奖学金")}
            </p>
          </div>
        </div>
      )}

      {/* Global Settings Form */}
      <form onSubmit={saveSettings} className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-semibold">{text("Global Rules & Unlock Milestones", "全局规则与解锁门槛")}</h3>
            <p className="text-xs text-muted-foreground">
              {text(
                "Changes to default SB/BB immediately sync to waiting tables set to follow default blinds.",
                "修改默认 SB/BB 后，跟随默认盲注的牌桌将在空闲或下一局自动生效。",
              )}
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm font-medium">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="size-4 accent-primary"
            />
            {enabled ? text("Open Platform Poker: ON", "开放平台德州扑克：已开启") : text("Open Platform Poker: OFF", "开放平台德州扑克：已关闭")}
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Initial unlock distinct ACs", "初次解锁所需全站去重 AC 题数")}</span>
            <input type="number" min={0} max={100000} value={initialUnlockAc} onChange={e => setInitialUnlockAc(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Additional ACs per buy-in batch", "之后每新增 AC 题数解锁一批")}</span>
            <input type="number" min={1} max={10000} value={acPerBatch} onChange={e => setAcPerBatch(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Buy-in chances per milestone", "每次里程碑解锁买入次数")}</span>
            <input type="number" min={1} max={100} value={buyinsPerBatch} onChange={e => setBuyinsPerBatch(e.target.value)} className={inputCls} />
          </label>

          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Default SB (scholarship)", "默认小盲 SB（奖学金）")}</span>
            <input type="number" step="0.01" min="0.01" value={defaultSb} onChange={e => setDefaultSb(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Default BB (scholarship)", "默认大盲 BB（奖学金）")}</span>
            <input type="number" step="0.01" min="0.02" value={defaultBb} onChange={e => setDefaultBb(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Turn timeout (seconds)", "单次行动超时（秒）")}</span>
            <input type="number" min={10} max={120} value={timeoutSec} onChange={e => setTimeoutSec(e.target.value)} className={inputCls} />
          </label>

          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Min buy-in (BB)", "最小买入（BB 倍数）")}</span>
            <input type="number" min={10} max={500} value={minBuyInBb} onChange={e => setMinBuyInBb(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Max buy-in (BB)", "最大买入（BB 倍数）")}</span>
            <input type="number" min={20} max={1000} value={maxBuyInBb} onChange={e => setMaxBuyInBb(e.target.value)} className={inputCls} />
          </label>
          <div className="hidden lg:block" />

          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Daily buy-in cap (0 = none)", "每日总买入上限（奖学金，0 不限）")}</span>
            <input type="number" step="0.1" min="0" value={dailyBuyIn} onChange={e => setDailyBuyIn(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Daily net loss cap (0 = none)", "每日净输上限（奖学金，0 不限）")}</span>
            <input type="number" step="0.1" min="0" value={dailyLoss} onChange={e => setDailyLoss(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium">{text("Daily net win cap (0 = none)", "每日净赢上限（奖学金，0 不限）")}</span>
            <input type="number" step="0.1" min="0" value={dailyWin} onChange={e => setDailyWin(e.target.value)} className={inputCls} />
          </label>
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={saving}>
            <Save size={14} /> {text("Save settings", "保存配置")}
          </Button>
        </div>
      </form>

      {/* Public Tables Management */}
      <section className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">{text("Public Poker Tables", "公共牌桌管理")}</h3>
            <p className="text-xs text-muted-foreground">
              {text("Manage public 2–6 player tables and their blind tiers.", "管理开放平台公共桌台（2–6 人桌）与盲注档位。")}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() =>
              setTableForm({
                name: text("Public Table", "公开桌"),
                useDefaultBlinds: true,
                smallBlindScholarship: defaultSb,
                bigBlindScholarship: defaultBb,
                maxSeats: "6",
                enabled: true,
              })
            }
          >
            <Plus size={14} /> {text("Add table", "新增牌桌")}
          </Button>
        </div>

        {data?.tables.length ? (
          <ul className="divide-y divide-border">
            {data.tables.map(table => (
              <li key={table.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{table.name}</span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      SB/BB {formatChips(table.smallBlindCents)} / {formatChips(table.bigBlindCents)}
                    </span>
                    {table.useDefaultBlinds && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {text("Follows default", "跟随默认盲注")}
                      </span>
                    )}
                    {!table.enabled && (
                      <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
                        {text("Disabled", "已关闭")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {text("Seats", "人数")}: {table.seatedCount}/{table.maxSeats} · {text("Hands", "累计局数")}: {table.handNumber} · {text("Status", "状态")}: {table.status}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setTableForm({
                      id: table.id,
                      name: table.name,
                      useDefaultBlinds: table.useDefaultBlinds,
                      smallBlindScholarship: centsToInput(table.smallBlindCents),
                      bigBlindScholarship: centsToInput(table.bigBlindCents),
                      maxSeats: String(table.maxSeats),
                      enabled: table.enabled,
                    })
                  }
                >
                  <Pencil size={13} /> {text("Edit", "编辑")}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {text("No tables configured.", "暂无公共牌桌。")}
          </p>
        )}
      </section>

      {/* Create / Edit Table Dialog */}
      <Dialog open={tableForm !== null} onOpenChange={open => { if (!open) setTableForm(null); }}>
        <DialogContent>
          <DialogTitle>
            {tableForm?.id ? text("Edit poker table", "编辑公共牌桌") : text("Create poker table", "新增公共牌桌")}
          </DialogTitle>
          <DialogDescription>
            {text("Configure blind level, seat capacity (2–6), and availability.", "配置牌桌名称、盲注、座位数（2–6）与启用状态。")}
          </DialogDescription>
          {tableForm && (
            <form onSubmit={saveTable} className="space-y-3 text-sm">
              <label className="block space-y-1 text-xs">
                <span className="font-medium">{text("Table name", "牌桌名称")}</span>
                <input
                  required
                  maxLength={80}
                  value={tableForm.name}
                  onChange={e => setTableForm({ ...tableForm, name: e.target.value })}
                  className={inputCls}
                />
              </label>

              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={tableForm.useDefaultBlinds}
                  onChange={e => setTableForm({ ...tableForm, useDefaultBlinds: e.target.checked })}
                  className="size-4 accent-primary"
                />
                {text("Follow global default SB/BB", "跟随全局默认 SB/BB 盲注")}
              </label>

              {!tableForm.useDefaultBlinds && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs">
                    <span className="font-medium">{text("SB (scholarship)", "小盲 SB（奖学金）")}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={tableForm.smallBlindScholarship}
                      onChange={e => setTableForm({ ...tableForm, smallBlindScholarship: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                  <label className="space-y-1 text-xs">
                    <span className="font-medium">{text("BB (scholarship)", "大盲 BB（奖学金）")}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.02"
                      value={tableForm.bigBlindScholarship}
                      onChange={e => setTableForm({ ...tableForm, bigBlindScholarship: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-xs">
                  <span className="font-medium">{text("Max seats (2–6)", "最大座位数（2–6）")}</span>
                  <input
                    type="number"
                    min={2}
                    max={6}
                    value={tableForm.maxSeats}
                    onChange={e => setTableForm({ ...tableForm, maxSeats: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="flex items-end gap-2 pb-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={tableForm.enabled}
                    onChange={e => setTableForm({ ...tableForm, enabled: e.target.checked })}
                    className="size-4 accent-primary"
                  />
                  {text("Enabled", "启用牌桌")}
                </label>
              </div>

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setTableForm(null)}>
                  {text("Cancel", "取消")}
                </Button>
                <Button type="submit" disabled={saving}>
                  {text("Save table", "保存牌桌")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
