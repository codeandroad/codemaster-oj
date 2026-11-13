"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import { apiMessage, productionApi } from "@/lib/production-api";
import { ScholarshipPopover } from "./scholarship-popover";
import type { ScholarshipEntry } from "./account-pages";

interface ScholarshipAccount {
  balance: number;
  items: ScholarshipEntry[];
  total: number;
  page: number;
  pageSize: number;
}
function useText() {
  const { locale } = useLocale();
  return (zh: string, en: string) => (locale === "en" ? en : zh);
}

type BalanceProps = {
  identityId: string;
  endpoint?: "scholarship/me" | "practice/scholarship/me";
  href?: string;
};

export function ScholarshipBalance(props: BalanceProps) {
  return <ScholarshipBalanceContent key={`${props.identityId}:${props.endpoint ?? "scholarship/me"}`} {...props}/>;
}

function ScholarshipBalanceContent({ endpoint = "scholarship/me", href = "/student/scholarship" }: BalanceProps) {
  const tx = useText(),
    [account, setAccount] = useState<ScholarshipAccount | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const seen = useRef<string | null | undefined>(undefined);
  const refreshAccount = useRef<() => void>(() => {});
  useEffect(() => {
    let controller: AbortController | undefined;
    seen.current = undefined;
    async function refresh() {
      if (document.visibilityState === "hidden") return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const next = await productionApi<ScholarshipAccount>(endpoint, { signal: request.signal });
        if (request.signal.aborted) return;
        const latest = next.items?.[0]?.id ?? null;
        if (seen.current !== undefined && latest !== seen.current) {
          const index = next.items.findIndex(
            (item) => item.id === seen.current,
          );
          const arrived = (
            index < 0 ? next.items.slice(0, 1) : next.items.slice(0, index)
          ).filter((item) => item.delta > 0);
          const amount = arrived.reduce((sum, item) => sum + item.delta, 0);
          if (amount) setNotice(`+${amount}`);
        }
        seen.current = latest;
        setAccount(next);
        setError("");
      } catch (reason) {
        if (!request.signal.aborted) setError(apiMessage(reason));
      }
    }
    const refreshEvent = () => void refresh();
    refreshAccount.current = refreshEvent;
    refreshEvent();
    const timer = setInterval(refreshEvent, 15000);
    window.addEventListener("focus", refreshEvent);
    window.addEventListener("campus-judge:scholarship-changed", refreshEvent);
    return () => {
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refreshEvent);
      window.removeEventListener("campus-judge:scholarship-changed", refreshEvent);
    };
  }, [endpoint]);
  return (
    <div className="inline-flex items-center gap-2 text-xs">
      <ScholarshipPopover balance={account?.balance} entries={account?.items} href={href} error={error} onRefresh={() => refreshAccount.current()}/>
      {notice && (
        <button
          type="button"
          onClick={() => setNotice("")}
          className="text-success"
          aria-label={tx("奖励到账，点击关闭提示", "Reward received; dismiss")}
        >
          <span role="status">{notice} {tx("奖学金", "scholarship")}</span>
        </button>
      )}
    </div>
  );
}
