export const panelIds = ["statement", "editor", "testing"] as const;
export type WorkspacePanel = typeof panelIds[number];
export type PanelMode = "open" | "collapsed" | "hidden";
export interface WorkspaceLayout {
  panels: Record<WorkspacePanel, PanelMode>;
  maximized: WorkspacePanel | null;
  editorPercent: number;
  mobilePanel: WorkspacePanel;
}
export type LayoutAction =
  | { type: "toggle-collapse" | "toggle-maximize" | "hide" | "show" | "mobile"; panel: WorkspacePanel }
  | { type: "resize"; percent: number }
  | { type: "reset" }
  | { type: "exit-maximize" };
export function defaultLayout(): WorkspaceLayout {
  return { panels: { statement: "open", editor: "open", testing: "open" }, maximized: null, editorPercent: 63, mobilePanel: "editor" };
}
export function restoreLayout(value: unknown): WorkspaceLayout {
  const initial = defaultLayout();
  if (!value || typeof value !== "object") return initial;
  const source = value as Partial<WorkspaceLayout>;
  for (const id of panelIds) {
    const mode = source.panels?.[id];
    if (mode === "open" || mode === "collapsed" || mode === "hidden") initial.panels[id] = mode;
  }
  if (!panelIds.some(id => initial.panels[id] === "open")) initial.panels.editor = "open";
  if (typeof source.editorPercent === "number" && Number.isFinite(source.editorPercent)) initial.editorPercent = Math.max(20, Math.min(85, source.editorPercent));
  if (panelIds.includes(source.mobilePanel as WorkspacePanel)) initial.mobilePanel = source.mobilePanel!;
  // A reload always exits temporary maximization; saved dimensions and panel visibility remain.
  return initial;
}
export function workspaceLayoutReducer(state: WorkspaceLayout, action: LayoutAction): WorkspaceLayout {
  if (action.type === "reset") return defaultLayout();
  if (action.type === "exit-maximize") return { ...state, maximized: null };
  if (action.type === "resize") return Number.isFinite(action.percent) ? { ...state, editorPercent: Math.max(20, Math.min(85, action.percent)) } : state;
  const panel = action.panel;
  if (action.type === "toggle-maximize") return { ...state, panels: { ...state.panels, [panel]: "open" }, maximized: state.maximized === panel ? null : panel, mobilePanel: panel };
  if (action.type === "show" || action.type === "mobile") return { ...state, panels: { ...state.panels, [panel]: "open" }, maximized: null, mobilePanel: panel };
  const nextMode: PanelMode = action.type === "hide" ? "hidden" : state.panels[panel] === "collapsed" ? "open" : "collapsed";
  // Always keep at least one full panel usable, even when every other region is hidden/collapsed.
  if (nextMode !== "open" && !panelIds.some(id => id !== panel && state.panels[id] === "open")) return state;
  const panels = { ...state.panels, [panel]: nextMode };
  const mobilePanel = panels[state.mobilePanel] === "open" ? state.mobilePanel : panelIds.find(id => panels[id] === "open")!;
  return { ...state, panels, maximized: null, mobilePanel };
}
