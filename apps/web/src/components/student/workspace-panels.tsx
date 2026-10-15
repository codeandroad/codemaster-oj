"use client";
import { useEffect, useReducer, useState } from "react";
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import { useLocale } from "@/components/locale-context";
import { defaultLayout, restoreLayout, workspaceLayoutReducer, type WorkspacePanel } from "./workspace-layout-model";
import styles from "./workspace.module.css";
export const panelNames: Record<WorkspacePanel, string> = { statement: "题目描述", editor: "代码编辑器", testing: "测试区域" };
const englishPanelNames: Record<WorkspacePanel, string> = { statement: "Problem", editor: "Code editor", testing: "Tests" };
export function useWorkspaceLayout(userId: string) {
  const [layout, dispatch] = useReducer(workspaceLayoutReducer, undefined, defaultLayout);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = `campus-judge:workspace-panels:v2:${userId}`;
  useEffect(() => {
    let saved = defaultLayout(),current=false;
    try { const raw=localStorage.getItem(key);current=raw!==null;saved = restoreLayout(JSON.parse(raw ?? localStorage.getItem(`campus-judge:workspace-panels:v1:${userId}`) ?? "null")); } catch { /* Storage is optional. */ }
    dispatch({ type: "reset" });
    for (const panel of ["statement", "editor", "testing"] as const) {
      if(current&&saved.panels[panel]==="hidden")dispatch({type:"hide",panel});
      // Legacy hidden panels reopen once; explicit layout-menu choices still persist.
      if (saved.panels[panel] === "collapsed") dispatch({ type: "toggle-collapse", panel });
    }
    dispatch({ type: "resize", percent: saved.editorPercent });
    setLoadedKey(key);
  }, [key,userId]);
  useEffect(() => {
    if (loadedKey !== key) return;
    try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* Panels remain usable. */ }
  }, [key, loadedKey, layout]);
  return { layout, dispatch };
}
export function PanelControls({ panel, collapsed, maximized, onCollapse, onMaximize }: {
  panel: WorkspacePanel; collapsed: boolean; maximized: boolean; onCollapse: () => void; onMaximize: () => void;
}) {
  const { locale } = useLocale();
  const name = locale === "en" ? englishPanelNames[panel] : panelNames[panel];
  const collapseLabel = locale === "en" ? `${collapsed ? "Expand" : "Collapse"} ${name}` : `${collapsed ? "展开" : "折叠"}${name}`;
  const maximizeLabel = locale === "en" ? `${maximized ? "Restore" : "Maximize"} ${name}` : `${maximized ? "还原" : "最大化"}${name}`;
  return <div className={styles.panelControls}>
    <button type="button" title={collapseLabel} aria-label={collapseLabel} aria-expanded={!collapsed} onClick={onCollapse} data-od-id={`collapse-${panel}`}>{collapsed ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button>
    <button type="button" title={maximizeLabel} aria-label={maximizeLabel} aria-pressed={maximized} onClick={onMaximize} data-od-id={`maximize-${panel}`}>{maximized ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button>

  </div>;
}
