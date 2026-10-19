"use client";

import { ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { AppLink } from "@/components/navigation";
import { useLocale } from "@/components/locale-context";
import { useCurrentPageHeading } from "@/components/page-heading-context";
import { pageBreadcrumbs, type BreadcrumbRole } from "@/lib/page-breadcrumbs";

export function PageBreadcrumbs({ pathname, role }: { pathname: string; role: BreadcrumbRole }) {
  const { locale } = useLocale();
  const title = useCurrentPageHeading();
  const search = useSearchParams();
  const items = pageBreadcrumbs(pathname, role, locale, title, search);
  return <nav aria-label={locale === "en" ? "Breadcrumb" : "当前位置"} data-od-id="page-breadcrumbs" className="min-w-0 flex-1 text-sm">
    <ol className="flex min-w-0 items-center gap-1.5">
      {items.map((item, index) => <li key={item.href} className={`flex min-w-0 items-center gap-1.5 ${index === items.length - 1 ? "flex-1" : "shrink-0 max-sm:max-w-[95px]"}`}>
        {index > 0 && <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-muted-foreground/60"/>}
        {index === items.length - 1
          ? <span aria-current="page" title={item.label} className="block min-w-0 truncate font-semibold text-foreground">{item.label}</span>
          : <AppLink href={item.href} title={item.label} className="block min-w-0 truncate text-muted-foreground hover:text-primary focus-visible:underline">{item.label}</AppLink>}
      </li>)}
    </ol>
  </nav>;
}

export function ShellPageHeading({ pathname, role }: { pathname: string; role: BreadcrumbRole }) {
  const { locale } = useLocale();
  const heading = useCurrentPageHeading();
  const items = pageBreadcrumbs(pathname, role, locale);
  return <h1 className="sr-only">{heading || items[items.length - 1].label}</h1>;
}
