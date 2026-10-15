"use client";

import { useEffect, type ComponentProps } from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-context";

const navigationEvent = "campus-judge:before-navigate";

/** Keep the browser's unload protection and client-side navigation in sync. */
export function useNavigationBlocker(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const block = (event: Event) => event.preventDefault();
    window.addEventListener(navigationEvent, block);
    return () => window.removeEventListener(navigationEvent, block);
  }, [dirty]);
}

export function AppLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const { locale } = useLocale();
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (!window.dispatchEvent(new Event(navigationEvent, { cancelable: true })) &&
            !window.confirm(locale === "en" ? "This page has unsaved changes. Leave anyway?" : "当前页面有未保存的修改，确认离开？")) {
          event.preventDefault();
          return;
        }
        onNavigate?.(event);
      }}
    />
  );
}
