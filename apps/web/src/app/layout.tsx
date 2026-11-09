import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ProductionApp } from "@/components/production-app";
import { DEFAULT_APP_LOCALE } from "@/lib/app-locale";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeMaster · Campus coding practice",
  description: "Learn Python, C++ and JavaScript through courses, coding practice, assignments and timed challenges.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang={DEFAULT_APP_LOCALE}><body><Suspense fallback={<main className="grid min-h-screen place-items-center" role="status">Connecting to campus services…</main>}><ProductionApp /></Suspense>{children}</body></html>;
}
