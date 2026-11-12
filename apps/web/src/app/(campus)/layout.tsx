import { Suspense, type ReactNode } from "react";
import { ProductionApp } from "@/components/production-app";

export default function CampusLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<main className="grid min-h-screen place-items-center" role="status">Connecting to campus services…</main>}>
        <ProductionApp />
      </Suspense>
      {children}
    </>
  );
}
