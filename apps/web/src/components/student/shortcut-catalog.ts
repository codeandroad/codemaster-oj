import {defaultEditorKeymap,editorActions,editorActionLabels,displayBinding,type EditorKeymap} from "./editor-keymap.ts";
export function editorShortcutRows(bindings:EditorKeymap=defaultEditorKeymap){return [...editorActions.map(action=>[editorActionLabels[action],displayBinding(bindings[action])] as const),["缩进 / 取消缩进","Tab / Shift + Tab"],["剪切 / 复制 / 粘贴","Ctrl / ⌘ + X / C / V"]] as const;}
export const editorShortcuts=editorShortcutRows();
export const workspaceShortcuts=[['关闭答题页（返回列表）','Alt + W'],['保存本机草稿','Ctrl / ⌘ + S'],['最大化 / 还原活动面板','Alt + +'],['进入 / 退出全屏','Alt + F'],['还原最大化 / 关闭弹窗','Esc']] as const;

// Explicitly unavailable until an isolated debug session service is connected.
export const debugShortcuts=[['开始调试 · Start Debugging',"Ctrl / ⌘ + Alt + '"],['停止调试 · Stop Debugging','Esc'],['继续执行 · Skip Forward','F5'],['单步跳过 · Step over','F10'],['单步进入 · Step in','Shift + F11'],['单步跳出 · Step out','Ctrl / ⌘ + F11'],['重新启动 · Restart','Ctrl / ⌘ + Shift + F5']] as const;
