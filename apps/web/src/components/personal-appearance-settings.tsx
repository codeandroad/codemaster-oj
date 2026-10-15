"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { WorkspaceSettings } from "@/components/student/workspace-settings";
import {useLocale} from "@/components/locale-context";

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
  const {locale,setLocale,t}=useLocale();
  if (!appearance) return null;
  return <section className="mt-4 border border-border bg-surface p-5 panel-shadow" aria-labelledby="personal-appearance-title">
    <h2 id="personal-appearance-title" className="font-bold">{t("页面外观")}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{t("选择主页面的颜色主题，设置保存在当前浏览器中。")}</p>
    <fieldset className="mt-4">
      <legend className="sr-only">{t("颜色主题")}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map(({ value, label, icon: Icon }) => <label key={value} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-md border px-4 text-sm font-semibold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${appearance.pageTheme === value ? "border-primary bg-info-soft text-primary" : "border-border hover:bg-muted"}`}>
          <input type="radio" name="personal-page-theme" value={value} checked={appearance.pageTheme === value} onChange={() => appearance.updatePageTheme(value)} className="sr-only" />
          <Icon size={18} aria-hidden="true" />{t(label)}
        </label>)}
      </div>
    </fieldset>
    <fieldset className="mt-6 border-t border-border pt-5">
      <legend className="font-semibold">{t("界面语言")}</legend>
      <p className="mt-1 text-sm text-muted-foreground">{t("默认中文。语言设置保存在当前浏览器中，不翻译题目与用户填写的内容。")}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        {(["zh","en"] as const).map(value=><label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm font-semibold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${locale===value?"border-primary bg-info-soft text-primary":"border-border hover:bg-muted"}`}>
          <input type="radio" name="personal-locale" value={value} checked={locale===value} onChange={()=>setLocale(value)} className="sr-only"/>
          {value==="zh"?"简体中文":"English"}
        </label>)}
      </div>
    </fieldset>
  </section>;
}
