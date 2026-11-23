"use client";

const SUIT_META: Record<string, { symbol: string; colorClass: string; name: string }> = {
  s: { symbol: "♠", colorClass: "text-slate-900", name: "Spades" },
  h: { symbol: "♥", colorClass: "text-red-600", name: "Hearts" },
  d: { symbol: "♦", colorClass: "text-red-600", name: "Diamonds" },
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
  xs: "h-8 w-6 text-[10px] rounded-[4px]",
  sm: "h-11 w-8 text-xs rounded-md",
  md: "h-14 w-10 text-sm rounded-md",
  lg: "h-16 w-12 text-base rounded-lg",
} as const;

export function PlayingCard({
  card,
  size = "md",
  highlight = false,
  dimmed = false,
}: {
  card: string;
  size?: keyof typeof SIZE_CLASSES;
  highlight?: boolean;
  dimmed?: boolean;
}) {
  const rankRaw = card[0] ?? "?";
  const suitRaw = card[1] ?? "s";
  const rank = RANK_DISPLAY[rankRaw] ?? rankRaw;
  const suit = SUIT_META[suitRaw] ?? SUIT_META.s;

  return (
    <span
      aria-label={`${rank} of ${suit.name}`}
      className={`relative inline-flex select-none flex-col items-center justify-between border bg-white px-1 py-0.5 font-bold leading-none shadow-sm transition-transform ${
        SIZE_CLASSES[size]
      } ${suit.colorClass} ${
        highlight ? "border-amber-400 ring-2 ring-amber-400/80 -translate-y-0.5" : "border-slate-300"
      } ${dimmed ? "opacity-55" : ""}`}
    >
      <span className="self-start tracking-tighter">{rank}</span>
      <span className={size === "xs" ? "text-xs" : size === "sm" ? "text-sm" : "text-lg"} aria-hidden="true">
        {suit.symbol}
      </span>
      <span className="self-end text-[9px] leading-none opacity-75" aria-hidden="true">
        {rank}
      </span>
    </span>
  );
}

export function CardBack({ size = "sm" }: { size?: keyof typeof SIZE_CLASSES }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex select-none items-center justify-center border border-sky-200/80 bg-gradient-to-br from-sky-800 via-indigo-900 to-slate-900 shadow-sm ${SIZE_CLASSES[size]}`}
    >
      <span className="h-[72%] w-[72%] rounded-[3px] border border-sky-300/35 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:4px_4px]" />
    </span>
  );
}

export function EmptyCardSlot({ size = "md" }: { size?: keyof typeof SIZE_CLASSES }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex border border-dashed border-emerald-200/30 bg-emerald-950/25 ${SIZE_CLASSES[size]}`}
    />
  );
}
