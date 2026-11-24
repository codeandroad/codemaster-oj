export interface PokerSettings {
  enabled: boolean;
  initialUnlockAcProblems: number;
  acPerBuyinBatch: number;
  buyinsPerBatch: number;
  defaultSmallBlindCents: number;
  defaultBigBlindCents: number;
  minBuyInBb: number;
  maxBuyInBb: number;
  turnTimeoutSeconds: number;
  dailyBuyInLimitCents: number;
  dailyNetLossLimitCents: number;
  dailyNetWinLimitCents: number;
  allowBots: boolean;
  maxBotsPerTable: number;
  updatedAt?: string;
}

export interface PokerAllowance {
  acUnlocked: boolean;
  acCount: number;
  initialUnlockAcProblems: number;
  acPerBuyinBatch: number;
  buyinsPerBatch: number;
  missingForInitialUnlock: number;
  totalUnlockedBuyIns: number;
  usedBuyIns: number;
  remainingBuyIns: number;
  nextBatchAtAc: number;
  missingForNextBatch: number;
}

export interface PokerWalletSummary {
  scholarshipBalance: number;
  pokerBalanceCents: number;
  totalAvailableCents: number;
  walletEligible: boolean;
}

export interface PokerDailySummary {
  buyInCents: number;
  netCents: number;
  handsPlayed: number;
  buyInRemainingCents: number | null;
  lossRemainingCents: number | null;
  winRemainingCents: number | null;
  hitLossLimit: boolean;
  hitWinLimit: boolean;
}

export interface PokerTableSummary {
  id: string;
  name: string;
  smallBlindCents: number;
  bigBlindCents: number;
  useDefaultBlinds: boolean;
  maxSeats: number;
  enabled: boolean;
  revision: number;
  handNumber: number;
  status: "waiting" | "playing" | "showdown";
  humanCount: number;
  botCount: number;
  seatedCount: number;
  minBuyInCents: number;
  maxBuyInCents: number;
}

export interface PokerStatusResponse {
  enabled: boolean;
  unlocked: boolean;
  allowance: PokerAllowance;
  settings: PokerSettings;
  wallet: PokerWalletSummary;
  daily: PokerDailySummary;
  activeTableId: string | null;
  tables: PokerTableSummary[];
}

export interface PokerSeatSlot {
  seatIndex: number;
  occupied: boolean;
  leftMidHand?: boolean;
  isBot?: boolean;
  botStyle?: "tight" | "balanced" | "loose" | "aggressive" | null;
  accountId?: string | null;
  displayName?: string;
  avatar?: string;
  isMe?: boolean;
  stackCents?: number;
  sittingOut?: boolean;
  leaveAfterHand?: boolean;
  inHand?: boolean;
  isDealer?: boolean;
  isSmallBlind?: boolean;
  isBigBlind?: boolean;
  isActing?: boolean;
  streetBetCents?: number;
  totalBetCents?: number;
  folded?: boolean;
  allIn?: boolean;
  lastAction?: string | null;
  holeCards?: string[] | null;
  cardCount?: number;
}

export interface PokerLegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmountCents: number;
  canBet: boolean;
  canRaise: boolean;
  minBetOrRaiseToCents: number | null;
  maxBetOrRaiseToCents: number | null;
  currentBetCents: number;
  playerStreetBetCents: number;
  playerStackCents: number;
  potCents: number;
}

export interface PokerShowdownAward {
  seatIndex: number;
  accountId: string | null;
  displayName: string;
  amountCents: number;
  handLabelEn: string | null;
  handLabelZh: string | null;
}

export interface PokerShowdownResult {
  reason: "fold" | "showdown";
  totalPotCents: number;
  pots: Array<{ amountCents: number; eligibleSeats: number[]; winnerSeats: number[] }>;
  awards: PokerShowdownAward[];
  revealedHands: Array<{
    seatIndex: number;
    accountId: string | null;
    displayName: string;
    holeCards: string[];
    bestCards: string[];
    category: number;
    labelEn: string;
    labelZh: string;
  }>;
}

export interface PokerActionLogEntry {
  type: string;
  street: string;
  at: string;
  textZh: string;
  textEn: string;
}

export interface PokerHandView {
  handId: string;
  handNumber: number;
  street: "preflop" | "flop" | "turn" | "river" | "showdown";
  dealerSeat: number;
  sbSeat: number;
  bbSeat: number;
  smallBlindCents: number;
  bigBlindCents: number;
  communityCards: string[];
  potCents: number;
  pots: Array<{ amountCents: number; eligibleSeats: number[] }>;
  currentBetCents: number;
  minRaiseCents: number;
  actingSeat: number | null;
  turnDeadlineAt: string | null;
  finished: boolean;
  showdownResult: PokerShowdownResult | null;
  actionLog: PokerActionLogEntry[];
  myHandLabel: { en: string; zh: string } | null;
  myActions: PokerLegalActions | null;
}

export interface PokerRecentHand {
  id: string;
  handNumber: number;
  smallBlindCents: number;
  bigBlindCents: number;
  communityCards: string[];
  potCents: number;
  awards: PokerShowdownAward[];
  reason: string | null;
  endedAt: string;
}

export interface PokerTableView {
  unchanged: boolean;
  revision?: number;
  serverTime: string;
  table: {
    id: string;
    name: string;
    smallBlindCents: number;
    bigBlindCents: number;
    useDefaultBlinds: boolean;
    maxSeats: number;
    enabled: boolean;
    revision: number;
    handNumber: number;
    dealerSeat: number | null;
    status: "waiting" | "playing" | "showdown";
    nextHandAt: string | null;
    minBuyInCents: number;
    maxBuyInCents: number;
    turnTimeoutSeconds: number;
    allowBots: boolean;
    maxBotsPerTable: number;
    humanCount: number;
    botCount: number;
  };
  seats: PokerSeatSlot[];
  hand: PokerHandView | null;
  mySeat: {
    seatIndex: number;
    stackCents: number;
    sittingOut: boolean;
    leaveAfterHand: boolean;
    inActiveHand: boolean;
    canRebuy: boolean;
  } | null;
  allowance: PokerAllowance;
  wallet: PokerWalletSummary;
  daily: PokerDailySummary;
  recentHands: PokerRecentHand[];
}

export interface PokerLedgerEntry {
  id: string;
  deltaCents: number;
  balanceAfterCents: number;
  kind: "scholarship_deposit" | "scholarship_withdraw" | "table_buyin" | "table_rebuy" | "table_cashout";
  tableId: string | null;
  note: string;
  createdAt: string;
}

export function formatChips(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function formatSignedChips(cents: number): string {
  if (cents > 0) return `+${(cents / 100).toFixed(2)}`;
  if (cents < 0) return `-${(Math.abs(cents) / 100).toFixed(2)}`;
  return "0.00";
}

export function notifyScholarshipChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("campus-judge:scholarship-changed"));
  }
}
