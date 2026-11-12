import type { AppLocale } from "@/lib/app-locale";

export const sitePolicySlugs = ["terms", "privacy", "cookies", "copyright", "contact"] as const;
export type SitePolicySlug = (typeof sitePolicySlugs)[number];

export const sitePolicyTitles: Record<AppLocale, Record<SitePolicySlug, string>> = {
  en: {
    terms: "Terms & Conditions",
    privacy: "Privacy Policy",
    cookies: "Cookie Policy",
    copyright: "Copyright Notice",
    contact: "Contact",
  },
  zh: {
    terms: "使用条款",
    privacy: "隐私政策",
    cookies: "Cookie 政策",
    copyright: "版权声明",
    contact: "联系我们",
  },
};

export function sitePolicyHref(locale: AppLocale, document: SitePolicySlug) {
  return `/info/${locale}/${document}`;
}
