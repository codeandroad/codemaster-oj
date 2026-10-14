"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { WorkspaceSettings } from "@/components/student/workspace-settings";

type PageTheme = WorkspaceSettings["pageTheme"];
type AppearanceContextValue = {
  pageTheme: PageTheme;
  updatePageTheme: (theme: PageTheme) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function PersonalAppearanceProvider({
  pageTheme,
  updatePageTheme,
  children,
}: AppearanceContextValue & { children: ReactNode }) {
  return <AppearanceContext.Provider value={{ pageTheme, updatePageTheme }}>{children}</AppearanceContext.Provider>;
}

const options = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
] as const;

export function PersonalAppearanceSettings() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) return null;
  return <section className="mt-4 border border-border bg-surface p-5 panel-shadow" aria-labelledby="personal-appearance-title">
    <h2 id="personal-appearance-title" className="font-bold">页面外观</h2>
    <p className="mt-1 text-sm text-muted-foreground">选择主页面的颜色主题，设置保存在当前浏览器中。</p>
    <fieldset className="mt-4">
      <legend className="sr-only">颜色主题</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map(({ value, label, icon: Icon }) => <label key={value} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-4 text-sm font-semibold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${appearance.pageTheme === value ? "border-primary bg-info-soft text-primary" : "border-border hover:bg-muted"}`}>
          <input type="radio" name="personal-page-theme" value={value} checked={appearance.pageTheme === value} onChange={() => appearance.updatePageTheme(value)} className="sr-only" />
          <Icon size={18} aria-hidden="true" />{label}
        </label>)}
      </div>
    </fieldset>
  </section>;
}
