"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Coins,
  History,
  LogOut,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Ticket,
  Trophy,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { ProfileAvatar } from "@/components/profile-hero";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiMessage, productionApi } from "@/lib/production-api";
import { CardBack, EmptyCardSlot, PlayingCard, PokerChip } from "./poker-cards";
import styles from "./poker-table.module.css";
import {
  formatChips,
  formatSignedChips,
  notifyScholarshipChanged,
  type PokerSeatSlot,
  type PokerTableView,
} from "./poker-types";

interface SeatAnchor {
  left: string;
  top: string;
  betOffset: string;
}

// Dynamic elliptical anchors for 1..6 active seats (index 0 = bottom-center hero).
function getSeatAnchors(count: number): SeatAnchor[] {
  switch (Math.max(1, Math.min(6, count))) {
    case 1:
      return [{ left: "50%", top: "86%", betOffset: "-top-9 left-1/2 -translate-x-1/2" }];
    case 2:
      return [
        { left: "50%", top: "86%", betOffset: "-top-9 left-1/2 -translate-x-1/2" },
        { left: "50%", top: "13%", betOffset: "-bottom-9 left-1/2 -translate-x-1/2" },
      ];
    case 3:
      return [
        { left: "50%", top: "86%", betOffset: "-top-9 left-1/2 -translate-x-1/2" },
        { left: "21%", top: "19%", betOffset: "-bottom-9 left-1/2 -translate-x-1/2" },
        { left: "79%", top: "19%", betOffset: "-bottom-9 left-1/2 -translate-x-1/2" },
      ];
    case 4:
      return [
        { left: "50%", top: "86%", betOffset: "-top-9 left-1/2 -translate-x-1/2" },
        { left: "12%", top: "50%", betOffset: "top-1/2 -right-20 -translate-y-1/2" },
        { left: "50%", top: "13%", betOffset: "-bottom-9 left-1/2 -translate-x-1/2" },
        { left: "88%", top: "50%", betOffset: "top-1/2 -left-20 -translate-y-1/2" },
      ];
    case 5:
      return [
        { left: "50%", top: "86%", betOffset: "-top-9 left-1/2 -translate-x-1/2" },
        { left: "12%", top: "60%", betOffset: "top-1/2 -right-20 -translate-y-1/2" },
        { left: "25%", top: "15%", betOffset: "-bottom-9 left-1/2 -translate-x-1/2" },
        { left: "75%", top: "15%", betOffset: "-bottom-9 left-1/2 -translate-x-1/2" },
        { left: "88%", top: "60%", betOffset: "top-1/2 -left-20 -translate-y-1/2" },
      ];
    default:
      return [
        { left: "50%", top: "86%", betOffset: "-top-9 left-1/2 -translate-x-1/2" },
        { left: "12%", top: "67%", betOffset: "-top-8 right-0" },
        { left: "17%", top: "21%", betOffset: "-bottom-9 left-1/2 -translate-x-1/2" },
        { left: "50%", top: "12%", betOffset: "-bottom-9 left-1/2 -translate-x-1/2" },
        { left: "83%", top: "21%", betOffset: "-bottom-9 left-1/2 -translate-x-1/2" },
        { left: "88%", top: "67%", betOffset: "-top-8 left-0" },
      ];
  }
}

function streetLabel(street: string, locale: string) {
  const map: Record<string, [string, string]> = {
    preflop: ["翻牌前", "PREFLOP"],
    flop: ["翻牌圈", "FLOP"],
    turn: ["转牌圈", "TURN"],
    river: ["河牌圈", "RIVER"],
    showdown: ["摊牌结算", "SHOWDOWN"],
  };
  const pair = map[street] ?? [street, street];
  return locale === "en" ? pair[1] : pair[0];
}

function botStyleLabel(style: string | null | undefined, locale: string) {
  const map: Record<string, [string, string]> = {
    tight: ["紧凶", "TAG"],
    balanced: ["均衡", "GTO"],
    loose: ["松凶", "Loose"],
    aggressive: ["激进", "LAG"],
  };
  const pair = style ? map[style] : null;
  if (!pair) return "AI";
  return locale === "en" ? pair[1] : pair[0];
}

function CountdownAvatar({
  avatar,
  name,
  isBot,
  isActing,
  ratio,
  secondsLeft,
}: {
  avatar?: string;
  name: string;
  isBot?: boolean;
  isActing: boolean;
  ratio: number;
  secondsLeft: number | null;
}) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.max(0, Math.min(1, ratio)));
  const urgent = isActing && secondsLeft !== null && secondsLeft <= 5;

  return (
    <div className="relative flex size-11 shrink-0 items-center justify-center">
      {isActing && (
        <svg className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r={radius} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2.5" />
          <circle
            cx="22"
            cy="22"
            r={radius}
            fill="none"
            stroke={urgent ? "#ef4444" : "#fbbf24"}
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-[stroke-dashoffset] duration-200"
          />
        </svg>
      )}
      <div
        className={`relative flex size-9 items-center justify-center overflow-hidden rounded-full ring-1 ${
          isBot
            ? "bg-gradient-to-br from-amber-500/30 to-indigo-900/90 ring-amber-300/50"
            : "ring-white/25"
        }`}
      >
        {isBot ? (
          <Bot size={18} className="text-amber-200" />
        ) : (
          <ProfileAvatar avatar={avatar} nickname={name} />
        )}
      </div>
    </div>
  );
}

export function PokerTable({
  tableId,
  onBack,
}: {
  tableId: string;
  onBack: () => void;
}) {
  const { locale } = useLocale();
  const tx = useCallback((zh: string, en: string) => (locale === "en" ? en : zh), [locale]);

  const [view, setView] = useState<PokerTableView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [buyInOpen, setBuyInOpen] = useState(false);
  const [buyInCents, setBuyInCents] = useState(0);
  const [buyInFillBots, setBuyInFillBots] = useState(1);
  const [rebuyOpen, setRebuyOpen] = useState(false);
  const [rebuyCents, setRebuyCents] = useState(0);
  const [raiseTargetCents, setRaiseTargetCents] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"log" | "history">("log");

  const revisionRef = useRef<number | null>(null);
  const lastWalletRef = useRef<number | null>(null);

  const applyView = useCallback((next: PokerTableView) => {
    if (next.serverTime) {
      const serverMs = Date.parse(next.serverTime);
      if (Number.isFinite(serverMs)) setClockOffsetMs(serverMs - Date.now());
    }
    if (next.unchanged) return;
    revisionRef.current = next.table.revision;
    if (lastWalletRef.current !== null && lastWalletRef.current !== next.wallet.scholarshipBalance) {
      notifyScholarshipChanged();
    }
    lastWalletRef.current = next.wallet.scholarshipBalance;
    setView(next);
    setError("");
  }, []);

  const fetchTable = useCallback(
    async (full = false) => {
      const query = !full && revisionRef.current !== null ? `?since=${revisionRef.current}` : "";
      const next = await productionApi<PokerTableView>(
        `practice/poker/tables/${encodeURIComponent(tableId)}${query}`,
      );
      applyView(next);
    },
    [applyView, tableId],
  );

  // Detect whether an AI bot is currently acting so we poll snappily (700ms) for smooth pacing.
  const actingSeatSlot = useMemo(() => {
    if (!view?.hand || view.hand.finished || view.hand.actingSeat === null) return null;
    return view.seats.find(s => s.seatIndex === view.hand!.actingSeat) ?? null;
  }, [view]);
  const botIsActing = Boolean(actingSeatSlot?.isBot);
  const isShowdown = view?.table.status === "showdown";

  useEffect(() => {
    let active = true;
    revisionRef.current = null;
    const load = async (full: boolean) => {
      if (!active || (!full && document.visibilityState === "hidden")) return;
      try {
        await fetchTable(full);
      } catch (err) {
        if (active) setError(apiMessage(err));
      }
    };
    void load(true);
    const pollMs = botIsActing || isShowdown ? 720 : 1200;
    const interval = setInterval(() => void load(false), pollMs);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [botIsActing, fetchTable, isShowdown]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  const myActions = view?.hand?.myActions ?? null;
  useEffect(() => {
    if (myActions?.minBetOrRaiseToCents != null) {
      setRaiseTargetCents(myActions.minBetOrRaiseToCents);
    }
  }, [myActions?.minBetOrRaiseToCents, view?.hand?.handId, view?.hand?.street, view?.hand?.currentBetCents]);

  const runMutation = useCallback(
    async (fn: () => Promise<PokerTableView>, okMsg?: string) => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const next = await fn();
        applyView(next);
        notifyScholarshipChanged();
        if (okMsg) setNotice(okMsg);
      } catch (err) {
        setError(apiMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [applyView],
  );

  // Keyboard shortcuts when it's your turn (F = Fold, C = Check/Call, R = Bet/Raise).
  useEffect(() => {
    if (!myActions || !view?.hand || view.hand.finished || busy || buyInOpen || rebuyOpen) return;
    const handId = view.hand.handId;
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "f") {
        event.preventDefault();
        void runMutation(() =>
          productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
            method: "POST",
            body: { handId, action: "fold" },
          }),
        );
      } else if (key === "c") {
        event.preventDefault();
        const act = myActions.canCheck ? "check" : myActions.canCall ? "call" : null;
        if (act) {
          void runMutation(() =>
            productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
              method: "POST",
              body: { handId, action: act },
            }),
          );
        }
      } else if (key === "r" && (myActions.canBet || myActions.canRaise) && myActions.minBetOrRaiseToCents !== null) {
        event.preventDefault();
        void runMutation(() =>
          productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
            method: "POST",
            body: { handId, action: myActions.canBet ? "bet" : "raise", amountCents: raiseTargetCents },
          }),
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, buyInOpen, myActions, raiseTargetCents, rebuyOpen, runMutation, tableId, view?.hand]);

  function openBuyInDialog() {
    if (!view) return;
    const min = view.table.minBuyInCents;
    const max = Math.min(view.table.maxBuyInCents, view.wallet.totalAvailableCents);
    const defaultAmt = Math.max(min, Math.min(max, Math.round((min + view.table.maxBuyInCents) / 2)));
    setBuyInCents(defaultAmt);
    const otherSeated = view.table.humanCount + view.table.botCount;
    setBuyInFillBots(view.table.allowBots && otherSeated === 0 ? 1 : 0);
    setBuyInOpen(true);
  }

  function openRebuyDialog() {
    if (!view?.mySeat) return;
    const maxAdd = view.table.maxBuyInCents - view.mySeat.stackCents;
    const minAdd = view.mySeat.stackCents === 0
      ? Math.min(maxAdd, view.table.minBuyInCents)
      : Math.min(maxAdd, view.table.bigBlindCents);
    const clampedMax = Math.min(maxAdd, view.wallet.totalAvailableCents);
    setRebuyCents(Math.max(minAdd, Math.min(clampedMax, maxAdd)));
    setRebuyOpen(true);
  }

  // Only render occupied (or mid-hand ghost) seats — NO cluttered empty dashed boxes!
  const activeSeats = useMemo(() => {
    if (!view) return [] as Array<{ slot: PokerSeatSlot; anchor: SeatAnchor }>;
    const occupied = view.seats
      .filter(s => s.occupied || s.leftMidHand)
      .sort((a, b) => a.seatIndex - b.seatIndex);
    if (!occupied.length) return [];

    // Rotate so viewer's seat (if seated) is always at anchor 0 (bottom center).
    const myIdx = occupied.findIndex(s => s.isMe);
    const rotated = myIdx > 0 ? [...occupied.slice(myIdx), ...occupied.slice(0, myIdx)] : occupied;
    const anchors = getSeatAnchors(rotated.length);
    return rotated.map((slot, idx) => ({ slot, anchor: anchors[idx] ?? anchors[0] }));
  }, [view]);

  const effectiveNow = nowMs + clockOffsetMs;
  const turnMsLeft = view?.hand?.turnDeadlineAt
    ? Math.max(0, Date.parse(view.hand.turnDeadlineAt) - effectiveNow)
    : null;
  const turnSecondsLeft = turnMsLeft !== null ? Math.ceil(turnMsLeft / 1000) : null;
  const nextHandSecondsLeft = view?.table.status === "showdown" && view.table.nextHandAt
    ? Math.max(0, Math.ceil((Date.parse(view.table.nextHandAt) - effectiveNow) / 1000))
    : null;

  const winningCardSet = useMemo(() => {
    const set = new Set<string>();
    const revealed = view?.hand?.showdownResult?.revealedHands ?? [];
    const winnerSeats = new Set((view?.hand?.showdownResult?.awards ?? []).map(a => a.seatIndex));
    for (const r of revealed) {
      if (winnerSeats.has(r.seatIndex)) {
        for (const c of r.bestCards) set.add(c);
      }
    }
    return set;
  }, [view?.hand?.showdownResult]);

  if (!view) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft size={15} /> {tx("返回大厅", "Back to lobby")}
        </Button>
        {error ? (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
            {error}
          </div>
        ) : (
          <div role="status" className={`${styles.stage} flex h-80 items-center justify-center text-sm text-emerald-100/80`}>
            {tx("正在连接德州扑克牌桌…", "Entering poker table…")}
          </div>
        )}
      </div>
    );
  }

  const { table, hand, mySeat, allowance, wallet, daily } = view;
  const mySlot = view.seats.find(s => s.isMe) ?? null;
  const canSit = !mySeat && table.enabled;
  const openSeatsLeft = Math.max(0, table.maxSeats - (table.humanCount + table.botCount));
  const maxAddableBots = table.allowBots
    ? Math.min(openSeatsLeft, Math.max(0, table.maxBotsPerTable - table.botCount))
    : 0;

  const fundingPreview = (cents: number) => {
    const fromPoker = Math.min(wallet.pokerBalanceCents, cents);
    const deficit = Math.max(0, cents - wallet.pokerBalanceCents);
    const scholarshipNeeded = Math.ceil(deficit / 100);
    const changeToPoker = scholarshipNeeded * 100 - deficit;
    return { fromPoker, scholarshipNeeded, changeToPoker };
  };

  const rebuyMaxAdd = mySeat ? Math.max(0, table.maxBuyInCents - mySeat.stackCents) : 0;
  const rebuyMinAdd = mySeat
    ? mySeat.stackCents === 0
      ? Math.min(rebuyMaxAdd, table.minBuyInCents)
      : Math.min(rebuyMaxAdd, table.bigBlindCents)
    : 0;

  const addBots = (count: number) =>
    void runMutation(
      () =>
        productionApi<PokerTableView>(`practice/poker/tables/${tableId}/bots`, {
          method: "POST",
          body: { action: "add", count },
        }),
      tx(`已添加 ${count} 名 AI 对手`, `Added ${count} AI opponent(s)`),
    );

  const clearBots = () =>
    void runMutation(
      () =>
        productionApi<PokerTableView>(`practice/poker/tables/${tableId}/bots`, {
          method: "POST",
          body: { action: "clear" },
        }),
      table.status === "playing"
        ? tx("AI 对手将在本局结束后离桌", "AI opponents will leave after this hand")
        : tx("已清空本桌 AI 对手", "Cleared AI opponents"),
    );

  return (
    <div className="space-y-3">
      {/* Alerts */}
      {error && (
        <div role="alert" className="rounded-xl border border-danger/35 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}
      {!wallet.walletEligible && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          <ShieldAlert size={16} />
          {tx("请先在开放平台「设置」中开启奖学金钱包后再入座买入。", "Enable your Open Platform scholarship wallet in Settings before buying in.")}
        </div>
      )}

      {/* Full-Width Cinema Tabletop Stage */}
      <section className={`${styles.stage} text-white`}>
        {/* Floating Glass Top HUD */}
        <header className="relative z-30 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-black/35 px-4 py-2.5 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-slate-200 transition hover:bg-white/15"
            >
              <ArrowLeft size={14} /> {tx("大厅", "Lobby")}
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-white">{table.name}</h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/35 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-200">
                <PokerChip tone="gold" size={12} />
                {formatChips(table.smallBlindCents)} / {formatChips(table.bigBlindCents)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 tabular-nums">
                <Users size={11} />
                {table.humanCount}
                {table.botCount > 0 ? ` + ${table.botCount} AI` : ""} / {table.maxSeats}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {/* Wallet & Buy-in Allowance Pills */}
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-slate-200 tabular-nums">
              <Ticket size={13} className="text-amber-300" />
              {tx("买入", "Buy-ins")} <strong className="text-white">{allowance.remainingBuyIns}</strong>
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-slate-200 tabular-nums">
              <Coins size={13} className="text-amber-400" />
              <strong className="text-white">{wallet.scholarshipBalance}</strong>
              {wallet.pokerBalanceCents > 0 && (
                <span className="text-amber-200/80">+{formatChips(wallet.pokerBalanceCents)}</span>
              )}
            </span>

            {/* AI Opponent Controls when seated */}
            {mySeat && table.allowBots && (
              <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-amber-400/30 bg-amber-500/10">
                <button
                  type="button"
                  disabled={busy || maxAddableBots <= 0}
                  onClick={() => addBots(1)}
                  className="inline-flex h-full items-center gap-1 px-2.5 text-xs font-medium text-amber-200 transition hover:bg-amber-400/20 disabled:opacity-40"
                  title={tx("添加 1 名 AI 对手", "Add 1 AI opponent")}
                >
                  <Bot size={13} /> +AI
                </button>
                {table.botCount > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={clearBots}
                    className="inline-flex h-full items-center gap-1 border-l border-amber-400/25 px-2 text-xs text-amber-100/80 transition hover:bg-amber-400/20 disabled:opacity-40"
                    title={tx("移除所有 AI 对手", "Remove AI opponents")}
                  >
                    <UserMinus size={12} />
                  </button>
                )}
              </div>
            )}

            {mySeat?.canRebuy && (
              <button
                type="button"
                disabled={busy}
                onClick={openRebuyDialog}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-2.5 font-medium text-emerald-200 transition hover:bg-emerald-500/25"
              >
                <Plus size={13} /> {tx("补码", "Rebuy")}
              </button>
            )}

            {mySeat && (
              mySeat.inActiveHand ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runMutation(
                      () =>
                        productionApi<PokerTableView>(`practice/poker/tables/${tableId}/leave`, {
                          method: "POST",
                          body: { cancel: mySeat.leaveAfterHand },
                        }),
                      mySeat.leaveAfterHand
                        ? tx("已取消本局后离桌", "Staying for next hand")
                        : tx("本局结束后自动离桌并兑回筹码", "Will leave & cash out after hand"),
                    )
                  }
                  className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 font-medium transition ${
                    mySeat.leaveAfterHand
                      ? "border-amber-400 bg-amber-500/25 text-amber-100"
                      : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/15"
                  }`}
                >
                  <LogOut size={13} />
                  {mySeat.leaveAfterHand ? tx("取消局后离", "Stay") : tx("局后离桌", "Leave next")}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runMutation(
                      () =>
                        productionApi<PokerTableView>(`practice/poker/tables/${tableId}/leave`, {
                          method: "POST",
                          body: {},
                        }),
                      tx("已离桌，整数奖学金已自动兑回平台钱包", "Left table; whole scholarships cashed out"),
                    )
                  }
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 font-medium text-slate-200 transition hover:bg-rose-500/25 hover:border-rose-400/40"
                >
                  <LogOut size={13} /> {tx("离桌兑回", "Cash out")}
                </button>
              )
            )}

            <button
              type="button"
              onClick={() => setDrawerOpen(v => !v)}
              className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 font-medium transition ${
                drawerOpen
                  ? "border-amber-400/50 bg-amber-500/20 text-amber-100"
                  : "border-white/15 bg-white/5 text-slate-200 hover:bg-white/15"
              }`}
            >
              <History size={13} /> {tx("牌谱", "Log")}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void fetchTable(true)}
              aria-label={tx("刷新牌桌", "Refresh")}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-slate-200 transition hover:bg-white/15"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </header>

        {/* Main Poker Felt Arena */}
        <div className="relative h-[500px] w-full sm:h-[545px]">
          {/* Sculpted Outer Rail + Velvet Emerald Felt */}
          <div className={styles.rail}>
            <div className={styles.felt}>
              {/* Club Watermark */}
              <div className={styles.watermark}>
                <span className="text-lg font-black uppercase sm:text-2xl">CODEMASTER</span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.35em]">
                  NO-LIMIT HOLD&apos;EM · 0% RAKE
                </span>
              </div>
            </div>
          </div>

          {/* Center Felt Stage: Pot, Community Cards, Showdown / Instant Play Prompt */}
          <div className="absolute left-1/2 top-[48%] z-20 flex w-[min(86%,27rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 text-center">
            {hand ? (
              <>
                {/* Street & Pot Pill */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span className="rounded-full border border-white/10 bg-black/45 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-emerald-100/90 backdrop-blur-xs">
                    #{hand.handNumber} · {streetLabel(hand.street, locale)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/45 bg-black/60 px-3.5 py-1 text-sm font-extrabold tabular-nums text-amber-200 shadow-md backdrop-blur-xs">
                    <PokerChip tone="gold" size={16} />
                    {tx("底池", "POT")} {formatChips(hand.potCents)}
                  </span>
                </div>

                {/* Multi-pot Breakdown */}
                {hand.pots.length > 1 && (
                  <div className="flex flex-wrap justify-center gap-1.5 text-[11px] text-amber-100/90">
                    {hand.pots.map((pot, idx) => (
                      <span
                        key={idx}
                        className="rounded-full border border-white/10 bg-black/45 px-2.5 py-0.5 tabular-nums"
                      >
                        {idx === 0 ? tx("主池", "Main") : `${tx("边池", "Side")} ${idx}`}: {formatChips(pot.amountCents)}
                      </span>
                    ))}
                  </div>
                )}

                {/* 5 Community Board Cards */}
                <div className="flex items-center justify-center gap-1.5 sm:gap-2.5">
                  {Array.from({ length: 5 }, (_, idx) => {
                    const card = hand.communityCards[idx];
                    return card ? (
                      <PlayingCard
                        key={`${hand.handId}-${card}`}
                        card={card}
                        size="md"
                        animate
                        highlight={hand.finished && winningCardSet.has(card)}
                      />
                    ) : (
                      <EmptyCardSlot key={idx} size="md" />
                    );
                  })}
                </div>

                {/* Showdown Winner Banner */}
                {hand.finished && hand.showdownResult && (
                  <div className={`${styles.actionBubble} mt-0.5 rounded-xl border border-amber-400/60 bg-black/80 px-4 py-2 text-xs text-amber-100 shadow-xl backdrop-blur-md`}>
                    <div className="flex flex-wrap items-center justify-center gap-2 font-bold">
                      <Trophy size={15} className="text-amber-400" />
                      {hand.showdownResult.awards.map((a, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1">
                          <span>{a.displayName}</span>
                          <span className="text-emerald-300 tabular-nums">+{formatChips(a.amountCents)}</span>
                          {a.handLabelZh && (
                            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                              {locale === "en" ? a.handLabelEn : a.handLabelZh}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                    {nextHandSecondsLeft !== null && (
                      <p className="mt-1 text-[11px] text-emerald-200/75 tabular-nums">
                        {tx(`${nextHandSecondsLeft} 秒后自动发下一手…`, `Next hand in ${nextHandSecondsLeft}s…`)}
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* Waiting / Instant Play Center Card */
              <div className="rounded-2xl border border-amber-300/25 bg-black/55 px-5 py-4 shadow-2xl backdrop-blur-md">
                {!mySeat ? (
                  <>
                    <p className="text-sm font-bold text-white">
                      {activeSeats.length === 0
                        ? tx("牌桌虚位以待", "Table ready for action")
                        : tx(`当前 ${activeSeats.length} 位玩家在桌`, `${activeSeats.length} player(s) seated`)}
                    </p>
                    <p className="mt-1 text-xs text-emerald-100/75">
                      {table.allowBots
                        ? tx("支持真人随时同桌，单人入座也能一键召唤 AI 对手立刻开玩", "Play live with peers or summon AI opponents anytime — zero waiting")
                        : tx("2–6 人弹性开局，无需凑满 6 人即可开玩", "Flexible 2–6 player table — deals as soon as 2 sit")}
                    </p>
                    {canSit && (
                      <button
                        type="button"
                        disabled={busy || allowance.remainingBuyIns <= 0 || !wallet.walletEligible}
                        onClick={openBuyInDialog}
                        className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-5 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/25 transition hover:from-amber-300 hover:to-amber-400 disabled:opacity-45"
                      >
                        <Sparkles size={15} />
                        {allowance.remainingBuyIns > 0
                          ? tx("立即入座开玩", "Sit & Play Now")
                          : tx("买入机会已用完", "No buy-ins left")}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold text-white">
                      {tx("再加 1 位对手即可秒开牌局", "Add an opponent or wait for a peer to deal")}
                    </p>
                    <p className="mt-1 text-xs text-emerald-100/75">
                      {tx("不再强制 6 人满桌 — 随时选择你想打的人数立刻发牌", "No forced 6-player wait — pick your table size and play immediately")}
                    </p>
                    {table.allowBots && maxAddableBots > 0 && (
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => addBots(1)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-3.5 text-xs font-bold text-slate-950 shadow-md transition hover:from-amber-300 hover:to-amber-400"
                        >
                          <Bot size={14} /> {tx("1v1 单挑 (+1 AI)", "Heads-Up (+1 AI)")}
                        </button>
                        {maxAddableBots >= 3 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => addBots(3)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-300/40 bg-amber-500/15 px-3 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/25"
                          >
                            <Bot size={14} /> {tx("四人局 (+3 AI)", "4-Max (+3 AI)")}
                          </button>
                        )}
                        {maxAddableBots >= 5 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => addBots(5)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-semibold text-slate-100 transition hover:bg-white/20"
                          >
                            <Bot size={14} /> {tx("六人桌 (+5 AI)", "6-Max (+5 AI)")}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Dynamic Occupied Seats Around the Felt */}
          {activeSeats.map(({ slot, anchor }) => {
            const isActing = Boolean(slot.isActing && !hand?.finished);
            const timerRatio =
              isActing && turnMsLeft !== null && !slot.isBot
                ? turnMsLeft / (table.turnTimeoutSeconds * 1000)
                : isActing && slot.isBot
                  ? 0.75
                  : 0;
            const showSeatCards =
              !slot.isMe && (Boolean(slot.holeCards) || (slot.cardCount ?? 0) > 0);
            const isWinner = Boolean(
              hand?.finished && hand.showdownResult?.awards.some(a => a.seatIndex === slot.seatIndex),
            );

            return (
              <div
                key={slot.seatIndex}
                style={{ left: anchor.left, top: anchor.top }}
                className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
              >
                <div className="relative flex flex-col items-center">
                  {/* Opponent Hole Cards / Showdown Reveal */}
                  {showSeatCards && (
                    <div className="-mb-2.5 flex items-center justify-center gap-0.5">
                      {slot.holeCards ? (
                        slot.holeCards.map((c, idx) => (
                          <PlayingCard
                            key={c}
                            card={c}
                            size="sm"
                            animate
                            tilt={idx === 0 ? "left" : "right"}
                            highlight={Boolean(hand?.finished && winningCardSet.has(c))}
                            dimmed={slot.folded}
                          />
                        ))
                      ) : (
                        <>
                          <CardBack size="xs" tilt="left" />
                          <CardBack size="xs" tilt="right" />
                        </>
                      )}
                    </div>
                  )}

                  {/* Player Glass Pod */}
                  <div
                    className={`relative flex min-w-[152px] items-center gap-2.5 rounded-2xl border px-3 py-2 shadow-xl backdrop-blur-md transition-all duration-200 ${
                      isWinner
                        ? "border-amber-300 bg-gradient-to-b from-amber-950/90 to-slate-950/95 ring-2 ring-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.45)]"
                        : isActing
                          ? "border-amber-400 bg-slate-900/95 ring-2 ring-amber-400/75"
                          : slot.isMe
                            ? "border-sky-400/60 bg-slate-900/90"
                            : "border-white/15 bg-slate-950/85"
                    } ${slot.folded || slot.leftMidHand ? "opacity-50" : ""}`}
                  >
                    <CountdownAvatar
                      avatar={slot.avatar}
                      name={slot.displayName ?? ""}
                      isBot={slot.isBot}
                      isActing={isActing}
                      ratio={timerRatio}
                      secondsLeft={slot.isBot ? null : turnSecondsLeft}
                    />

                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-1">
                        <span className="max-w-[92px] truncate text-xs font-semibold text-white">
                          {slot.displayName}
                        </span>
                        {slot.isBot && (
                          <span className="rounded bg-amber-400/20 px-1 py-0.2 text-[9px] font-bold text-amber-200">
                            {botStyleLabel(slot.botStyle, locale)}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 text-xs font-extrabold tabular-nums text-amber-300">
                        <PokerChip tone={slot.isMe ? "emerald" : "gold"} size={12} />
                        {formatChips(slot.stackCents ?? 0)}
                      </p>
                    </div>

                    {/* Dealer / SB / BB Pucks */}
                    {(slot.isDealer || slot.isSmallBlind || slot.isBigBlind) && (
                      <div className="absolute -right-2 -top-2 flex items-center gap-0.5">
                        {slot.isDealer && (
                          <span
                            title="Dealer"
                            className="flex size-5 items-center justify-center rounded-full border border-amber-600 bg-gradient-to-b from-white to-amber-100 text-[10px] font-black text-slate-950 shadow-md"
                          >
                            D
                          </span>
                        )}
                        {slot.isSmallBlind && (
                          <span className="rounded-full bg-indigo-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">
                            SB
                          </span>
                        )}
                        {slot.isBigBlind && (
                          <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">
                            BB
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Last Action / All-in / Thinking Pill */}
                  {(slot.lastAction || slot.allIn || isActing) && (
                    <div
                      className={`${styles.actionBubble} mt-1 flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold shadow-sm ${
                        slot.allIn
                          ? "border-rose-400/60 bg-rose-600 text-white"
                          : isActing && slot.isBot
                            ? "border-amber-300/40 bg-amber-500/20 text-amber-200"
                            : "border-white/10 bg-black/75 text-slate-200"
                      }`}
                    >
                      {isActing && slot.isBot
                        ? tx("思考中…", "Thinking…")
                        : isActing && turnSecondsLeft !== null
                          ? `${turnSecondsLeft}s`
                          : slot.lastAction}
                    </div>
                  )}

                  {/* Street Bet Chip Stack Pill */}
                  {(slot.streetBetCents ?? 0) > 0 && (
                    <div
                      className={`absolute ${anchor.betOffset} z-30 inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-black/80 px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-emerald-200 shadow-md`}
                    >
                      <PokerChip tone="emerald" size={13} />
                      {formatChips(slot.streetBetCents ?? 0)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Slide-over Action Log & Hand History Drawer */}
          {drawerOpen && (
            <aside className="absolute bottom-3 right-3 top-14 z-40 flex w-[min(92%,21rem)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950/92 shadow-2xl backdrop-blur-lg">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDrawerTab("log")}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      drawerTab === "log" ? "bg-amber-400/20 text-amber-200" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tx("本局动态", "Action log")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerTab("history")}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      drawerTab === "history" ? "bg-amber-400/20 text-amber-200" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tx("最近牌局", "Hands")} ({view.recentHands.length})
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label={tx("关闭", "Close")}
                  className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 text-xs">
                {drawerTab === "log" ? (
                  hand?.actionLog?.length ? (
                    <ul className="space-y-1.5">
                      {[...hand.actionLog].reverse().map((entry, idx) => (
                        <li key={idx} className="rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-slate-200">
                          {locale === "en" ? entry.textEn : entry.textZh}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="py-8 text-center text-slate-400">{tx("暂无牌局动态", "No actions yet")}</p>
                  )
                ) : view.recentHands.length ? (
                  <ul className="space-y-2">
                    {view.recentHands.map(h => (
                      <li key={h.id} className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                        <div className="flex items-center justify-between font-semibold">
                          <span className="text-slate-200">#{h.handNumber}</span>
                          <span className="tabular-nums text-amber-300">
                            {tx("底池", "Pot")} {formatChips(h.potCents)}
                          </span>
                        </div>
                        {h.communityCards?.length > 0 && (
                          <div className="mt-1.5 flex gap-1">
                            {h.communityCards.map(c => (
                              <PlayingCard key={c} card={c} size="xs" />
                            ))}
                          </div>
                        )}
                        <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-300">
                          {h.awards.map((a, idx) => (
                            <p key={idx}>
                              <strong className="text-white">{a.displayName}</strong>{" "}
                              <span className="text-emerald-300">+{formatChips(a.amountCents)}</span>
                              {a.handLabelZh && ` · ${locale === "en" ? a.handLabelEn : a.handLabelZh}`}
                            </p>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-8 text-center text-slate-400">{tx("暂无历史牌局", "No completed hands yet")}</p>
                )}
              </div>
            </aside>
          )}
        </div>

        {/* Pro Ergonomic Bottom Action Dock */}
        <footer className="relative z-30 border-t border-white/10 bg-black/55 px-4 py-3.5 backdrop-blur-lg">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Hero Hole Cards + Hand Strength */}
            <div className="flex items-center gap-4">
              {mySlot?.holeCards ? (
                <div className="flex items-center -space-x-2">
                  {mySlot.holeCards.map((c, idx) => (
                    <PlayingCard
                      key={`${hand?.handId}-${c}`}
                      card={c}
                      size="lg"
                      animate
                      tilt={idx === 0 ? "left" : "right"}
                      highlight={Boolean(hand?.finished && winningCardSet.has(c))}
                      dimmed={mySlot.folded}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center -space-x-2 opacity-60">
                  <CardBack size="md" tilt="left" />
                  <CardBack size="md" tilt="right" />
                </div>
              )}

              <div className="space-y-1">
                {hand?.myHandLabel ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-200">
                    {locale === "en" ? hand.myHandLabel.en : hand.myHandLabel.zh}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-slate-400">
                    {mySeat
                      ? mySlot?.folded
                        ? tx("本局已弃牌", "Folded this hand")
                        : tx("你的手牌区", "Your hand")
                      : tx("观战模式", "Spectating")}
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 tabular-nums">
                  {mySeat && (
                    <span>
                      {tx("桌上筹码", "Stack")}:{" "}
                      <strong className="text-amber-300">{formatChips(mySeat.stackCents)}</strong>
                    </span>
                  )}
                  <span>
                    {tx("今日净输赢", "Today")}:{" "}
                    <strong className={daily.netCents > 0 ? "text-emerald-300" : daily.netCents < 0 ? "text-rose-300" : "text-white"}>
                      {formatSignedChips(daily.netCents)}
                    </strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Action Controls */}
            {myActions && hand && !hand.finished ? (
              <div className="flex flex-1 flex-col gap-2.5 lg:max-w-[600px]">
                {/* Quick Pot Presets + Gold Slider (when bet/raise is legal) */}
                {(myActions.canBet || myActions.canRaise) &&
                  myActions.minBetOrRaiseToCents !== null &&
                  myActions.maxBetOrRaiseToCents !== null &&
                  myActions.maxBetOrRaiseToCents > myActions.minBetOrRaiseToCents && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {[
                          { label: tx("最小", "Min"), value: myActions.minBetOrRaiseToCents },
                          { label: "⅓", value: Math.round(myActions.currentBetCents + myActions.potCents * 0.33) },
                          { label: "½", value: Math.round(myActions.currentBetCents + myActions.potCents * 0.5) },
                          { label: "¾", value: Math.round(myActions.currentBetCents + myActions.potCents * 0.75) },
                          { label: tx("底池", "Pot"), value: Math.round(myActions.currentBetCents + myActions.potCents) },
                          { label: "ALL-IN", value: myActions.maxBetOrRaiseToCents },
                        ].map(preset => {
                          const clamped = Math.max(
                            myActions.minBetOrRaiseToCents!,
                            Math.min(myActions.maxBetOrRaiseToCents!, preset.value),
                          );
                          const active = raiseTargetCents === clamped;
                          return (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() => setRaiseTargetCents(clamped)}
                              className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
                                active
                                  ? "bg-amber-400 text-slate-950"
                                  : "bg-white/10 text-slate-200 hover:bg-white/20"
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                      <input
                        type="range"
                        aria-label={tx("加注金额", "Raise amount")}
                        min={myActions.minBetOrRaiseToCents}
                        max={myActions.maxBetOrRaiseToCents}
                        step={Math.max(1, Math.min(table.smallBlindCents, myActions.maxBetOrRaiseToCents - myActions.minBetOrRaiseToCents))}
                        value={raiseTargetCents}
                        onChange={e => setRaiseTargetCents(Number(e.target.value))}
                        className={`${styles.rangeGold} min-w-[110px] flex-1`}
                      />
                      <span className="min-w-[3.8rem] text-right text-sm font-extrabold tabular-nums text-amber-300">
                        {formatChips(raiseTargetCents)}
                      </span>
                    </div>
                  )}

                {/* Tactile Primary Action Buttons */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runMutation(() =>
                        productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
                          method: "POST",
                          body: { handId: hand.handId, action: "fold" },
                        }),
                      )
                    }
                    className="inline-flex h-11 min-w-[92px] items-center justify-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-950/70 px-4 text-sm font-bold text-rose-100 transition hover:bg-rose-900/90 disabled:opacity-45"
                  >
                    {tx("弃牌", "Fold")}
                    <kbd className="rounded bg-white/10 px-1 text-[10px] font-normal opacity-75">F</kbd>
                  </button>

                  {myActions.canCheck && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runMutation(() =>
                          productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
                            method: "POST",
                            body: { handId: hand.handId, action: "check" },
                          }),
                        )
                      }
                      className="inline-flex h-11 min-w-[110px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-5 text-sm font-bold text-white shadow-lg shadow-emerald-950/50 transition hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-45"
                    >
                      {tx("过牌", "Check")}
                      <kbd className="rounded bg-black/20 px-1 text-[10px] font-normal">C</kbd>
                    </button>
                  )}

                  {myActions.canCall && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runMutation(() =>
                          productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
                            method: "POST",
                            body: { handId: hand.handId, action: "call" },
                          }),
                        )
                      }
                      className="inline-flex h-11 min-w-[130px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-sky-500 to-blue-600 px-5 text-sm font-bold text-white shadow-lg shadow-blue-950/50 transition hover:from-sky-400 hover:to-blue-500 disabled:opacity-45"
                    >
                      <span>{tx("跟注", "Call")} {formatChips(myActions.callAmountCents)}</span>
                      <kbd className="rounded bg-black/20 px-1 text-[10px] font-normal">C</kbd>
                    </button>
                  )}

                  {(myActions.canBet || myActions.canRaise) &&
                    myActions.minBetOrRaiseToCents !== null &&
                    myActions.maxBetOrRaiseToCents !== null && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runMutation(() =>
                            productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
                              method: "POST",
                              body: {
                                handId: hand.handId,
                                action: myActions.canBet ? "bet" : "raise",
                                amountCents: raiseTargetCents,
                              },
                            }),
                          )
                        }
                        className="inline-flex h-11 min-w-[140px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-5 text-sm font-extrabold text-slate-950 shadow-lg shadow-amber-500/25 transition hover:from-amber-300 hover:to-amber-400 disabled:opacity-45"
                      >
                        <span>
                          {raiseTargetCents >= myActions.maxBetOrRaiseToCents
                            ? `${tx("全下", "All-in")} ${formatChips(myActions.maxBetOrRaiseToCents)}`
                            : myActions.canBet
                              ? `${tx("下注", "Bet")} ${formatChips(raiseTargetCents)}`
                              : `${tx("加注到", "Raise")} ${formatChips(raiseTargetCents)}`}
                        </span>
                        <kbd className="rounded bg-black/15 px-1 text-[10px] font-semibold">R</kbd>
                      </button>
                    )}

                  {!(myActions.canBet || myActions.canRaise) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runMutation(() =>
                          productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
                            method: "POST",
                            body: { handId: hand.handId, action: "all_in" },
                          }),
                        )
                      }
                      className="inline-flex h-11 items-center justify-center rounded-xl border border-amber-400/50 bg-amber-500/20 px-4 text-sm font-bold text-amber-200 transition hover:bg-amber-500/30 disabled:opacity-45"
                    >
                      {tx("全下", "All-in")} {formatChips(myActions.playerStreetBetCents + myActions.playerStackCents)}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-slate-300">
                {canSit ? (
                  <button
                    type="button"
                    disabled={busy || allowance.remainingBuyIns <= 0 || !wallet.walletEligible}
                    onClick={openBuyInDialog}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 px-5 text-sm font-bold text-slate-950 shadow-md transition hover:from-amber-300 hover:to-amber-400 disabled:opacity-45"
                  >
                    <Plus size={15} /> {tx("入座买入", "Sit & Buy In")}
                  </button>
                ) : mySeat?.stackCents === 0 ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={openRebuyDialog}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-5 text-sm font-bold text-white shadow-md transition hover:from-emerald-400 hover:to-emerald-500"
                  >
                    <Plus size={15} /> {tx("筹码已空 · 立即补码", "Stack empty · Rebuy")}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-xs text-slate-300">
                    {hand && !hand.finished
                      ? botIsActing
                        ? tx(`${actingSeatSlot?.displayName ?? "AI"} 正在思考…`, `${actingSeatSlot?.displayName ?? "AI"} is thinking…`)
                        : tx("等待其他玩家行动…", "Waiting for other players…")
                      : tx("准备开始下一手…", "Preparing next hand…")}
                  </span>
                )}
              </div>
            )}
          </div>
        </footer>
      </section>

      {/* Buy-in Dialog with Instant Table Mode Selector */}
      <Dialog open={buyInOpen} onOpenChange={setBuyInOpen}>
        <DialogContent>
          <DialogTitle>{tx("入座买入筹码", "Buy In & Take Seat")}</DialogTitle>
          <DialogDescription>
            {tx(
              `本次入座将消耗 1 次买入机会（当前剩余 ${allowance.remainingBuyIns} 次）。`,
              `Consumes 1 buy-in allowance (${allowance.remainingBuyIns} remaining).`,
            )}
          </DialogDescription>
          {allowance.remainingBuyIns <= 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              {tx(
                `买入机会已用完，再 AC ${allowance.missingForNextBatch} 道新题即可解锁下 ${allowance.buyinsPerBatch} 次买入机会。`,
                `No buy-in allowances left. Solve ${allowance.missingForNextBatch} more distinct problem(s) to unlock ${allowance.buyinsPerBatch} more buy-ins.`,
              )}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              {/* Instant AI Opponents Option */}
              {table.allowBots && table.maxBotsPerTable > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {tx("人数不足时自动补位（无需苦等凑满 6 人）", "Instant AI opponents (play immediately)")}
                  </span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { count: 0, label: tx("仅等真人", "Humans only") },
                      { count: 1, label: tx("1v1 单挑", "1v1 (+1 AI)") },
                      { count: 3, label: tx("四人桌", "4-Max (+3 AI)") },
                      { count: 5, label: tx("六人桌", "6-Max (+5 AI)") },
                    ]
                      .filter(opt => opt.count <= table.maxBotsPerTable && opt.count <= table.maxSeats - 1)
                      .map(opt => (
                        <button
                          key={opt.count}
                          type="button"
                          onClick={() => setBuyInFillBots(opt.count)}
                          className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${
                            buyInFillBots === opt.count
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium">{tx("买入金额（奖学金）", "Buy-in amount (scholarship)")}</span>
                  <strong className="text-base tabular-nums text-primary">{formatChips(buyInCents)}</strong>
                </div>
                <input
                  type="range"
                  min={table.minBuyInCents}
                  max={Math.max(table.minBuyInCents, Math.min(table.maxBuyInCents, wallet.totalAvailableCents))}
                  step={table.bigBlindCents}
                  value={buyInCents}
                  onChange={e => setBuyInCents(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{formatChips(table.minBuyInCents)}</span>
                  <span>{formatChips(table.maxBuyInCents)}</span>
                </div>
              </div>

              {(() => {
                const fp = fundingPreview(buyInCents);
                return (
                  <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                    <p>
                      {tx("优先抵扣扑克零头余额：", "From poker chip remainder: ")}
                      <strong className="tabular-nums">{formatChips(fp.fromPoker)}</strong>
                    </p>
                    <p>
                      {tx("从平台钱包扣除整数奖学金：", "Debit from platform wallet: ")}
                      <strong className="tabular-nums">{fp.scholarshipNeeded}</strong> {tx("奖学金", "scholarship")}
                    </p>
                    {fp.changeToPoker > 0 && (
                      <p className="text-muted-foreground">
                        {tx(
                          `多余零头 ${formatChips(fp.changeToPoker)} 暂存扑克账户，离桌凑满 1 奖学金自动兑回。`,
                          `${formatChips(fp.changeToPoker)} stays in poker chip balance and auto-settles when whole.`,
                        )}
                      </p>
                    )}
                    {daily.buyInRemainingCents !== null && (
                      <p className="text-muted-foreground">
                        {tx(
                          `今日剩余可买入额度：${formatChips(daily.buyInRemainingCents)} 奖学金`,
                          `Daily buy-in remaining: ${formatChips(daily.buyInRemainingCents)}`,
                        )}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBuyInOpen(false)}>
              {tx("取消", "Cancel")}
            </Button>
            <Button
              disabled={
                busy ||
                allowance.remainingBuyIns <= 0 ||
                !wallet.walletEligible ||
                wallet.totalAvailableCents < table.minBuyInCents
              }
              onClick={() => {
                setBuyInOpen(false);
                void runMutation(
                  () =>
                    productionApi<PokerTableView>(`practice/poker/tables/${tableId}/join`, {
                      method: "POST",
                      body: { buyInCents, fillBots: buyInFillBots },
                    }),
                  buyInFillBots > 0
                    ? tx("入座成功，牌局已开始！", "Seated — hand dealt!")
                    : tx("入座成功！", "Seated at table!"),
                );
              }}
            >
              {tx("确认入座开玩", "Confirm & Play")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rebuy Dialog */}
      <Dialog open={rebuyOpen} onOpenChange={setRebuyOpen}>
        <DialogContent>
          <DialogTitle>{tx("补充桌上筹码", "Rebuy Chips")}</DialogTitle>
          <DialogDescription>
            {tx(
              `补充筹码将消耗 1 次买入机会（当前剩余 ${allowance.remainingBuyIns} 次）。`,
              `Rebuying consumes 1 buy-in allowance (${allowance.remainingBuyIns} remaining).`,
            )}
          </DialogDescription>
          {allowance.remainingBuyIns <= 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              {tx(
                `买入机会已用完，再 AC ${allowance.missingForNextBatch} 道新题即可解锁下 ${allowance.buyinsPerBatch} 次买入机会。`,
                `No buy-in allowances left. Solve ${allowance.missingForNextBatch} more distinct problem(s) to unlock ${allowance.buyinsPerBatch} more buy-ins.`,
              )}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span>{tx("补充金额", "Rebuy amount")}</span>
                <strong className="tabular-nums text-primary">{formatChips(rebuyCents)}</strong>
              </div>
              <input
                type="range"
                min={rebuyMinAdd}
                max={Math.max(rebuyMinAdd, Math.min(rebuyMaxAdd, wallet.totalAvailableCents))}
                step={table.smallBlindCents}
                value={rebuyCents}
                onChange={e => setRebuyCents(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{formatChips(rebuyMinAdd)}</span>
                <span>{formatChips(rebuyMaxAdd)}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRebuyOpen(false)}>
              {tx("取消", "Cancel")}
            </Button>
            <Button
              disabled={busy || allowance.remainingBuyIns <= 0 || rebuyCents < rebuyMinAdd}
              onClick={() => {
                setRebuyOpen(false);
                void runMutation(
                  () =>
                    productionApi<PokerTableView>(`practice/poker/tables/${tableId}/rebuy`, {
                      method: "POST",
                      body: { amountCents: rebuyCents },
                    }),
                  tx("筹码补充成功！", "Chips added!"),
                );
              }}
            >
              {tx("确认补码", "Confirm rebuy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
