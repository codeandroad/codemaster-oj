"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  Coins,
  History,
  Lock,
  RefreshCw,
  ShieldCheck,
  Spade,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { AppLink } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { apiMessage, productionApi } from "@/lib/production-api";
import { PokerChip } from "./poker-cards";
import { PokerTable } from "./poker-table";
import styles from "./poker-table.module.css";
import {
  formatChips,
  formatSignedChips,
  notifyScholarshipChanged,
  type PokerLedgerEntry,
  type PokerStatusResponse,
  type PokerTableSummary,
} from "./poker-types";

function MiniTablePreview({ table }: { table: PokerTableSummary }) {
  const dots = Array.from({ length: table.maxSeats }, (_, i) => {
    const angle = (Math.PI * 2 * i) / table.maxSeats + Math.PI / 2;
    const x = 50 + Math.cos(angle) * 40;
    const y = 50 + Math.sin(angle) * 35;
    const kind = i < table.humanCount ? "human" : i < table.humanCount + table.botCount ? "bot" : "empty";
    return { x, y, kind };
  });

  return (
    <div className="relative flex h-24 w-full items-center justify-center rounded-xl bg-gradient-to-b from-slate-900 to-slate-950 p-2">
      <div className="relative h-14 w-36 rounded-full border-[3px] border-amber-950/90 bg-[radial-gradient(ellipse_at_center,#14754d_0%,#083c26_100%)] shadow-inner">
        <div className="absolute inset-1 rounded-full border border-amber-200/20" />
        <div className="flex h-full items-center justify-center text-[10px] font-extrabold tracking-wider text-amber-200/80 tabular-nums">
          {formatChips(table.smallBlindCents)}/{formatChips(table.bigBlindCents)}
        </div>
      </div>
      {dots.map((d, idx) => (
        <span
          key={idx}
          style={{ left: `${d.x}%`, top: `${d.y}%` }}
          className={`absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
            d.kind === "human"
              ? "border-sky-200 bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]"
              : d.kind === "bot"
                ? "border-amber-200 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]"
                : "border-white/15 bg-white/10"
          }`}
        />
      ))}
    </div>
  );
}

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
      <div role="status" className={`${styles.heroBanner} flex h-56 items-center justify-center rounded-2xl text-sm text-emerald-100/80`}>
        {tx("正在加载德州扑克俱乐部…", "Loading Texas Hold'em Club…")}
      </div>
    );
  }

  if (!status) {
    return (
      <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        {error || tx("无法加载德州扑克状态", "Could not load Texas Hold'em status")}
      </div>
    );
  }

  const { allowance, settings, wallet, daily } = status;

  // Locked view with high-craft club invitation aesthetic + SVG progress ring
  if (!status.enabled || !status.unlocked) {
    const progressPct = allowance.initialUnlockAcProblems > 0
      ? Math.min(100, Math.round((allowance.acCount / allowance.initialUnlockAcProblems) * 100))
      : 100;
    const radius = 44;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - progressPct / 100);

    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <section className={`${styles.heroBanner} relative overflow-hidden rounded-2xl border border-amber-300/20 p-6 text-white sm:p-8`}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">
                <Lock size={13} />
                {!status.enabled ? tx("管理员暂未开放", "Currently Closed") : tx("解题达标解锁", "AC Milestone Unlock")}
              </div>
              <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
                <Spade size={24} className="text-amber-300" />
                {tx("开放平台 · 德州扑克俱乐部", "Open Platform · Hold'em Club")}
              </h2>
              <p className="text-sm leading-relaxed text-slate-300">
                {!status.enabled
                  ? tx(
                      "德州扑克默认关闭，暂未对用户开放。管理员开启后，达成解题里程碑即可使用平台奖学金进入无限注德州牌桌，支持 2–6 人弹性对局与 AI 随时补位。",
                      "Texas Hold'em is closed by default. Once opened by a platform admin, reach the AC milestone to play No-Limit Hold'em with flexible 2–6 player seating and instant AI opponents.",
                    )
                  : tx(
                      `初次解锁需全站去重 AC 达到 ${allowance.initialUnlockAcProblems} 题（包含校内练习与开放平台 AC），解锁即赠 ${allowance.buyinsPerBatch} 次买入机会；此后每再 AC ${allowance.acPerBuyinBatch} 道新题再解锁 ${allowance.buyinsPerBatch} 次。`,
                      `Initial unlock requires ${allowance.initialUnlockAcProblems} site-wide distinct ACs (school + Open Platform), granting ${allowance.buyinsPerBatch} buy-ins — plus ${allowance.buyinsPerBatch} more for every ${allowance.acPerBuyinBatch} additional ACs.`,
                    )}
              </p>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <AppLink
                  href="/practice/problems"
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-4 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:from-amber-300 hover:to-amber-400"
                >
                  {tx("前往题库刷题解锁", "Solve Problems to Unlock")} <ArrowRight size={15} />
                </AppLink>
                {status.activeTableId && (
                  <Button size="sm" variant="secondary" onClick={() => setSelectedTableId(status.activeTableId)}>
                    {tx("返回已入座牌桌", "Return to seated table")}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => void loadStatus()}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
                >
                  <RefreshCw size={14} /> {tx("刷新进度", "Refresh")}
                </button>
              </div>
            </div>

            {/* Circular AC Progress Ring */}
            <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl border border-white/10 bg-black/35 px-6 py-5 backdrop-blur-xs">
              <div className="relative flex size-28 items-center justify-center">
                <svg className="size-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-xl font-black tabular-nums text-white">{allowance.acCount}</span>
                  <span className="text-[11px] font-medium text-amber-200/80">
                    / {allowance.initialUnlockAcProblems} AC
                  </span>
                </div>
              </div>
              <p className="mt-2.5 text-xs font-medium text-slate-300">
                {allowance.missingForInitialUnlock > 0
                  ? tx(`还差 ${allowance.missingForInitialUnlock} 题解锁`, `${allowance.missingForInitialUnlock} more to unlock`)
                  : tx("AC 条件已达成", "AC goal reached")}
              </p>
            </div>
          </div>

          {/* Rule Highlights */}
          <div className="mt-6 grid gap-3 border-t border-white/10 pt-5 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 text-xs">
              <p className="text-slate-400">{tx("默认盲注 (SB / BB)", "Default Blinds")}</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-bold tabular-nums text-amber-200">
                <PokerChip tone="gold" size={14} />
                {formatChips(settings.defaultSmallBlindCents)} / {formatChips(settings.defaultBigBlindCents)} {tx("奖学金", "sch.")}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 text-xs">
              <p className="text-slate-400">{tx("分批买入机会", "Buy-in Allowances")}</p>
              <p className="mt-1 text-sm font-bold text-white">
                {tx(
                  `首解 ${allowance.initialUnlockAcProblems} 题 · 后每 ${allowance.acPerBuyinBatch} 题 +${allowance.buyinsPerBatch} 次`,
                  `${allowance.initialUnlockAcProblems} AC first · +${allowance.buyinsPerBatch} / ${allowance.acPerBuyinBatch} AC`,
                )}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 text-xs">
              <p className="text-slate-400">{tx("弹性桌台与抽水", "Flexible Play & Rake")}</p>
              <p className="mt-1 text-sm font-bold text-emerald-300">
                {tx("2–6 人秒开 · 0% 抽水", "2–6 Players · 0% Rake")}
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // Unlocked Club Lobby
  const ledgerKindLabel: Record<PokerLedgerEntry["kind"], [string, string]> = {
    scholarship_deposit: ["平台钱包转入", "Wallet deposit"],
    scholarship_withdraw: ["自动兑回平台钱包", "Wallet cash-out"],
    table_buyin: ["入座买入", "Table buy-in"],
    table_rebuy: ["桌上补码", "Table rebuy"],
    table_cashout: ["离桌筹码结算", "Table cash-out"],
  };

  const primaryTableId = status.activeTableId ?? status.tables[0]?.id ?? null;

  return (
    <div className="space-y-5">
      {/* Club Hero Banner */}
      <section className={`${styles.heroBanner} rounded-2xl border border-amber-300/20 p-5 text-white sm:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-200">
              <Spade size={12} /> {tx("开放平台 · 无限注德州扑克", "Open Platform · No-Limit Hold'em")}
            </div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              {tx("德州扑克俱乐部大厅", "Texas Hold'em Club")}
            </h2>
            <p className="text-xs text-slate-300">
              {tx(
                "0% 抽水 · 1 奖学金 = 100 筹码 · 弹性 2–6 人对局，人数不够时可一键召唤 AI 对手立即开玩",
                "0% rake · 1 scholarship = 100 chips · Flexible 2–6 player seating with instant AI opponents anytime",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {primaryTableId && (
              <button
                type="button"
                onClick={() => setSelectedTableId(primaryTableId)}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-5 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/25 transition hover:from-amber-300 hover:to-amber-400"
              >
                <Sparkles size={15} />
                {status.activeTableId ? tx("回到当前牌桌", "Resume Table") : tx("快速入桌开玩", "Quick Play")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadStatus()}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-semibold text-slate-200 transition hover:bg-white/15"
            >
              <RefreshCw size={14} /> {tx("刷新", "Refresh")}
            </button>
          </div>
        </div>

        {/* Sleek Glass Stat Strip */}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-xs">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>{tx("平台钱包与筹码零头", "Wallet & Chip Balance")}</span>
              <Coins size={14} className="text-amber-400" />
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <p className="text-lg font-extrabold tabular-nums text-white">
                {wallet.scholarshipBalance}{" "}
                <span className="text-xs font-normal text-slate-400">{tx("奖学金", "sch.")}</span>
              </p>
              <div className="flex items-center gap-2 text-xs">
                <span className="tabular-nums text-amber-200">
                  {tx("零头", "Chips")} {formatChips(wallet.pokerBalanceCents)}
                </span>
                {wallet.pokerBalanceCents >= 100 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleWithdraw()}
                    className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-200 hover:bg-amber-400/30"
                  >
                    {tx("兑回", "Withdraw")}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-xs">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>{tx("剩余买入机会", "Buy-in Allowances")}</span>
              <Ticket size={14} className="text-amber-300" />
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <p className="text-lg font-extrabold tabular-nums text-white">
                {allowance.remainingBuyIns}
                <span className="ml-1.5 text-xs font-normal text-slate-400">
                  / {allowance.totalUnlockedBuyIns} {tx("次", "total")}
                </span>
              </p>
              <span className="text-[11px] text-emerald-200/90 tabular-nums">
                {tx(`再 AC ${allowance.missingForNextBatch} 题 +${allowance.buyinsPerBatch}`, `${allowance.missingForNextBatch} AC → +${allowance.buyinsPerBatch}`)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-xs">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>{tx("今日牌局表现", "Today's Session")}</span>
              <ShieldCheck size={14} className="text-emerald-400" />
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <p className="text-lg font-extrabold tabular-nums">
                <span className={daily.netCents > 0 ? "text-emerald-300" : daily.netCents < 0 ? "text-rose-300" : "text-white"}>
                  {formatSignedChips(daily.netCents)}
                </span>
                <span className="ml-1.5 text-xs font-normal text-slate-400">
                  ({daily.handsPlayed} {tx("手", "hands")})
                </span>
              </p>
              <span className="text-[11px] text-slate-300 tabular-nums">
                {tx("已买", "In")} {formatChips(daily.buyInCents)}
                {settings.dailyBuyInLimitCents > 0 && `/${formatChips(settings.dailyBuyInLimitCents)}`}
              </span>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm text-success">
          {notice}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("tables")}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${
            activeTab === "tables" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
          }`}
        >
          <Users size={15} /> {tx("公共牌桌", "Public Tables")} ({status.tables.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ledger")}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${
            activeTab === "ledger" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
          }`}
        >
          <History size={15} /> {tx("筹码流水", "Chip Ledger")}
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
                  className={`group flex flex-col justify-between overflow-hidden rounded-2xl border bg-surface p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md ${
                    isMine ? "border-primary ring-1 ring-primary/30" : "border-border"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-bold">{table.name}</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {tx("买入", "Buy-in")} {formatChips(table.minBuyInCents)} – {formatChips(table.maxBuyInCents)} {tx("奖学金", "sch.")}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          table.status === "playing"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {table.status === "playing" ? tx("激战中", "Live") : tx("随时开局", "Open")}
                      </span>
                    </div>

                    <MiniTablePreview table={table} />

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 tabular-nums">
                        <Users size={13} />
                        {table.humanCount} {tx("真人", "human")}
                        {table.botCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                            · <Bot size={12} /> {table.botCount} AI
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums">
                        {tx(`最多 ${table.maxSeats} 人`, `Up to ${table.maxSeats}`)} ·{" "}
                        {table.handNumber > 0 ? `#${table.handNumber}` : tx("新桌", "Fresh")}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setSelectedTableId(table.id)}
                      className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                        isMine
                          ? "bg-gradient-to-b from-amber-400 to-amber-500 text-slate-950 shadow-sm hover:from-amber-300 hover:to-amber-400"
                          : "bg-primary text-primary-foreground hover:opacity-95"
                      }`}
                    >
                      {isMine ? tx("回到牌桌", "Resume Table") : tx("进入牌桌", "Enter Table")}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
            {tx("当前暂无可用公共牌桌，请等待平台管理员创建。", "No public tables available yet.")}
          </p>
        )
      ) : (
        <section className="overflow-x-auto rounded-2xl border border-border bg-surface">
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
