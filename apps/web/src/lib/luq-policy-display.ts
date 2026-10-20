export interface LuqPolicyDisplayInput {
  mode: "disabled" | "paid" | "free";
  opensAt: string | null;
  price?: number | null;
}

/** Describe the published policy, without guessing whether the current request is authorized. */
export function luqPolicyDescription(
  policy: LuqPolicyDisplayInput,
  locale: string,
) {
  const english = locale === "en";
  const labels = english
    ? { disabled: "Disabled", paid: "Paid", free: "Free" }
    : { disabled: "禁用", paid: "付费", free: "免费" };
  const label = policy.mode === "paid" && policy.price != null ? `${policy.price} Luq` : labels[policy.mode];
  if (policy.mode === "disabled" || !policy.opensAt) return label;
  const date = new Date(policy.opensAt);
  if (Number.isNaN(date.getTime())) return label;
  const opening = date.toLocaleString(english ? "en-GB" : "zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${label} · ${english ? "opens " : "开放于 "}${opening} Asia/Shanghai`;
}
