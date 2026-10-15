"use client";

import { useCallback, useEffect, useState } from "react";
import { Code2, FlaskConical, Keyboard, LayoutPanelLeft, RotateCcw, Timer } from "lucide-react";
import {EditorThemePreview} from "./editor-theme-preview";
import {EditorShortcutSettings} from "./editor-shortcut-settings";
import {editorThemes,editorTheme,type EditorTheme} from "./editor-themes";
import {defaultEditorKeymap,restoreEditorKeymap,type EditorKeymap} from "./editor-keymap";
import {workspaceShortcuts,debugShortcuts} from "./shortcut-catalog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useLocale } from "@/components/locale-context";

export interface WorkspaceSettings {
  actionPlacement: "toolbar" | "editor";
  panelPercent: number;
  theme: EditorTheme;
  editorKeymap:EditorKeymap;
  pageTheme:"light"|"dark"|"system";
  fontFamily: "default" | "consolas" | "monaco" | "courier";
  fontSize: number;
  ligatures: boolean;
  keyBinding: "standard" | "emacs";
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
    keyBinding: pick(source.keyBinding, ["standard", "emacs"], "standard"),
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

type Section = "layout" | "editor" | "shortcuts" | "advanced" | "timer";
const sections: { id: Section; label: string; icon: typeof Code2 }[] = [
  { id: "layout", label: "页面布局", icon: LayoutPanelLeft },
  { id: "editor", label: "代码编辑器", icon: Code2 },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "advanced", label: "高级设置", icon: FlaskConical },
  { id: "timer", label: "计时器", icon: Timer },
];
const englishSections: Record<Section, string> = { layout: "Layout", editor: "Code editor", shortcuts: "Shortcuts", advanced: "Advanced", timer: "Timer" };
const shortcutNameEnglish: Record<string, string> = {
  "关闭答题页（返回列表）": "Close workspace (return to list)",
  "保存本机草稿": "Save local draft",
  "最大化 / 还原活动面板": "Maximize / restore active panel",
  "进入 / 退出全屏": "Enter / exit full screen",
  "还原最大化 / 关闭弹窗": "Restore panel / close dialog",
};
const debugNameEnglish: Record<string, string> = {
  "开始调试 · Start Debugging": "Start debugging",
  "停止调试 · Stop Debugging": "Stop debugging",
  "继续执行 · Skip Forward": "Continue",
  "单步跳过 · Step over": "Step over",
  "单步进入 · Step in": "Step in",
  "单步跳出 · Step out": "Step out",
  "重新启动 · Restart": "Restart",
};

function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-start justify-between gap-5 py-3 text-sm"><span><strong className="font-semibold">{label}</strong>{description && <span className="mt-1 block max-w-xl leading-5 text-muted-foreground">{description}</span>}</span><span className="relative mt-0.5 inline-flex shrink-0 items-center"><input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={event => onChange(event.target.checked)} className="peer sr-only"/><span className="h-5 w-9 rounded-full bg-muted-foreground/40 transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"/><span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4"/></span></label>;
}

function SelectRow<T extends string | number>({ label, value, choices, onChange }: { label: string; value: T; choices: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <label className="flex items-center justify-between gap-4 py-3 text-sm"><span className="font-semibold">{label}</span><select aria-label={label} value={value} onChange={event => onChange(choices.find(choice => String(choice.value) === event.target.value)!.value)} className="min-h-9 rounded-md border border-border bg-surface-subtle px-3 text-sm text-foreground">{choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>;
}

export function WorkspaceSettingsDialog({ open, onOpenChange, settings, update, reset,editorOnly=false,initialSection="layout" }: { open: boolean; onOpenChange: (open: boolean) => void; settings: WorkspaceSettings; update: (patch: Partial<WorkspaceSettings>) => void; reset: () => void;editorOnly?:boolean;initialSection?:Section }) {
  const { locale } = useLocale();
  const tx = (zh: string, en: string) => locale === "en" ? en : zh;
  const [section, setSection] = useState<Section>(initialSection);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className={`grid h-[min(88dvh,720px)] w-[min(96vw,1000px)] max-w-none grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl border-border p-0 sm:grid-cols-[220px_minmax(0,1fr)] sm:grid-rows-1`}>
    <div className="min-w-0 border-b border-border bg-surface-subtle px-4 py-5 sm:border-b-0 sm:border-r sm:px-5"><DialogTitle className="mb-4 text-2xl sm:mb-7">{editorOnly?tx("代码编辑器设置","Code editor settings"):tx("工作区设置","Workspace settings")}</DialogTitle><DialogDescription className="sr-only">{tx("设置当前答题页面或代码编辑器的布局与行为。","Configure this workspace or code editor.")}</DialogDescription><nav aria-label={tx("设置类别","Settings categories")} className="flex gap-1 overflow-x-auto sm:flex-col">{sections.filter(item=>editorOnly?(item.id==="editor"||item.id==="shortcuts"):item.id!=="editor").map(item => { const Icon = item.icon; return <button type="button" key={item.id} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)} className={`flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition-colors sm:w-full ${section === item.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}><Icon size={17}/>{tx(item.label,englishSections[item.id])}</button>; })}</nav></div>
    <div className="min-h-0 overflow-y-auto p-5 pr-12 sm:p-8 sm:pr-12">
      {section === "layout" && <div className="space-y-7"><div className="flex items-center justify-between gap-3"><h3 className="text-base font-bold">{tx("默认布局","Default layout")}</h3><button type="button" onClick={reset} className="flex min-h-9 items-center gap-1 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted"><RotateCcw size={14}/>{tx("重置","Reset")}</button></div><fieldset><legend className="mb-3 text-sm font-semibold">{tx("运行和提交按钮的位置","Show Run and Submit buttons in")}</legend><div className="grid gap-3 sm:grid-cols-2">{(["toolbar", "editor"] as const).map(value => <label key={value} className={`cursor-pointer rounded-xl border-2 p-4 text-center ${settings.actionPlacement === value ? "border-primary bg-info-soft" : "border-border hover:bg-muted/50"}`}><input type="radio" name="action-placement" value={value} checked={settings.actionPlacement === value} onChange={() => update({ actionPlacement: value })} className="sr-only"/><span aria-hidden className="mb-3 block h-16 rounded-md border border-border bg-surface p-2"><span className={`block h-2 w-24 rounded ${value === "toolbar" ? "bg-primary" : "bg-muted"}`}/><span className={`mt-7 block h-2 w-16 rounded ${value === "editor" ? "bg-primary" : "bg-muted"}`}/></span><span className="font-semibold">{value === "toolbar" ? tx("页面工具栏","Toolbar") : tx("代码区","Code editor")}</span></label>)}</div></fieldset><label className="block text-sm font-semibold">{tx("题目区宽度","Problem panel width")} <span className="float-right font-normal text-muted-foreground">{settings.panelPercent}%</span><input type="range" min="25" max="70" value={settings.panelPercent} onChange={event => update({ panelPercent: Number(event.target.value) })} className="mt-3 w-full accent-primary"/></label><p className="text-xs leading-5 text-muted-foreground">{tx("桌面端还可以拖动题目与编辑器之间的分隔线。","On desktop, drag the divider between the problem and editor panels.")}</p></div>}
      {section === "editor" && <div className="divide-y divide-border"><SelectRow label={tx("编辑器主题（仅代码区）","Editor theme (code only)")} value={settings.theme} choices={editorThemes.map(theme=>({value:theme.id,label:theme.label}))} onChange={theme => update({theme})}/><EditorThemePreview theme={settings.theme}/><SelectRow label={tx("字体","Font")} value={settings.fontFamily} choices={[{ value: "default", label: tx("默认","Default") }, { value: "consolas", label: "Consolas" }, { value: "monaco", label: "Monaco" }, { value: "courier", label: "Courier New" }]} onChange={fontFamily => update({ fontFamily })}/><SelectRow label={tx("字号","Font size")} value={settings.fontSize} choices={Array.from({ length: 13 }, (_, index) => ({ value: 12 + index, label: `${12 + index}px` }))} onChange={fontSize => update({ fontSize })}/><Toggle label={tx("字体连字","Font ligatures")} checked={settings.ligatures} onChange={ligatures => update({ ligatures })}/><SelectRow label={tx("键位绑定","Key binding")} value={settings.keyBinding} choices={[{ value: "standard", label: tx("标准","Standard") }, { value: "emacs", label: "Emacs (Ctrl+A/E)" }]} onChange={keyBinding => update({ keyBinding })}/><SelectRow label={tx("缩进宽度","Tab size")} value={settings.tabSize} choices={[{ value: 2, label: tx("2 个空格","2 spaces") }, { value: 4, label: tx("4 个空格","4 spaces") }, { value: 8, label: tx("8 个空格","8 spaces") }]} onChange={tabSize => update({ tabSize })}/><Toggle label={tx("自动缩进","Auto indent")} checked={settings.autoIndent} onChange={autoIndent => update({autoIndent})}/><Toggle label={tx("括号与引号补全","Auto-close brackets and quotes")} checked={settings.autoClose} onChange={autoClose => update({autoClose})}/><Toggle label={tx("自动换行","Word wrap")} checked={settings.wordWrap} onChange={wordWrap => update({ wordWrap })}/><Toggle label={tx("相对行号","Relative line numbers")} checked={settings.relativeLineNumbers} onChange={relativeLineNumbers => update({ relativeLineNumbers })}/></div>}
      {section === "shortcuts" && (editorOnly?<div><h3 className="mb-4 text-base font-bold">{tx("代码编辑器快捷键","Code editor shortcuts")}</h3><EditorShortcutSettings bindings={settings.editorKeymap} onChange={editorKeymap=>update({editorKeymap})}/><p className="mt-4 text-xs text-muted-foreground">{tx("仅在代码输入框激活时生效。运行与提交的开关位于页面设置。","Active only while the code editor is focused. Run and Submit shortcuts are configured in workspace settings.")}</p></div>:<div><h3 className="mb-3 text-base font-bold">{tx("常规操作","General")}</h3><div className="divide-y divide-border"><Toggle label={tx("运行公开样例","Run public samples")} description="Ctrl / ⌘ + '" checked={settings.runShortcut} onChange={runShortcut=>update({runShortcut})}/><Toggle label={tx("正式提交","Submit")} description="Ctrl / ⌘ + Enter" checked={settings.submitShortcut} onChange={submitShortcut=>update({submitShortcut})}/></div><dl className="mt-5 divide-y divide-border text-sm">{workspaceShortcuts.map(([name,key])=><div className="flex justify-between gap-3 py-3" key={name}><dt>{locale === "en" ? shortcutNameEnglish[name] ?? name : name}</dt><dd className="text-right font-mono text-xs">{key}</dd></div>)}</dl><p className="mt-4 text-xs text-muted-foreground">{tx("在答题页任意面板中可用；弹窗打开时暂停运行和提交。关闭答题页会保留草稿，并对未提交修改请求确认。","Available in any workspace panel. Run and Submit are paused while a dialog is open. Unsaved edits trigger a confirmation when leaving; drafts remain in this browser.")}</p><h3 className="mb-2 mt-6 text-base font-bold">{tx("调试操作","Debug")}</h3><p className="mb-3 text-xs leading-5 text-muted-foreground">{tx("当前系统尚未启用隔离调试服务，以下操作暂不可用。","The isolated debugging service is not available yet, so these actions are disabled.")}</p><dl aria-disabled="true" className="divide-y divide-border text-xs">{debugShortcuts.map(([name,key])=><div key={name} className="flex flex-wrap justify-between gap-2 py-2"><dt>{locale === "en" ? debugNameEnglish[name] ?? name : name} <span className="text-muted-foreground">· {tx("未启用","Unavailable")}</span></dt><dd className="font-mono">{key}</dd></div>)}</dl></div>)}
      {section === "advanced" && <div className="divide-y divide-border"><Toggle label={tx("拖动时实时调整尺寸","Real-time resizing")} description={tx("开启后拖动分隔线时实时调整；关闭后释放鼠标再应用。","Update panels while dragging. If disabled, apply the new size when the pointer is released.")} checked={settings.liveResize} onChange={liveResize => update({ liveResize })}/><Toggle label={tx("在新标签页打开提交记录","Open submissions in a new tab")} description={tx("从当前答题页查看提交时打开新标签页。","Open submission details in a new browser tab from this workspace.")} checked={settings.openResultsNewTab} onChange={openResultsNewTab => update({ openResultsNewTab })}/><p className="py-5 text-xs leading-5 text-muted-foreground">{tx("布局与编辑器设置保存在当前浏览器；不会上传到服务器。","Layout and editor settings are saved in this browser and are not uploaded to the server.")}</p></div>}
      {section === "timer" && <div className="divide-y divide-border"><Toggle label={tx("自动重置个人计时器","Auto-reset personal timer")} description={tx("通过正式提交或打开另一道题目时重置个人计时器。","Reset the personal timer after a formal submission or when switching problems.")} checked={settings.autoResetTimer} onChange={autoResetTimer => update({ autoResetTimer })}/><Toggle label={tx("个人倒计时提醒","Countdown alerts")} description={tx("剩余 10 分钟及倒计时结束时播放提示音。","Play a sound at 10 minutes remaining and when the countdown ends.")} checked={settings.superAlarm} onChange={superAlarm => update({ superAlarm })}/><p className="py-5 text-xs leading-5 text-muted-foreground">{tx("个人计时器不影响限时练习的服务器倒计时或交卷时间。","The personal timer does not affect the server timer or deadline for timed practice.")}</p></div>}
    </div>
  </DialogContent></Dialog>;
}
