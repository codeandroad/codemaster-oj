"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Coins,
  History,
  Lock,
  RefreshCw,
  ShieldCheck,
  Spade,
  Ticket,
  Users,
} from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiMessage, productionApi } from "@/lib/production-api";
import { PokerTable } from "./poker-table";
import {
  formatChips,
  formatSignedChips,
  notifyScholarshipChanged,
  type PokerLedgerEntry,
  type PokerStatusResponse,
} from "./poker-types";

export function OpenPlatformPoker() {
  const { locale } = useLocale();
  const tx = useCallback((zh: string, en: string) => (locale === "en" ? en : zh), [locale]);

  const [status, setStatus] = useState<PokerStatusResponse | null>(null);
  const [ledger, setLedger] = useState<PokerLedgerEntry[] | null>(null);
  const [activeTab, setActiveTab] = useState<"tables" | "ledger">("tables");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const next = await productionApi<PokerStatusResponse>("practice/poker/status");
      setStatus(next);
      setError("");
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLedger = useCallback(async () => {
    try {
      const res = await productionApi<{ ledger: PokerLedgerEntry[] }>("practice/poker/history");
      setLedger(res.ledger);
    } catch (err) {
      setError(apiMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !selectedTableId) void loadStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [loadStatus, selectedTableId]);

  useEffect(() => {
    if (activeTab === "ledger" && !selectedTableId) {
      void loadLedger();
    }
  }, [activeTab, loadLedger, selectedTableId]);

  async function handleWithdraw() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await productionApi<{ scholarshipCredited: number; pokerBalanceCents: number }>(
        "practice/poker/wallet/withdraw",
        { method: "POST" },
      );
      setNotice(
        tx(
          `已将 ${res.scholarshipCredited} 奖学金兑回至平台钱包，剩余零头 ${formatChips(res.pokerBalanceCents)}。`,
          `Withdrew ${res.scholarshipCredited} scholarship to your platform wallet; ${formatChips(res.pokerBalanceCents)} remains.`,
        ),
      );
      notifyScholarshipChanged();
      await loadStatus();
      if (activeTab === "ledger") await loadLedger();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (selectedTableId) {
    return (
      <PokerTable
        tableId={selectedTableId}
        onBack={() => {
          setSelectedTableId(null);
          void loadStatus();
        }}
      />
    );
  }

  if (loading && !status) {
    return (
      <p role="status" className="rounded-lg border border-border bg-surface p-6 text-sm text-muted-foreground">
        {tx("正在加载德州扑克大厅…", "Loading Texas Hold'em lobby…")}
      </p>
    );
  }

  if (!status) {
    return (
      <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        {error || tx("无法加载德州扑克状态", "Could not load Texas Hold'em status")}
      </div>
    );
  }

  const { allowance, settings, wallet, daily } = status;

  // Locked view: either globally disabled or below initial AC milestone (default 32 ACs)
  if (!status.enabled || !status.unlocked) {
    const progressPct = allowance.initialUnlockAcProblems > 0
      ? Math.min(100, Math.round((allowance.acCount / allowance.initialUnlockAcProblems) * 100))
      : 100;

    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <section className="rounded-xl border border-border bg-surface p-6 shadow-xs">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Lock size={22} />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">
                  {tx("开放平台 · 德州扑克", "Open Platform · Texas Hold'em")}
                </h2>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {!status.enabled ? tx("暂未开放", "Closed") : tx("尚未解锁", "Locked")}
                </span>
              </div>

              {!status.enabled ? (
                <p className="text-sm text-muted-foreground">
                  {tx(
                    "德州扑克功能默认关闭，当前暂未向用户开放。管理员开启后，达到解题门槛即可使用平台奖学金参与公开桌对局。",
                    "Texas Hold'em is closed by default. Once enabled by a platform administrator, learners who reach the AC milestone can join public tables using platform scholarship.",
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {tx(
                    `初次解锁需要全站去重 AC 达到 ${allowance.initialUnlockAcProblems} 题（包含校内练习与开放平台 AC）。解锁后立即获得 ${allowance.buyinsPerBatch} 次买入机会，之后每再 AC ${allowance.acPerBuyinBatch} 道新题再解锁 ${allowance.buyinsPerBatch} 次买入机会。`,
                    `Initial unlock requires ${allowance.initialUnlockAcProblems} distinct AC problems across the site (school + Open Platform). Unlocking grants ${allowance.buyinsPerBatch} buy-in allowances, plus ${allowance.buyinsPerBatch} more for every ${allowance.acPerBuyinBatch} additional AC problems.`,
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Unlock progress bar */}
          <div className="mt-6 space-y-2 rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {tx("全站去重 AC 题目进度", "Site-wide distinct AC progress")}
              </span>
              <span className="font-bold tabular-nums">
                {allowance.acCount} / {allowance.initialUnlockAcProblems}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {allowance.missingForInitialUnlock > 0
                ? tx(
                    `还差 ${allowance.missingForInitialUnlock} 道去重 AC 题目即可达成初次解锁条件。`,
                    `${allowance.missingForInitialUnlock} more distinct AC problem(s) needed for initial unlock.`,
                  )
                : tx(
                    "你已满足初次解题门槛，等待管理员开启德州扑克功能后即可进入大厅。",
                    "You meet the AC requirement; access opens once an administrator enables Texas Hold'em.",
                  )}
            </p>
          </div>

          {/* Rules preview */}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3 text-xs">
              <p className="text-muted-foreground">{tx("默认盲注 (SB / BB)", "Default blinds (SB / BB)")}</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">
                {formatChips(settings.defaultSmallBlindCents)} / {formatChips(settings.defaultBigBlindCents)} {tx("奖学金", "sch.")}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3 text-xs">
              <p className="text-muted-foreground">{tx("买入机会规则", "Buy-in allowance")}</p>
              <p className="mt-1 text-sm font-semibold">
                {tx(`首次 ${allowance.initialUnlockAcProblems} AC，后每 ${allowance.acPerBuyinBatch} AC +${allowance.buyinsPerBatch} 次`,
                  `${allowance.initialUnlockAcProblems} AC first, +${allowance.buyinsPerBatch} per ${allowance.acPerBuyinBatch} AC`)}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3 text-xs">
              <p className="text-muted-foreground">{tx("抽水与买入范围", "Rake & buy-in")}</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">
                0% · {settings.minBuyInBb}–{settings.maxBuyInBb} BB
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <AppLink href="/practice/problems" className={buttonVariants({ variant: "primary", size: "sm" })}>
              {tx("前往题库刷题", "Go solve problems")} <ArrowRight size={14} />
            </AppLink>
            {status.activeTableId && (
              <Button size="sm" variant="secondary" onClick={() => setSelectedTableId(status.activeTableId)}>
                {tx("返回已入座牌桌", "Return to seated table")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void loadStatus()}>
              <RefreshCw size={14} /> {tx("刷新状态", "Refresh")}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  // Unlocked Lobby
  const ledgerKindLabel: Record<PokerLedgerEntry["kind"], [string, string]> = {
    scholarship_deposit: ["平台钱包转入", "Wallet deposit"],
    scholarship_withdraw: ["自动兑回平台钱包", "Wallet cash-out"],
    table_buyin: ["入座买入", "Table buy-in"],
    table_rebuy: ["桌上补码", "Table rebuy"],
    table_cashout: ["离桌筹码结算", "Table cash-out"],
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Spade size={20} className="text-primary" />
            {tx("开放平台 · 德州扑克大厅", "Open Platform · Texas Hold'em Lobby")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {tx(
              "无限注德州扑克（NLHE）· 0% 抽水 · 1 奖学金 = 100 筹码（支持 0.10/0.20 小数盲注，离桌整数自动兑回平台钱包）",
              "No-Limit Hold'em · 0% rake · 1 scholarship = 100 chips (fractional blinds supported; whole scholarships auto-return on leave)",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.activeTableId && (
            <Button size="sm" onClick={() => setSelectedTableId(status.activeTableId)}>
              {tx("回到当前牌桌", "Resume active table")} <ArrowRight size={14} />
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => void loadStatus()}>
            <RefreshCw size={14} /> {tx("刷新", "Refresh")}
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">
          {notice}
        </div>
      )}

      {/* Top Metrics Strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{tx("可用资金", "Available funds")}</span>
            <Coins size={15} className="text-amber-500" />
          </div>
          <p className="mt-1.5 text-xl font-bold tabular-nums">
            {wallet.scholarshipBalance} <span className="text-xs font-normal text-muted-foreground">{tx("奖学金", "sch.")}</span>
          </p>
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {tx("扑克零头：", "Chip remainder: ")}
              <strong className="text-foreground">{formatChips(wallet.pokerBalanceCents)}</strong>
            </span>
            {wallet.pokerBalanceCents >= 100 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleWithdraw()}
                className="font-semibold text-primary hover:underline"
              >
                {tx("兑回整数", "Withdraw")}
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{tx("剩余买入机会", "Buy-in allowances")}</span>
            <Ticket size={15} className="text-primary" />
          </div>
          <p className="mt-1.5 text-xl font-bold tabular-nums">
            {allowance.remainingBuyIns}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              / {allowance.totalUnlockedBuyIns} {tx("次累计", "total")}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tx(
              `全站 AC ${allowance.acCount} 题 · 再 AC ${allowance.missingForNextBatch} 题 +${allowance.buyinsPerBatch} 次`,
              `${allowance.acCount} ACs · ${allowance.missingForNextBatch} more for +${allowance.buyinsPerBatch}`,
            )}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{tx("今日牌局风控", "Daily risk limits")}</span>
            <ShieldCheck size={15} className="text-emerald-600" />
          </div>
          <p className="mt-1.5 text-xl font-bold tabular-nums">
            <span className={daily.netCents > 0 ? "text-success" : daily.netCents < 0 ? "text-danger" : ""}>
              {formatSignedChips(daily.netCents)}
            </span>
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {tx(`今日净输赢 (${daily.handsPlayed}局)`, `today net (${daily.handsPlayed} hands)`)}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {tx("今日已买入：", "Bought in: ")}
            {formatChips(daily.buyInCents)}
            {settings.dailyBuyInLimitCents > 0 && ` / ${formatChips(settings.dailyBuyInLimitCents)}`}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{tx("牌局规则", "Table rules")}</span>
            <Spade size={15} className="text-muted-foreground" />
          </div>
          <p className="mt-1.5 text-sm font-semibold tabular-nums">
            {tx(`买入 ${settings.minBuyInBb}–${settings.maxBuyInBb} BB · 超时 ${settings.turnTimeoutSeconds}s`,
              `Buy-in ${settings.minBuyInBb}–${settings.maxBuyInBb} BB · ${settings.turnTimeoutSeconds}s timer`)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tx(
              `每日净输/净赢上限：${settings.dailyNetLossLimitCents > 0 ? formatChips(settings.dailyNetLossLimitCents) : "不限"} / ${settings.dailyNetWinLimitCents > 0 ? formatChips(settings.dailyNetWinLimitCents) : "不限"}`,
              `Daily loss/win cap: ${settings.dailyNetLossLimitCents > 0 ? formatChips(settings.dailyNetLossLimitCents) : "None"} / ${settings.dailyNetWinLimitCents > 0 ? formatChips(settings.dailyNetWinLimitCents) : "None"}`,
            )}
          </p>
        </div>
      </div>

      {/* Tabs: Public Tables vs Wallet Ledger */}
      <div className="flex items-center gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("tables")}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${
            activeTab === "tables" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
          }`}
        >
          <Users size={15} /> {tx("公共牌桌", "Public tables")} ({status.tables.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ledger")}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${
            activeTab === "ledger" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
          }`}
        >
          <History size={15} /> {tx("筹码流水", "Chip ledger")}
        </button>
      </div>

      {activeTab === "tables" ? (
        status.tables.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {status.tables.map(table => {
              const isMine = status.activeTableId === table.id;
              return (
                <article
                  key={table.id}
                  className={`flex flex-col justify-between rounded-xl border bg-surface p-4 shadow-xs transition hover:border-primary/50 ${
                    isMine ? "border-primary ring-1 ring-primary/30" : "border-border"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-semibold">{table.name}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          table.status === "playing"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {table.status === "playing" ? tx("对局中", "Playing") : tx("等待中", "Waiting")}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-muted/40 p-2">
                        <p className="text-muted-foreground">{tx("盲注 (SB / BB)", "Blinds (SB / BB)")}</p>
                        <p className="mt-0.5 font-bold tabular-nums text-foreground">
                          {formatChips(table.smallBlindCents)} / {formatChips(table.bigBlindCents)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/40 p-2">
                        <p className="text-muted-foreground">{tx("人数", "Players")}</p>
                        <p className="mt-0.5 font-bold tabular-nums text-foreground">
                          {table.seatedCount} / {table.maxSeats}
                        </p>
                      </div>
                    </div>

                    <p className="mt-2.5 text-xs text-muted-foreground tabular-nums">
                      {tx("买入范围：", "Buy-in: ")}
                      {formatChips(table.minBuyInCents)} – {formatChips(table.maxBuyInCents)} {tx("奖学金", "scholarship")}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {table.handNumber > 0 ? tx(`已进行 ${table.handNumber} 局`, `${table.handNumber} hands played`) : tx("新开牌桌", "Fresh table")}
                    </span>
                    <Button
                      size="sm"
                      variant={isMine ? "primary" : "secondary"}
                      onClick={() => setSelectedTableId(table.id)}
                    >
                      {isMine ? tx("回到牌桌", "Resume") : tx("进入牌桌", "Open table")}
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted-foreground">
            {tx("当前暂无可用公共牌桌，请等待平台管理员创建。", "No public tables available yet.")}
          </p>
        )
      ) : (
        <section className="overflow-x-auto rounded-xl border border-border bg-surface">
          {ledger === null ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{tx("正在加载流水…", "Loading ledger…")}</p>
          ) : ledger.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{tx("暂无扑克筹码变动记录", "No poker ledger entries yet")}</p>
          ) : (
            <table className="w-full min-w-[540px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">{tx("时间", "Time")}</th>
                  <th className="px-4 py-2.5 font-medium">{tx("类型", "Type")}</th>
                  <th className="px-4 py-2.5 font-medium">{tx("说明", "Note")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{tx("筹码变动", "Delta")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{tx("扑克零头余额", "Chip balance")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ledger.map(entry => {
                  const pair = ledgerKindLabel[entry.kind] ?? [entry.kind, entry.kind];
                  return (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground tabular-nums">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{locale === "en" ? pair[1] : pair[0]}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{entry.note}</td>
                      <td
                        className={`whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums ${
                          entry.deltaCents > 0 ? "text-success" : "text-foreground"
                        }`}
                      >
                        {formatSignedChips(entry.deltaCents)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                        {formatChips(entry.balanceAfterCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
