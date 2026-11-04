import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ProductionApp } from "@/components/production-app";
import { AppLocaleProvider } from "@/components/locale-context";
import { APP_LOCALE_COOKIE, resolveAppLocale } from "@/lib/app-locale";
import {cookies} from "next/headers";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeMaster · Campus coding practice",
  description: "Learn Python, C++ and JavaScript through courses, coding practice, assignments and timed challenges.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const initialLocale=resolveAppLocale((await cookies()).get(APP_LOCALE_COOKIE)?.value);
  return <html lang={initialLocale==="en"?"en":"zh-CN"}><body><AppLocaleProvider initialLocale={initialLocale}><Suspense fallback={<main className="grid min-h-screen place-items-center" role="status">{initialLocale==="en"?"Connecting to campus services…":"正在连接校内服务…"}</main>}><ProductionApp /></Suspense>{children}</AppLocaleProvider></body></html>;
}
