import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { SiteFooter } from "@/components/site-footer";
import type { AppLocale } from "@/lib/app-locale";
import { sitePolicyContent } from "@/lib/site-policy-content";
import { sitePolicyHref, sitePolicySlugs, sitePolicyTitles, type SitePolicySlug } from "@/lib/site-policy-links";

const languages: AppLocale[] = ["en", "zh"];
const publicContact = {
  operator: "Code and Road",
  email: "codeandroad24@gmail.com",
  phone: "+8617370058232",
  phoneLabel: "+86 173 7005 8232",
};
const frame = "mx-auto w-full max-w-[1120px] px-4 sm:px-6";
const textLink = "cursor-pointer rounded-sm text-primary underline underline-offset-4 hover:text-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type PageProps = { params: Promise<{ language: string; document: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return languages.flatMap(language => sitePolicySlugs.map(document => ({ language, document })));
}

async function resolvePolicy(params: PageProps["params"]) {
  const { language, document } = await params;
  if (language !== "en" && language !== "zh") notFound();
  const slug = sitePolicySlugs.find(value => value === document);
  if (!slug) notFound();
  return { language, slug, title: sitePolicyTitles[language][slug], policy: sitePolicyContent[language][slug] } as const;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { title, policy } = await resolvePolicy(params);
  return { title: `${title} · CodeMaster`, description: policy.description };
}

const relatedPolicy: Partial<Record<SitePolicySlug, SitePolicySlug>> = {
  terms: "contact",
  privacy: "contact",
  cookies: "privacy",
  copyright: "contact",
};

export default async function SitePolicyPage({ params }: PageProps) {
  const { language, slug, title, policy } = await resolvePolicy(params);
  const chinese = language === "zh";
  const otherLanguage = chinese ? "en" : "zh";
  const otherLang = chinese ? "en" : "zh-CN";
  const related = relatedPolicy[slug];

  return (
    <div lang={chinese ? "zh-CN" : "en"} className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b border-border bg-surface">
        <div className={`${frame} flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2`}>
          <BrandLogo className="w-36 max-w-full" />
          <nav aria-label={chinese ? "页面导航" : "Page navigation"} className="flex flex-wrap items-center gap-x-4 text-sm">
            <Link href="/" className={`${textLink} inline-flex min-h-10 items-center`}>
              {chinese ? "返回首页" : "Back to home"}
            </Link>
            <Link href={sitePolicyHref(otherLanguage, slug)} hrefLang={otherLang} lang={otherLang} className={`${textLink} inline-flex min-h-10 items-center`}>
              {chinese ? "English" : "简体中文"}
            </Link>
          </nav>
        </div>
      </header>

      <main className={`${frame} flex-1 py-9 sm:py-14`}>
        <article className="mx-auto max-w-3xl wrap-anywhere" aria-labelledby="policy-title">
          <h1 id="policy-title" className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">{policy.description}</p>

          {(slug === "privacy" || slug === "contact") && (
            <dl className="mt-7 space-y-2 border-y border-border py-4 text-sm leading-6 sm:text-base">
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <dt className="font-semibold">{chinese ? "运营者" : "Operator"}</dt>
                <dd>{publicContact.operator} {chinese ? "（个人运营）" : "(individual operator)"}</dd>
              </div>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <dt className="font-semibold">{chinese ? "联系邮箱" : "Email"}</dt>
                <dd><a className={textLink} href={`mailto:${publicContact.email}`}>{publicContact.email}</a></dd>
              </div>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <dt className="font-semibold">{chinese ? "联系电话" : "Phone"}</dt>
                <dd><a className={textLink} href={`tel:${publicContact.phone}`}>{publicContact.phoneLabel}</a></dd>
              </div>
            </dl>
          )}

          <div className="mt-8 space-y-7 text-base leading-7">
            {policy.sections.map(({ heading, paragraphs, items }) => (
              <section key={heading}>
                <h2 className="text-lg font-semibold">{heading}</h2>
                {paragraphs?.map(paragraph => <p className="mt-2" key={paragraph}>{paragraph}</p>)}
                {items && (
                  <ul className="mt-2 list-disc space-y-2 pl-5">
                    {items.map(item => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </section>
            ))}
            {related && <Link href={sitePolicyHref(language, related)} className={`${textLink} inline-flex min-h-10 items-center`}>{sitePolicyTitles[language][related]}</Link>}
            {slug === "contact" && <Link href="/login?reset=1" className={`${textLink} inline-flex min-h-10 items-center`}>{chinese ? "打开密码重置页" : "Open password reset"}</Link>}
          </div>
        </article>
      </main>

      <div className={frame}><SiteFooter locale={language} current={slug} /></div>
    </div>
  );
}
