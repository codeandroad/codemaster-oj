export type AppLocale = "en" | "zh";

export const DEFAULT_APP_LOCALE: AppLocale = "en";
export function accountLocaleStorageKey(accountId: string): string {
  return `campus-judge:locale:v2:${accountId}`;
}

/** Only the exact preference saved by Settings enables Chinese. */
export function resolveAppLocale(preference: unknown): AppLocale {
  return preference === "zh" ? "zh" : DEFAULT_APP_LOCALE;
}
