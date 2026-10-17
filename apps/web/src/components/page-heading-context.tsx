"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";

type HeadingEntry = { id: string; pathname: string; title: string };
type HeadingContextValue = {
  pathname: string;
  title: string;
  register: (entry: HeadingEntry) => () => void;
};
const PageHeadingContext = createContext<HeadingContextValue | null>(null);

/** Route-scoped headings avoid showing a previous page's title during loading. */
export function PageHeadingProvider({ pathname, children }: { pathname: string; children: ReactNode }) {
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const register = useCallback((entry: HeadingEntry) => {
    setHeadings(current => [...current.filter(item => item.id !== entry.id), entry]);
    return () => setHeadings(current => current.filter(item => item.id !== entry.id));
  }, []);
  const title = headings.findLast(entry => entry.pathname === pathname)?.title ?? "";
  const value = useMemo(() => ({ pathname, title, register }), [pathname, title, register]);
  return <PageHeadingContext.Provider value={value}>{children}</PageHeadingContext.Provider>;
}

/** Also safe in standalone workspaces, which do not use the campus shell. */
export function usePageHeading(title: string) {
  const context = useContext(PageHeadingContext);
  const id = useId();
  const register = context?.register;
  const pathname = context?.pathname;
  useEffect(() => {
    if (!register || pathname === undefined || !title.trim()) return;
    return register({ id, pathname, title: title.trim() });
  }, [id, pathname, register, title]);
}

export function useCurrentPageHeading() {
  return useContext(PageHeadingContext)?.title ?? "";
}
