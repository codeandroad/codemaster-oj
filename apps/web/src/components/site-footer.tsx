import Link from "next/link";
import type { AppLocale } from "@/lib/app-locale";
import { sitePolicyHref, sitePolicySlugs, sitePolicyTitles, type SitePolicySlug } from "@/lib/site-policy-links";

export function SiteFooter({ locale, current, className = "" }: {
  locale: AppLocale;
  current?: SitePolicySlug;
  className?: string;
}) {
  return (
    <footer className={`flex flex-col gap-y-1 border-t border-border py-3 text-sm text-muted-foreground xl:flex-row xl:items-center xl:justify-between xl:gap-x-6 ${className}`}>
      <p className="shrink-0">© CodeMaster</p>
      <nav aria-label={locale === "zh" ? "网站政策与联系" : "Site policies and contact"}>
        <ul className="flex flex-wrap gap-x-3 xl:justify-end xl:gap-x-5">
          {sitePolicySlugs.map(document => (
            <li key={document}>
              <Link
                href={sitePolicyHref(locale, document)}
                aria-current={current === document ? "page" : undefined}
                className="inline-flex min-h-10 cursor-pointer items-center rounded-sm underline-offset-4 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:font-semibold aria-[current=page]:text-primary aria-[current=page]:underline"
              >
                {sitePolicyTitles[locale][document]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
