import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ProductionApp } from "@/components/production-app";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeMaster OJ · 校内编程学习",
  description: "校内 Python、C++ 和 JavaScript 编程练习、课堂作业、计时训练与学习订正。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body><Suspense fallback={<main className="grid min-h-screen place-items-center" role="status">正在连接校内服务…</main>}><ProductionApp /></Suspense>{children}</body></html>;
}
