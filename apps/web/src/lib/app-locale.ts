export type AppLocale = "en" | "zh";

export const DEFAULT_APP_LOCALE: AppLocale = "en";
export const APP_LOCALE_COOKIE = "campus-judge-locale";
export const APP_LOCALE_STORAGE_KEY = "campus-judge:locale:v1";

/** Only the exact preference saved by Settings enables Chinese. */
export function resolveAppLocale(preference: unknown): AppLocale {
  return preference === "zh" ? "zh" : DEFAULT_APP_LOCALE;
}
