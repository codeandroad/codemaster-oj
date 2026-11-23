"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Coins, LogOut, Plus, RefreshCw, ShieldAlert, Ticket, Trophy } from "lucide-react";
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
import { CardBack, EmptyCardSlot, PlayingCard } from "./poker-cards";
import {
  formatChips,
  formatSignedChips,
  notifyScholarshipChanged,
  type PokerSeatSlot,
  type PokerTableView,
} from "./poker-types";

// Seat anchor positions around a 6-max oval table (index 0 = bottom center, clockwise).
const SEAT_POSITIONS: Record<number, string[]> = {
  2: [
    "bottom-2 left-1/2 -translate-x-1/2",
    "top-2 left-1/2 -translate-x-1/2",
  ],
  3: [
    "bottom-2 left-1/2 -translate-x-1/2",
    "top-4 left-4",
    "top-4 right-4",
  ],
  4: [
    "bottom-2 left-1/2 -translate-x-1/2",
    "top-1/2 left-2 -translate-y-1/2",
    "top-2 left-1/2 -translate-x-1/2",
    "top-1/2 right-2 -translate-y-1/2",
  ],
  5: [
    "bottom-2 left-1/2 -translate-x-1/2",
    "bottom-12 left-2",
    "top-3 left-8",
    "top-3 right-8",
    "bottom-12 right-2",
  ],
  6: [
    "bottom-2 left-1/2 -translate-x-1/2",
    "bottom-14 left-2",
    "top-4 left-6",
    "top-2 left-1/2 -translate-x-1/2",
    "top-4 right-6",
    "bottom-14 right-2",
  ],
};

function streetLabel(street: string, locale: string) {
  const map: Record<string, [string, string]> = {
    preflop: ["翻牌前", "Preflop"],
    flop: ["翻牌圈", "Flop"],
    turn: ["转牌圈", "Turn"],
    river: ["河牌圈", "River"],
    showdown: ["摊牌结算", "Showdown"],
  };
  const pair = map[street] ?? [street, street];
  return locale === "en" ? pair[1] : pair[0];
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

  const [buyInSeat, setBuyInSeat] = useState<number | null>(null);
  const [buyInCents, setBuyInCents] = useState(0);
  const [rebuyOpen, setRebuyOpen] = useState(false);
  const [rebuyCents, setRebuyCents] = useState(0);
  const [raiseTargetCents, setRaiseTargetCents] = useState(0);
  const [sideTab, setSideTab] = useState<"log" | "history">("log");

  const revisionRef = useRef<number | null>(null);
  const lastWalletRef = useRef<number | null>(null);

  const applyView = useCallback((next: PokerTableView) => {
    if (next.serverTime) {
      const serverMs = Date.parse(next.serverTime);
      if (Number.isFinite(serverMs)) setClockOffsetMs(serverMs - Date.now());
    }
    if (next.unchanged) return;
    revisionRef.current = next.table.revision;
    if (
      lastWalletRef.current !== null &&
      lastWalletRef.current !== next.wallet.scholarshipBalance
    ) {
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

  // Initial load + live polling every 1.2s when visible.
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
    const interval = setInterval(() => void load(false), 1200);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchTable]);

  // Smooth local 250ms tick for turn countdown timer & next-hand countdown.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Sync default raise slider value whenever it becomes our turn.
  const myActions = view?.hand?.myActions ?? null;
  useEffect(() => {
    if (myActions?.minBetOrRaiseToCents != null) {
      setRaiseTargetCents(myActions.minBetOrRaiseToCents);
    }
  }, [myActions?.minBetOrRaiseToCents, view?.hand?.handId, view?.hand?.street, view?.hand?.currentBetCents]);

  async function runMutation(fn: () => Promise<PokerTableView>, okMsg?: string) {
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
  }

  function openBuyIn(seatIndex: number) {
    if (!view) return;
    const min = view.table.minBuyInCents;
    const max = Math.min(view.table.maxBuyInCents, view.wallet.totalAvailableCents);
    const defaultAmt = Math.max(min, Math.min(max, Math.round((min + view.table.maxBuyInCents) / 2)));
    setBuyInSeat(seatIndex);
    setBuyInCents(defaultAmt);
  }

  function openRebuy() {
    if (!view?.mySeat) return;
    const maxAdd = view.table.maxBuyInCents - view.mySeat.stackCents;
    const minAdd = view.mySeat.stackCents === 0
      ? Math.min(maxAdd, view.table.minBuyInCents)
      : Math.min(maxAdd, view.table.bigBlindCents);
    const clampedMax = Math.min(maxAdd, view.wallet.totalAvailableCents);
    setRebuyCents(Math.max(minAdd, Math.min(clampedMax, maxAdd)));
    setRebuyOpen(true);
  }

  // Rotate seats so viewer's seat (if seated) is always at anchor 0 (bottom center).
  const arrangedSeats = useMemo(() => {
    if (!view) return [] as Array<{ slot: PokerSeatSlot; positionClass: string }>;
    const count = view.seats.length;
    const positions = SEAT_POSITIONS[count] ?? SEAT_POSITIONS[6];
    const myIdx = view.mySeat ? view.mySeat.seatIndex : 0;
    return view.seats.map((_, offset) => {
      const seatIndex = (myIdx + offset) % count;
      const slot = view.seats[seatIndex];
      return { slot, positionClass: positions[offset] ?? positions[0] };
    });
  }, [view]);

  const effectiveNow = nowMs + clockOffsetMs;
  const turnSecondsLeft = view?.hand?.turnDeadlineAt
    ? Math.max(0, Math.ceil((Date.parse(view.hand.turnDeadlineAt) - effectiveNow) / 1000))
    : null;
  const nextHandSecondsLeft = view?.table.status === "showdown" && view.table.nextHandAt
    ? Math.max(0, Math.ceil((Date.parse(view.table.nextHandAt) - effectiveNow) / 1000))
    : null;

  const winningCardSet = useMemo(() => {
    const s = new Set<string>();
    const revealed = view?.hand?.showdownResult?.revealedHands ?? [];
    const winnerSeats = new Set((view?.hand?.showdownResult?.awards ?? []).map(a => a.seatIndex));
    for (const r of revealed) {
      if (winnerSeats.has(r.seatIndex)) {
        for (const c of r.bestCards) s.add(c);
      }
    }
    return s;
  }, [view?.hand?.showdownResult]);

  if (!view) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft size={15} /> {tx("返回大厅", "Back to lobby")}
        </Button>
        {error ? (
          <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
            {error}
          </div>
        ) : (
          <p role="status" className="rounded-lg border border-border bg-surface p-6 text-sm text-muted-foreground">
            {tx("正在连接牌桌…", "Connecting to table…")}
          </p>
        )}
      </div>
    );
  }

  const { table, hand, mySeat, allowance, wallet, daily } = view;
  const canSit = !mySeat && table.enabled;
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

  return (
    <div className="space-y-4">
      {/* Top table bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ArrowLeft size={15} /> {tx("大厅", "Lobby")}
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{table.name}</h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                SB/BB {formatChips(table.smallBlindCents)} / {formatChips(table.bigBlindCents)}
              </span>
              {table.handNumber > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  #{table.handNumber}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tx("买入范围", "Buy-in")}: {formatChips(table.minBuyInCents)} – {formatChips(table.maxBuyInCents)} {tx("奖学金", "scholarship")} · {tx("0% 抽水", "0% rake")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-medium tabular-nums">
            <Ticket size={14} className="text-primary" />
            {tx("买入机会", "Buy-ins")}: <strong>{allowance.remainingBuyIns}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-medium tabular-nums">
            <Coins size={14} className="text-amber-500" />
            {tx("钱包", "Wallet")}: <strong>{wallet.scholarshipBalance}</strong>
            {wallet.pokerBalanceCents > 0 && (
              <span className="text-muted-foreground">(+{formatChips(wallet.pokerBalanceCents)})</span>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void fetchTable(true)}
            aria-label={tx("刷新牌桌", "Refresh table")}
          >
            <RefreshCw size={14} />
          </Button>
          {mySeat?.canRebuy && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={openRebuy}>
              <Plus size={14} /> {tx("补充筹码", "Rebuy")}
            </Button>
          )}
          {mySeat && (
            mySeat.inActiveHand ? (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant={mySeat.leaveAfterHand ? "primary" : "secondary"}
                  disabled={busy}
                  onClick={() =>
                    void runMutation(
                      () =>
                        productionApi<PokerTableView>(`practice/poker/tables/${tableId}/leave`, {
                          method: "POST",
                          body: { cancel: mySeat.leaveAfterHand },
                        }),
                      mySeat.leaveAfterHand
                        ? tx("已取消本局后离桌", "Cancelled leave after hand")
                        : tx("已预约本局结束后自动离桌并兑回筹码", "Will leave and cash out after this hand"),
                    )
                  }
                >
                  <LogOut size={14} />
                  {mySeat.leaveAfterHand ? tx("取消本局后离桌", "Stay next hand") : tx("本局后离桌", "Leave after hand")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void runMutation(
                      () =>
                        productionApi<PokerTableView>(`practice/poker/tables/${tableId}/leave`, {
                          method: "POST",
                          body: { immediate: true },
                        }),
                      tx("已弃牌离桌并结算筹码", "Folded, left table, and cashed out"),
                    )
                  }
                >
                  {tx("弃牌立离", "Fold & leave")}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void runMutation(
                    () =>
                      productionApi<PokerTableView>(`practice/poker/tables/${tableId}/leave`, {
                        method: "POST",
                        body: {},
                      }),
                    tx("已离桌，整数奖学金已自动兑回平台钱包", "Left table; whole scholarships cashed out to wallet"),
                  )
                }
              >
                <LogOut size={14} /> {tx("离桌兑回", "Leave & cash out")}
              </Button>
            )
          )}
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
      {!wallet.walletEligible && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          <ShieldAlert size={16} />
          {tx("请先在开放平台「设置」中开启奖学金钱包后再入座买入。", "Enable your Open Platform scholarship wallet in Settings before buying in.")}
        </div>
      )}

      {/* Main layout: Felt Table + Side Info */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {/* Felt Table Canvas */}
          <div className="relative mx-auto min-h-[470px] w-full overflow-hidden rounded-2xl border border-emerald-950/60 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-4 shadow-inner sm:min-h-[520px] sm:p-6">
            {/* Inner oval emerald felt */}
            <div className="pointer-events-none absolute inset-x-8 inset-y-12 rounded-[999px] border-[10px] border-amber-950/80 bg-[radial-gradient(ellipse_at_center,#116b45_0%,#0b4d32_68%,#073623_100%)] shadow-[inset_0_0_40px_rgba(0,0,0,0.45)] sm:inset-x-14 sm:inset-y-16" />
            <div className="pointer-events-none absolute inset-x-12 inset-y-16 rounded-[999px] border border-emerald-300/20 sm:inset-x-20 sm:inset-y-20" />

            {/* Center felt: Pot, Community Cards, Showdown / Waiting Banner */}
            <div className="absolute left-1/2 top-1/2 z-10 flex w-[min(90%,24rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2.5 text-center">
              {hand ? (
                <>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="rounded-full bg-black/45 px-2.5 py-0.5 text-[11px] font-medium text-emerald-100 backdrop-blur-xs">
                      {streetLabel(hand.street, locale)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-950/70 px-3 py-0.5 text-xs font-bold tabular-nums text-amber-200 shadow-xs">
                      {tx("底池", "Pot")}: {formatChips(hand.potCents)}
                    </span>
                  </div>

                  {/* Side pots indicator if multiple pots */}
                  {hand.pots.length > 1 && (
                    <div className="flex flex-wrap justify-center gap-1.5 text-[11px] text-emerald-100/90">
                      {hand.pots.map((pot, idx) => (
                        <span key={idx} className="rounded bg-black/35 px-2 py-0.5 tabular-nums">
                          {idx === 0 ? tx("主池", "Main") : `${tx("边池", "Side")} ${idx}`}: {formatChips(pot.amountCents)}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 5 Community Cards */}
                  <div className="flex items-center justify-center gap-1.5 sm:gap-2">
                    {Array.from({ length: 5 }, (_, idx) => {
                      const card = hand.communityCards[idx];
                      return card ? (
                        <PlayingCard
                          key={card}
                          card={card}
                          size="md"
                          highlight={hand.finished && winningCardSet.has(card)}
                        />
                      ) : (
                        <EmptyCardSlot key={idx} size="md" />
                      );
                    })}
                  </div>

                  {/* Showdown Winner Banner */}
                  {hand.finished && hand.showdownResult && (
                    <div className="mt-1 rounded-lg border border-amber-400/50 bg-black/75 px-3 py-2 text-xs text-amber-100 shadow-md backdrop-blur-xs">
                      <div className="flex flex-wrap items-center justify-center gap-1.5 font-semibold">
                        <Trophy size={14} className="text-amber-400" />
                        {hand.showdownResult.awards.map((a, idx) => (
                          <span key={idx}>
                            {a.displayName} +{formatChips(a.amountCents)}
                            {a.handLabelZh && ` (${locale === "en" ? a.handLabelEn : a.handLabelZh})`}
                          </span>
                        ))}
                      </div>
                      {nextHandSecondsLeft !== null && (
                        <p className="mt-0.5 text-[11px] text-emerald-200/80 tabular-nums">
                          {tx(`${nextHandSecondsLeft} 秒后自动开始下一局…`, `Next hand in ${nextHandSecondsLeft}s…`)}
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-emerald-200/20 bg-black/45 px-4 py-3 text-emerald-50 backdrop-blur-xs">
                  <p className="text-sm font-semibold">
                    {tx("等待玩家入座开局", "Waiting for players")}
                  </p>
                  <p className="mt-1 text-xs text-emerald-200/80">
                    {tx("至少 2 名持有筹码的玩家就座后自动发牌", "Cards deal automatically once 2+ funded players are seated")}
                  </p>
                  {canSit && (
                    <Button
                      size="sm"
                      className="mt-2.5"
                      disabled={busy || allowance.remainingBuyIns <= 0}
                      onClick={() => {
                        const empty = view.seats.find(s => !s.occupied);
                        if (empty) openBuyIn(empty.seatIndex);
                      }}
                    >
                      <Plus size={14} /> {tx("快速入座", "Quick sit")}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* 6 Seats */}
            {arrangedSeats.map(({ slot, positionClass }) => {
              if (!slot.occupied) {
                return (
                  <div key={slot.seatIndex} className={`absolute z-20 ${positionClass}`}>
                    {canSit ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openBuyIn(slot.seatIndex)}
                        className="flex min-w-[104px] flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300/40 bg-black/45 px-3 py-2 text-xs text-emerald-100 transition hover:border-emerald-300 hover:bg-black/65"
                      >
                        <span className="font-semibold">+ {tx("入座", "Sit")}</span>
                        <span className="text-[10px] text-emerald-200/70">
                          {tx(`座位 ${slot.seatIndex + 1}`, `Seat ${slot.seatIndex + 1}`)}
                        </span>
                      </button>
                    ) : (
                      <div className="flex min-w-[96px] flex-col items-center justify-center rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-slate-400">
                        {slot.leftMidHand ? (
                          <span>{slot.displayName} ({tx("已离桌", "Left")})</span>
                        ) : (
                          <span>{tx(`空位 ${slot.seatIndex + 1}`, `Empty ${slot.seatIndex + 1}`)}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              const isActing = Boolean(slot.isActing && !hand?.finished);
              return (
                <div key={slot.seatIndex} className={`absolute z-20 ${positionClass}`}>
                  <div
                    className={`flex min-w-[138px] max-w-[175px] flex-col items-center rounded-xl border px-2.5 py-2 text-white shadow-lg backdrop-blur-xs transition ${
                      isActing
                        ? "border-amber-400 bg-slate-900/95 ring-2 ring-amber-400/70"
                        : slot.isMe
                          ? "border-sky-400/70 bg-slate-900/90"
                          : "border-white/15 bg-slate-950/85"
                    } ${slot.folded ? "opacity-60" : ""}`}
                  >
                    {/* Cards above/inside seat */}
                    {(slot.holeCards || (slot.cardCount ?? 0) > 0) && (
                      <div className="-mt-6 mb-1 flex items-center gap-1">
                        {slot.holeCards ? (
                          slot.holeCards.map(c => (
                            <PlayingCard
                              key={c}
                              card={c}
                              size={slot.isMe ? "sm" : "xs"}
                              highlight={Boolean(hand?.finished && winningCardSet.has(c))}
                              dimmed={slot.folded}
                            />
                          ))
                        ) : (
                          Array.from({ length: slot.cardCount ?? 0 }, (_, idx) => (
                            <CardBack key={idx} size="xs" />
                          ))
                        )}
                      </div>
                    )}

                    {/* Avatar + Name + Stack */}
                    <div className="flex w-full items-center gap-2">
                      <div className="size-7 shrink-0 overflow-hidden rounded-full ring-1 ring-white/20">
                        <ProfileAvatar avatar={slot.avatar} nickname={slot.displayName ?? ""} />
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-xs font-semibold leading-tight">
                          {slot.displayName}
                          {slot.isMe && (
                            <span className="ml-1 rounded bg-sky-500/25 px-1 text-[10px] text-sky-200">
                              {tx("我", "You")}
                            </span>
                          )}
                        </p>
                        <p className="text-xs font-bold tabular-nums text-amber-300">
                          {formatChips(slot.stackCents ?? 0)}
                        </p>
                      </div>
                    </div>

                    {/* Position & Action Badges */}
                    <div className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[10px]">
                      {slot.isDealer && (
                        <span className="rounded-full bg-amber-400 px-1.5 py-0.2 font-bold text-slate-950">D</span>
                      )}
                      {slot.isSmallBlind && (
                        <span className="rounded bg-indigo-500/80 px-1 font-semibold">SB</span>
                      )}
                      {slot.isBigBlind && (
                        <span className="rounded bg-purple-500/80 px-1 font-semibold">BB</span>
                      )}
                      {(slot.streetBetCents ?? 0) > 0 && (
                        <span className="rounded-full bg-emerald-600/90 px-1.5 font-semibold tabular-nums text-white">
                          {formatChips(slot.streetBetCents ?? 0)}
                        </span>
                      )}
                      {slot.allIn && (
                        <span className="rounded bg-red-600 px-1 font-bold uppercase">ALL-IN</span>
                      )}
                      {slot.sittingOut && (
                        <span className="rounded bg-slate-600 px-1">{tx("暂离", "Sit out")}</span>
                      )}
                      {slot.leaveAfterHand && (
                        <span className="rounded bg-amber-600/80 px-1">{tx("局后离", "Leaving")}</span>
                      )}
                    </div>

                    {slot.lastAction && (
                      <p className="mt-0.5 max-w-full truncate text-[10px] text-slate-300">
                        {slot.lastAction}
                      </p>
                    )}

                    {/* Acting countdown bar */}
                    {isActing && turnSecondsLeft !== null && (
                      <div className="mt-1 w-full">
                        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-700">
                          <div
                            className={`h-full transition-all duration-200 ${
                              turnSecondsLeft <= 5 ? "bg-red-500" : "bg-amber-400"
                            }`}
                            style={{
                              width: `${Math.min(100, (turnSecondsLeft / table.turnTimeoutSeconds) * 100)}%`,
                            }}
                          />
                        </div>
                        <p className="mt-0.5 text-center text-[10px] font-semibold tabular-nums text-amber-300">
                          {tx(`思考中 ${turnSecondsLeft}s`, `Acting ${turnSecondsLeft}s`)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Controls Bar */}
          {mySeat && (
            <div className="rounded-xl border border-border bg-surface p-4">
              {myActions && hand && !hand.finished ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
                      <strong className="font-semibold">{tx("轮到你行动", "Your turn")}</strong>
                      {hand.myHandLabel && (
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                          {tx("当前牌型：", "Hand: ")}
                          {locale === "en" ? hand.myHandLabel.en : hand.myHandLabel.zh}
                        </span>
                      )}
                    </div>
                    {turnSecondsLeft !== null && (
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          turnSecondsLeft <= 5 ? "text-danger" : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {tx(`剩余 ${turnSecondsLeft} 秒`, `${turnSecondsLeft}s left`)}
                      </span>
                    )}
                  </div>

                  {/* Primary Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void runMutation(() =>
                          productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
                            method: "POST",
                            body: { handId: hand.handId, action: "fold" },
                          }),
                        )
                      }
                    >
                      {tx("弃牌", "Fold")}
                    </Button>

                    {myActions.canCheck && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void runMutation(() =>
                            productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
                              method: "POST",
                              body: { handId: hand.handId, action: "check" },
                            }),
                          )
                        }
                      >
                        {tx("过牌", "Check")}
                      </Button>
                    )}

                    {myActions.canCall && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void runMutation(() =>
                            productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
                              method: "POST",
                              body: { handId: hand.handId, action: "call" },
                            }),
                          )
                        }
                      >
                        {tx("跟注", "Call")} {formatChips(myActions.callAmountCents)}
                      </Button>
                    )}

                    {(myActions.canBet || myActions.canRaise) &&
                      myActions.minBetOrRaiseToCents !== null &&
                      myActions.maxBetOrRaiseToCents !== null && (
                        <Button
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
                        >
                          {raiseTargetCents >= myActions.maxBetOrRaiseToCents
                            ? `${tx("全下", "All-in")} ${formatChips(myActions.maxBetOrRaiseToCents)}`
                            : myActions.canBet
                              ? `${tx("下注", "Bet")} ${formatChips(raiseTargetCents)}`
                              : `${tx("加注到", "Raise to")} ${formatChips(raiseTargetCents)}`}
                        </Button>
                      )}

                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void runMutation(() =>
                          productionApi<PokerTableView>(`practice/poker/tables/${tableId}/action`, {
                            method: "POST",
                            body: { handId: hand.handId, action: "all_in" },
                          }),
                        )
                      }
                    >
                      {tx("全下", "All-in")} ({formatChips(myActions.playerStreetBetCents + myActions.playerStackCents)})
                    </Button>
                  </div>

                  {/* Bet/Raise Slider + Quick Pot Presets */}
                  {(myActions.canBet || myActions.canRaise) &&
                    myActions.minBetOrRaiseToCents !== null &&
                    myActions.maxBetOrRaiseToCents !== null &&
                    myActions.maxBetOrRaiseToCents > myActions.minBetOrRaiseToCents && (
                      <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {[
                            { label: tx("最小", "Min"), value: myActions.minBetOrRaiseToCents },
                            {
                              label: tx("1/2 底池", "1/2 Pot"),
                              value: Math.round(myActions.currentBetCents + myActions.potCents * 0.5),
                            },
                            {
                              label: tx("3/4 底池", "3/4 Pot"),
                              value: Math.round(myActions.currentBetCents + myActions.potCents * 0.75),
                            },
                            {
                              label: tx("底池", "Pot"),
                              value: Math.round(myActions.currentBetCents + myActions.potCents),
                            },
                            { label: tx("全下", "All-in"), value: myActions.maxBetOrRaiseToCents },
                          ].map(preset => {
                            const clamped = Math.max(
                              myActions.minBetOrRaiseToCents!,
                              Math.min(myActions.maxBetOrRaiseToCents!, preset.value),
                            );
                            return (
                              <button
                                key={preset.label}
                                type="button"
                                onClick={() => setRaiseTargetCents(clamped)}
                                className="rounded border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-accent"
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            aria-label={tx("下注金额", "Bet amount")}
                            min={myActions.minBetOrRaiseToCents}
                            max={myActions.maxBetOrRaiseToCents}
                            step={Math.max(1, Math.min(table.smallBlindCents, myActions.maxBetOrRaiseToCents - myActions.minBetOrRaiseToCents))}
                            value={raiseTargetCents}
                            onChange={e => setRaiseTargetCents(Number(e.target.value))}
                            className="flex-1 accent-primary"
                          />
                          <span className="min-w-[4.5rem] text-right text-sm font-bold tabular-nums">
                            {formatChips(raiseTargetCents)}
                          </span>
                        </div>
                      </div>
                    )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      {mySeat.stackCents === 0
                        ? tx("你的桌上筹码已归零，请点击上方「补充筹码」或「离桌兑回」。", "Your stack is empty. Rebuy or leave the table.")
                        : hand && !hand.finished
                          ? tx("等待其他玩家行动…", "Waiting for other players to act…")
                          : tx("等待下一局开始…", "Waiting for the next hand…")}
                    </span>
                    {hand?.myHandLabel && (
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                        {locale === "en" ? hand.myHandLabel.en : hand.myHandLabel.zh}
                      </span>
                    )}
                  </div>
                  <span className="text-xs tabular-nums">
                    {tx("今日净输赢：", "Today net: ")}
                    <strong className={daily.netCents > 0 ? "text-success" : daily.netCents < 0 ? "text-danger" : ""}>
                      {formatSignedChips(daily.netCents)}
                    </strong>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel: Action Log & Recent Hands */}
        <aside className="flex flex-col rounded-xl border border-border bg-surface">
          <div className="flex border-b border-border">
            <button
              type="button"
              onClick={() => setSideTab("log")}
              className={`flex-1 px-3 py-2.5 text-xs font-semibold ${
                sideTab === "log" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
              }`}
            >
              {tx("本局动态", "Action log")}
            </button>
            <button
              type="button"
              onClick={() => setSideTab("history")}
              className={`flex-1 px-3 py-2.5 text-xs font-semibold ${
                sideTab === "history" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
              }`}
            >
              {tx("最近牌局", "Recent hands")} ({view.recentHands.length})
            </button>
          </div>
          <div className="max-h-[500px] flex-1 overflow-y-auto p-3 text-xs">
            {sideTab === "log" ? (
              hand?.actionLog?.length ? (
                <ul className="space-y-1.5">
                  {[...hand.actionLog].reverse().map((entry, idx) => (
                    <li key={idx} className="rounded-md bg-muted/40 px-2.5 py-1.5 leading-relaxed">
                      {locale === "en" ? entry.textEn : entry.textZh}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-muted-foreground">
                  {tx("暂无牌局动态", "No actions yet")}
                </p>
              )
            ) : view.recentHands.length ? (
              <ul className="space-y-2">
                {view.recentHands.map(h => (
                  <li key={h.id} className="rounded-lg border border-border p-2.5">
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span>#{h.handNumber}</span>
                      <span className="tabular-nums text-amber-600 dark:text-amber-400">
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
                    <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                      {h.awards.map((a, idx) => (
                        <p key={idx}>
                          <strong className="text-foreground">{a.displayName}</strong> +{formatChips(a.amountCents)}
                          {a.handLabelZh && ` · ${locale === "en" ? a.handLabelEn : a.handLabelZh}`}
                        </p>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-muted-foreground">
                {tx("暂无历史牌局", "No completed hands yet")}
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Buy-in Dialog */}
      <Dialog open={buyInSeat !== null} onOpenChange={open => { if (!open) setBuyInSeat(null); }}>
        <DialogContent>
          <DialogTitle>{tx("入座买入筹码", "Buy in & take seat")}</DialogTitle>
          <DialogDescription>
            {tx(
              `座位 ${(buyInSeat ?? 0) + 1} · 本次入座将消耗 1 次买入机会（当前剩余 ${allowance.remainingBuyIns} 次）。`,
              `Seat ${(buyInSeat ?? 0) + 1} · Consumes 1 buy-in allowance (${allowance.remainingBuyIns} remaining).`,
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
                      {tx("优先使用扑克零头余额：", "From poker chip balance: ")}
                      <strong className="tabular-nums">{formatChips(fp.fromPoker)}</strong>
                    </p>
                    <p>
                      {tx("从平台钱包扣除整数奖学金：", "Debit from platform wallet: ")}
                      <strong className="tabular-nums">{fp.scholarshipNeeded}</strong> {tx("奖学金", "scholarship")}
                    </p>
                    {fp.changeToPoker > 0 && (
                      <p className="text-muted-foreground">
                        {tx(`多余零头 ${formatChips(fp.changeToPoker)} 将保留在扑克账户中，离桌凑满 1 奖学金自动兑回。`,
                          `${formatChips(fp.changeToPoker)} change remains in your poker chip balance and auto-settles when whole.`)}
                      </p>
                    )}
                    {daily.buyInRemainingCents !== null && (
                      <p className="text-muted-foreground">
                        {tx(`今日剩余可买入额度：${formatChips(daily.buyInRemainingCents)} 奖学金`,
                          `Daily buy-in remaining: ${formatChips(daily.buyInRemainingCents)}`)}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBuyInSeat(null)}>
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
                const seatIdx = buyInSeat;
                setBuyInSeat(null);
                if (seatIdx === null) return;
                void runMutation(
                  () =>
                    productionApi<PokerTableView>(`practice/poker/tables/${tableId}/join`, {
                      method: "POST",
                      body: { seatIndex: seatIdx, buyInCents },
                    }),
                  tx("入座成功！", "Seated at table!"),
                );
              }}
            >
              {tx("确认入座买入", "Confirm buy-in")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rebuy Dialog */}
      <Dialog open={rebuyOpen} onOpenChange={setRebuyOpen}>
        <DialogContent>
          <DialogTitle>{tx("补充桌上筹码", "Rebuy chips")}</DialogTitle>
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
