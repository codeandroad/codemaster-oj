"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { WorkspaceSettingsDialogProps } from "./workspace-settings-dialog";
import {editorTheme,type EditorTheme} from "./editor-themes";
import {defaultEditorKeymap,restoreEditorKeymap,type EditorKeymap} from "./editor-keymap";

export interface WorkspaceSettings {
  actionPlacement: "toolbar" | "editor";
  panelPercent: number;
  theme: EditorTheme;
  editorKeymap:EditorKeymap;
  pageTheme:"light"|"dark"|"system";
  fontFamily: "default" | "consolas" | "monaco" | "courier";
  fontSize: number;
  ligatures: boolean;
  keyBinding: "standard" | "emacs" | "vim";
  tabSize: 2 | 4 | 8;
  wordWrap: boolean;
  autoIndent: boolean;
  autoClose: boolean;
  relativeLineNumbers: boolean;
  runShortcut: boolean;
  submitShortcut: boolean;
  liveResize: boolean;
  openResultsNewTab: boolean;
  autoResetTimer: boolean;
  superAlarm: boolean;
}

export const defaultWorkspaceSettings: WorkspaceSettings = {
  actionPlacement: "toolbar",
  panelPercent: 48,
  theme: "vs",
  editorKeymap:defaultEditorKeymap,
  pageTheme:"system",
  fontFamily: "default",
  fontSize: 14,
  ligatures: false,
  keyBinding: "standard",
  tabSize: 4,
  wordWrap: false,
  autoIndent: true,
  autoClose: true,
  relativeLineNumbers: false,
  runShortcut: true,
  submitShortcut: true,
  liveResize: true,
  openResultsNewTab: false,
  autoResetTimer: false,
  superAlarm: false,
};

const keyFor = (userId: string) => `campus-judge:workspace-settings:v1:${userId}`;

function restore(value: unknown): WorkspaceSettings {
  if (!value || typeof value !== "object") return defaultWorkspaceSettings;
  const source = value as Partial<WorkspaceSettings>;
  const pick = <T extends string | number>(value: T | undefined, allowed: readonly T[], fallback: T) => allowed.includes(value as T) ? value as T : fallback;
  const boolean = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
  return {
    actionPlacement: pick(source.actionPlacement, ["toolbar", "editor"], defaultWorkspaceSettings.actionPlacement),
    pageTheme:pick(source.pageTheme,["light","dark","system"],"system"),
    theme: editorTheme(String(source.theme)==="light"?"vs":String(source.theme)==="dark"?"vs_dark":source.theme).id,
    editorKeymap:restoreEditorKeymap(source.editorKeymap),
    panelPercent: typeof source.panelPercent === "number" && Number.isFinite(source.panelPercent) ? Math.round(Math.max(25, Math.min(70, source.panelPercent))) : 48,
    fontFamily: pick(source.fontFamily, ["default", "consolas", "monaco", "courier"], defaultWorkspaceSettings.fontFamily),
    fontSize: typeof source.fontSize === "number" && Number.isFinite(source.fontSize) ? Math.round(Math.max(12, Math.min(24, source.fontSize))) : 14,
    ligatures: boolean(source.ligatures, false),
    keyBinding: pick(source.keyBinding, ["standard", "emacs", "vim"], "standard"),
    tabSize: pick(source.tabSize, [2, 4, 8], 4),
    wordWrap: boolean(source.wordWrap, false),
    autoIndent: boolean(source.autoIndent, true),
    autoClose: boolean(source.autoClose, true),
    relativeLineNumbers: boolean(source.relativeLineNumbers, false),
    runShortcut: boolean(source.runShortcut, true),
    submitShortcut: boolean(source.submitShortcut, true),
    liveResize: boolean(source.liveResize, true),
    openResultsNewTab: boolean(source.openResultsNewTab, false),
    autoResetTimer: boolean(source.autoResetTimer, false),
    superAlarm: boolean(source.superAlarm, false),
  };
}

export function useWorkspaceSettings(userId: string) {
  const [settings, setSettings] = useState(defaultWorkspaceSettings);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loaded = loadedFor === userId;
  const [systemDark,setSystemDark]=useState(false);
  useEffect(()=>{const query=window.matchMedia("(prefers-color-scheme: dark)");const sync=()=>setSystemDark(query.matches);sync();query.addEventListener("change",sync);return()=>query.removeEventListener("change",sync);},[]);
  useEffect(() => {
    try { setSettings(restore(JSON.parse(localStorage.getItem(keyFor(userId)) ?? "null"))); }
    catch { setSettings(defaultWorkspaceSettings); }
    setLoadedFor(userId);
  }, [userId]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== keyFor(userId)) return;
      try {
        const next = restore(JSON.parse(event.newValue ?? "null"));
        setSettings(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      }
      catch { setSettings(current => JSON.stringify(current) === JSON.stringify(defaultWorkspaceSettings) ? current : defaultWorkspaceSettings); }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [userId]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(keyFor(userId), JSON.stringify(settings)); }
    catch { /* Settings remain usable when browser storage is blocked. */ }
  }, [settings, userId, loaded]);
  const update = useCallback((patch: Partial<WorkspaceSettings>) => setSettings(current => restore({ ...current, ...patch })), []);
  const reset = useCallback(() => setSettings(current => ({ ...current, actionPlacement: defaultWorkspaceSettings.actionPlacement, panelPercent: defaultWorkspaceSettings.panelPercent })), []);
  return { settings, update, reset, loaded, resolvedPageTheme:(settings.pageTheme==="system"?(systemDark?"dark":"light"):settings.pageTheme) as "light"|"dark" };
}

const SettingsDialog = dynamic(() => import("./workspace-settings-dialog").then(module => module.WorkspaceSettingsDialog), { loading: () => null });

export function WorkspaceSettingsDialog(props: WorkspaceSettingsDialogProps) {
  // Delay the dialog until its first open, then retain its selected section
  // across close/reopen just as the original mounted dialog did.
  const [opened, setOpened] = useState(props.open);
  const [initialSection] = useState(props.initialSection);
  useEffect(() => { if (props.open) setOpened(true); }, [props.open]);
  if (!props.open && !opened) return null;
  return <SettingsDialog {...props} initialSection={initialSection}/>;
}
