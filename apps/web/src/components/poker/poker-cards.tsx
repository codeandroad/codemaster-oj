"use client";

import styles from "./poker-table.module.css";

const SUIT_META: Record<string, { symbol: string; colorClass: string; name: string }> = {
  s: { symbol: "♠", colorClass: "text-slate-900", name: "Spades" },
  h: { symbol: "♥", colorClass: "text-[#c81e1e]", name: "Hearts" },
  d: { symbol: "♦", colorClass: "text-[#c81e1e]", name: "Diamonds" },
  c: { symbol: "♣", colorClass: "text-slate-900", name: "Clubs" },
};

const RANK_DISPLAY: Record<string, string> = {
  T: "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};

const SIZE_CLASSES = {
  xs: {
    box: "h-9 w-[26px] rounded-[5px] px-0.5 py-0.5",
    corner: "text-[9px] leading-none",
    cornerSuit: "text-[8px] leading-none",
    center: "text-xs leading-none",
  },
  sm: {
    box: "h-12 w-9 rounded-md px-1 py-0.5",
    corner: "text-[11px] leading-none",
    cornerSuit: "text-[9px] leading-none",
    center: "text-base leading-none",
  },
  md: {
    box: "h-[78px] w-[56px] rounded-lg px-1.5 py-1",
    corner: "text-[13px] leading-none",
    cornerSuit: "text-[11px] leading-none",
    center: "text-[26px] leading-none",
  },
  lg: {
    box: "h-[92px] w-[66px] rounded-[10px] px-1.5 py-1.5",
    corner: "text-[15px] leading-none",
    cornerSuit: "text-xs leading-none",
    center: "text-[32px] leading-none",
  },
} as const;

export function PlayingCard({
  card,
  size = "md",
  highlight = false,
  dimmed = false,
  animate = false,
  tilt = "none",
}: {
  card: string;
  size?: keyof typeof SIZE_CLASSES;
  highlight?: boolean;
  dimmed?: boolean;
  animate?: boolean;
  tilt?: "left" | "right" | "none";
}) {
  const rankRaw = card[0] ?? "?";
  const suitRaw = card[1] ?? "s";
  const rank = RANK_DISPLAY[rankRaw] ?? rankRaw;
  const suit = SUIT_META[suitRaw] ?? SUIT_META.s;
  const sz = SIZE_CLASSES[size];

  const tiltCls =
    tilt === "left" ? "-rotate-3 origin-bottom-right" : tilt === "right" ? "rotate-3 origin-bottom-left" : "";

  return (
    <span
      aria-label={`${rank} of ${suit.name}`}
      className={`relative inline-flex select-none flex-col items-center justify-between border bg-gradient-to-b from-white via-[#fcfcfa] to-[#efede6] font-extrabold transition-all duration-200 ${
        sz.box
      } ${suit.colorClass} ${tiltCls} ${animate ? styles.cardDeal : ""} ${
        highlight
          ? "z-10 -translate-y-1.5 border-amber-400 shadow-[0_10px_24px_-4px_rgba(251,191,36,0.65)] ring-2 ring-amber-300"
          : "border-slate-300/90 shadow-[0_6px_14px_-4px_rgba(0,0,0,0.5)]"
      } ${dimmed ? "opacity-45 grayscale-[30%]" : ""}`}
    >
      <span className="flex flex-col items-center self-start tracking-tighter">
        <span className={sz.corner}>{rank}</span>
        {size !== "xs" && (
          <span className={sz.cornerSuit} aria-hidden="true">
            {suit.symbol}
          </span>
        )}
      </span>
      <span className={`${sz.center} drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]`} aria-hidden="true">
        {suit.symbol}
      </span>
      {size === "md" || size === "lg" ? (
        <span className="flex rotate-180 flex-col items-center self-end tracking-tighter opacity-85" aria-hidden="true">
          <span className={sz.corner}>{rank}</span>
        </span>
      ) : (
        <span className="h-1" aria-hidden="true" />
      )}
    </span>
  );
}

export function CardBack({ size = "sm", tilt = "none" }: { size?: keyof typeof SIZE_CLASSES; tilt?: "left" | "right" | "none" }) {
  const sz = SIZE_CLASSES[size];
  const tiltCls = tilt === "left" ? "-rotate-6" : tilt === "right" ? "rotate-6" : "";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex select-none items-center justify-center border border-amber-200/50 bg-gradient-to-br from-[#162a52] via-[#0e1c3a] to-[#081024] p-0.5 shadow-[0_6px_14px_-4px_rgba(0,0,0,0.65)] ${sz.box} ${tiltCls}`}
    >
      <span className="flex h-full w-full items-center justify-center rounded-[4px] border border-amber-300/35 bg-[repeating-linear-gradient(45deg,rgba(251,191,36,0.12)_0px,rgba(251,191,36,0.12)_2px,transparent_2px,transparent_6px)]">
        <span className="text-[10px] text-amber-300/60">♠</span>
      </span>
    </span>
  );
}

export function EmptyCardSlot({ size = "md" }: { size?: keyof typeof SIZE_CLASSES }) {
  const sz = SIZE_CLASSES[size];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center justify-center border border-dashed border-amber-100/20 bg-black/20 ${sz.box}`}
    >
      <span className="text-xs text-amber-100/15">♦</span>
    </span>
  );
}

export function PokerChip({
  tone = "gold",
  size = 16,
}: {
  tone?: "gold" | "emerald" | "crimson" | "indigo";
  size?: number;
}) {
  const palette = {
    gold: { outer: "#d97706", inner: "#fef3c7", stroke: "#f59e0b" },
    emerald: { outer: "#059669", inner: "#d1fae5", stroke: "#10b981" },
    crimson: { outer: "#dc2626", inner: "#fee2e2", stroke: "#ef4444" },
    indigo: { outer: "#4f46e5", inner: "#e0e7ff", stroke: "#6366f1" },
  }[tone];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0 drop-shadow-xs"
    >
      <circle cx="12" cy="12" r="10.5" fill={palette.outer} stroke="#ffffff" strokeWidth="1.5" strokeDasharray="3.3 3.3" />
      <circle cx="12" cy="12" r="6.5" fill={palette.inner} stroke={palette.stroke} strokeWidth="1.2" />
      <circle cx="12" cy="12" r="2.2" fill={palette.outer} />
    </svg>
  );
}
