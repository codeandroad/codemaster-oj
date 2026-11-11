export type AssistancePriceIntent = "unchanged" | "custom" | "default";

export function parseAssistancePrice(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const price = Number(value);
  return Number.isInteger(price) && price >= 0 && price <= 1000 ? price : undefined;
}

/** Omit untouched prices so editing access rules preserves default inheritance. */
export function assistancePricePayload(intent: AssistancePriceIntent, value: string): { price?: number | null } {
  if (intent === "unchanged") return {};
  if (intent === "default") return { price: null };
  const price = parseAssistancePrice(value);
  if (price === undefined) throw new Error("Enter an integer price from 0 to 1000.");
  return { price };
}
