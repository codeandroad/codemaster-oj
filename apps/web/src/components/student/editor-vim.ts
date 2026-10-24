import type { EditSnapshot } from "./editor-behavior";

/** A bounded Vim keymap for our existing textarea, not an Ex interpreter. */
export type VimMode = "normal" | "insert" | "visual" | "visual-line";
export interface VimState {
  mode: VimMode;
  count: string;
  operator: "d" | "c" | "y" | "";
  operatorCount: number;
  pending: string;
  register: string;
  linewise: boolean;
  anchor: number;
  head: number;
  column: number | null;
  search: string;
  query: string | null;
}
export const createVimState = (): VimState => ({ mode: "normal", count: "", operator: "", operatorCount: 1, pending: "", register: "", linewise: false, anchor: 0, head: 0, column: null, search: "", query: null });
export interface VimResult { state: VimState; snapshot: EditSnapshot; history?: "undo" | "redo" }
type Key = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };
const lineStart = (text: string, at: number) => at <= 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (text: string, at: number) => { const end = text.indexOf("\n", at); return end < 0 ? text.length : end; };
const previousChar = (text: string, at: number) => Math.max(0, at - (/[\uDC00-\uDFFF]/.test(text[at - 1] ?? "") && /[\uD800-\uDBFF]/.test(text[at - 2] ?? "") ? 2 : 1));
const nextChar = (text: string, at: number) => Math.min(text.length, at + (/[\uD800-\uDBFF]/.test(text[at] ?? "") && /[\uDC00-\uDFFF]/.test(text[at + 1] ?? "") ? 2 : 1));
function characters(text: string, at: number, count: number) { for (let n = 0; n < Math.abs(count); n++) at = count < 0 ? previousChar(text, at) : nextChar(text, at); return at; }
const caret = (text: string, at: number) => {
  at = Math.max(0, Math.min(text.length, at));
  at = Math.max(lineStart(text, at), Math.min(at, lineEnd(text, at) - 1));
  return /[\uDC00-\uDFFF]/.test(text[at] ?? "") && at > 0 ? at - 1 : at;
};
const wordClass = (char: string | undefined) => !char || /\s/u.test(char) ? 0 : /[\p{L}\p{N}_]/u.test(char) ? 1 : 2;
function word(text: string, at: number, direction: "w" | "b" | "e") {
  if (direction === "b") {
    at = Math.max(0, at - 1);
    while (at > 0 && !wordClass(text[at])) at--;
    const kind = wordClass(text[at]);
    while (at > 0 && wordClass(text[at - 1]) === kind) at--;
  } else if (direction === "w") {
    const kind = wordClass(text[at]);
    while (at < text.length && wordClass(text[at]) === kind) at++;
    while (at < text.length && !wordClass(text[at])) at++;
  } else {
    at = Math.min(text.length, at + 1);
    while (at < text.length && !wordClass(text[at])) at++;
    const kind = wordClass(text[at]);
    while (at + 1 < text.length && wordClass(text[at + 1]) === kind) at++;
  }
  return at;
}
function vertical(text: string, at: number, delta: number, column: number) {
  let start = lineStart(text, at);
  for (let i = 0; i < Math.abs(delta); i++) {
    if (delta < 0) { if (!start) break; start = lineStart(text, start - 1); }
    else { const end = lineEnd(text, start); if (end === text.length) break; start = end + 1; }
  }
  return caret(text, start + Math.min(column, lineEnd(text, start) - start));
}
function lineRange(text: string, a: number, b: number): [number, number] {
  const start = lineStart(text, Math.min(a, b)), end = lineEnd(text, Math.max(a, b));
  return [start, end < text.length ? end + 1 : end];
}
export function vimKey(snapshot: EditSnapshot, previous: VimState, event: Key, autoIndent = true): VimResult | null {
  const state = { ...previous }, text = snapshot.value;
  let at = state.mode.startsWith("visual") ? caret(text, state.head) : state.mode === "insert" ? snapshot.start : caret(text, snapshot.start);
  const reset = () => { state.count = ""; state.operator = ""; state.operatorCount = 1; state.pending = ""; };
  const result = (value = text, start = at, end = start): VimResult => ({ state, snapshot: { value, start, end } });
  const normal = (value = text, position = at) => { state.mode = "normal"; reset(); state.column = null; at = caret(value, position); state.head = at; return result(value, at); };
  const escape = event.key === "Escape" || (event.ctrlKey && !event.metaKey && ["[", "c"].includes(event.key));
  if (escape) {
    state.query = null;
    return normal(text, state.mode === "insert" ? Math.max(lineStart(text, at), previousChar(text, at)) : at);
  }
  if (state.mode === "insert") return null;
  if (event.metaKey || event.altKey) return null;
  if (event.ctrlKey) {
    if (event.key.toLowerCase() === "r") { const next = normal(); return { ...next, history: "redo" }; }
    if (["d", "u"].includes(event.key.toLowerCase())) { at = vertical(text, at, event.key.toLowerCase() === "d" ? 10 : -10, at - lineStart(text, at)); return normal(); }
    return null;
  }
  const key = event.key;
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Process", "Tab"].includes(key)) return null;
  if (state.query !== null) {
    if (key === "Backspace") state.query = state.query.slice(0, -1);
    else if (key === "Enter") {
      state.search = state.query || state.search; state.query = null;
      if (state.search) { const found = text.indexOf(state.search, at + 1), wrapped = text.indexOf(state.search); at = found < 0 ? wrapped < 0 ? at : wrapped : found; }
    } else if (key.length === 1) state.query += key;
    return result();
  }
  if (key === "/") { reset(); state.query = ""; return result(); }
  const visual = state.mode === "visual" || state.mode === "visual-line";
  if (!state.pending && /^\d$/.test(key) && (key !== "0" || state.count)) {
    state.count = String(Math.min(999, Number(state.count + key))); return result(snapshot.value, snapshot.start, snapshot.end);
  }
  const count = Number(state.count || 1) * state.operatorCount;
  const change = (start: number, end: number, linewise: boolean, operation = state.operator || "d") => {
    state.register = text.slice(start, end); state.linewise = linewise;
    if (linewise && !state.register.endsWith("\n")) state.register += "\n";
    if (operation === "y") return normal(text, start);
    let replacement = "";
    // Deleting the last line also removes its preceding separator; keep it for cc.
    if (linewise && end === text.length && start > 0 && operation !== "c") start--;
    if (linewise && operation === "c" && end < text.length) replacement = "\n";
    const value = text.slice(0, start) + replacement + text.slice(end);
    const next = normal(value, start);
    if (operation === "c") { state.mode = "insert"; next.snapshot.start = next.snapshot.end = start; }
    return next;
  };
  const selection = () => state.mode === "visual-line" ? lineRange(text, state.anchor, at) : [Math.min(state.anchor, at), nextChar(text, Math.max(state.anchor, at))] as [number, number];
  if (visual && ["d", "x", "c", "y"].includes(key)) {
    const [start, end] = selection(); return change(start, end, state.mode === "visual-line", key === "x" ? "d" : key as "d" | "c" | "y");
  }
  if (state.pending === "r") {
    if (key.length !== 1) return normal();
    const end = Math.min(lineEnd(text, at), characters(text, at, count));
    return normal(text.slice(0, at) + key.repeat([...text.slice(at, end)].length) + text.slice(end), at);
  }
  if (state.pending === "iw" || state.pending === "aw") {
    if (key !== "w") return normal();
    const kind = wordClass(text[at]); let start = at, end = at;
    while (start > lineStart(text, at) && wordClass(text[start - 1]) === kind) start--;
    while (end < text.length && wordClass(text[end]) === kind) end++;
    if (state.pending === "aw") while (end < text.length && /[ \t]/.test(text[end])) end++;
    return change(start, end, false);
  }
  if (state.operator && (key === "i" || key === "a")) { state.pending = key === "i" ? "iw" : "aw"; return result(); }
  let target: number | null = null, inclusive = false, linewise = false;
  const pending = state.pending;
  if (pending === "f" || pending === "F") {
    target = at;
    for (let n = 0; n < count; n++) {
      const found: number = pending === "f" ? text.indexOf(key, target! + 1) : target! > 0 ? text.lastIndexOf(key, target! - 1) : -1;
      if (key.length !== 1 || found < lineStart(text, at) || found >= lineEnd(text, at)) { reset(); return result(snapshot.value, snapshot.start, snapshot.end); }
      target = found;
    }
    inclusive = true;
  } else if (pending === "g") {
    if (key !== "g") return normal();
    target = vertical(text, 0, count - 1, 0); linewise = true;
  } else if (["g", "f", "F"].includes(key)) { state.pending = key; return result(snapshot.value, snapshot.start, snapshot.end); }
  else if (["d", "c", "y"].includes(key)) {
    if (state.operator === key) { const end = vertical(text, at, count - 1, 0); return change(...lineRange(text, at, end), true); }
    state.operator = key as VimState["operator"]; state.operatorCount = count; state.count = ""; return result();
  } else if (["h", "ArrowLeft", "Backspace"].includes(key)) target = Math.max(lineStart(text, at), characters(text, at, -count));
  else if (["l", "ArrowRight", " "].includes(key)) target = Math.min(lineEnd(text, at), characters(text, at, count));
  else if (["j", "k", "ArrowDown", "ArrowUp", "Enter"].includes(key)) {
    state.column ??= at - lineStart(text, at);
    target = vertical(text, at, ["k", "ArrowUp"].includes(key) ? -count : count, state.column); linewise = true;
  } else if (key === "0" || key === "Home") target = lineStart(text, at);
  else if (key === "^") target = lineStart(text, at) + (text.slice(lineStart(text, at), lineEnd(text, at)).match(/^\s*/)?.[0].length ?? 0);
  else if (key === "$" || key === "End") { target = Math.max(lineStart(text, at), lineEnd(text, at) - 1); inclusive = true; }
  else if (["w", "b", "e"].includes(key)) {
    target = at;
    if (state.operator === "c" && key === "w" && wordClass(text[at])) {
      for (let n = 0; n < count; n++) {
        if (n) target = word(text, target, "w");
        const kind = wordClass(text[target]);
        while (target + 1 < text.length && wordClass(text[target + 1]) === kind) target++;
      }
      inclusive = true;
    } else { for (let n = 0; n < count; n++) target = word(text, target, key as "w" | "b" | "e"); inclusive = key === "e"; }
  }
  else if (key === "G") { target = state.count || state.operatorCount > 1 ? vertical(text, 0, count - 1, 0) : lineStart(text, text.length); linewise = true; }
  else if ((key === "n" || key === "N") && state.search) {
    target = at;
    for (let n = 0; n < count; n++) {
      const found: number = key === "n" ? text.indexOf(state.search, target! + 1) : target! > 0 ? text.lastIndexOf(state.search, target! - 1) : -1;
      target = found < 0 ? key === "n" ? text.indexOf(state.search) : text.lastIndexOf(state.search) : found;
      if (target! < 0) target = at;
    }
  }
  if (target !== null) {
    state.pending = "";
    if (state.operator) {
      if (linewise) return change(...lineRange(text, at, target), true);
      return change(Math.min(at, target), inclusive ? nextChar(text, caret(text, Math.max(at, target))) : Math.min(text.length, Math.max(at, target)), false);
    }
    if (!["j", "k", "ArrowDown", "ArrowUp", "Enter"].includes(key)) state.column = null;
    at = caret(text, target); state.head = at; state.count = "";
    if (visual) { const [start, end] = selection(); return result(text, start, end); }
    return result();
  }
  if (state.operator) return normal();
  if (["v", "V"].includes(key)) {
    if ((key === "v" && state.mode === "visual") || (key === "V" && state.mode === "visual-line")) return normal();
    state.mode = key === "v" ? "visual" : "visual-line"; if (!visual) state.anchor = at; state.head = at;
    const [start, end] = selection(); return result(text, start, end);
  }
  if (["i", "a", "I", "A", "o", "O"].includes(key)) {
    reset(); state.mode = "insert";
    if (key === "a") at = Math.min(lineEnd(text, at), nextChar(text, at));
    if (key === "A") at = lineEnd(text, at);
    if (key === "I") at = lineStart(text, at) + (text.slice(lineStart(text, at), lineEnd(text, at)).match(/^[ \t]*/)?.[0].length ?? 0);
    if (key === "o" || key === "O") {
      const indent = autoIndent ? text.slice(lineStart(text, at), lineEnd(text, at)).match(/^[ \t]*/)?.[0] ?? "" : "";
      const start = key === "o" ? lineEnd(text, at) : lineStart(text, at);
      const addition = key === "o" ? "\n" + indent : indent + "\n";
      return result(text.slice(0, start) + addition + text.slice(start), start + (key === "o" ? addition.length : indent.length));
    }
    return result();
  }
  if (key === "u") { const next = normal(); return { ...next, history: "undo" }; }
  if (["x", "Delete", "X"].includes(key)) return change(key === "X" ? Math.max(lineStart(text, at), characters(text, at, -count)) : at, key === "X" ? at : Math.min(lineEnd(text, at), characters(text, at, count)), false);
  if (["D", "C", "s", "S", "Y"].includes(key)) {
    if (key === "S" || key === "Y") return change(...lineRange(text, at, vertical(text, at, count - 1, 0)), true, key === "Y" ? "y" : "c");
    return change(at, key === "s" ? Math.min(lineEnd(text, at), characters(text, at, count)) : lineEnd(text, at), false, key === "D" ? "d" : "c");
  }
  if ((key === "p" || key === "P") && state.register) {
    const content = state.register.repeat(count);
    if (state.linewise) {
      const end = lineEnd(text, at), start = key === "P" ? lineStart(text, at) : Math.min(text.length, end + 1);
      const addition = key === "p" && end === text.length ? "\n" + content.slice(0, -1) : content;
      return normal(text.slice(0, start) + addition + text.slice(start), start + (addition.startsWith("\n") ? 1 : 0));
    }
    const start = key === "p" ? Math.min(lineEnd(text, at), nextChar(text, at)) : at;
    return normal(text.slice(0, start) + content + text.slice(start), start + content.length - 1);
  }
  if (key === "r") { state.pending = "r"; return result(); }
  if (key === "J") {
    const end = lineEnd(text, at);
    if (end < text.length) return normal(text.slice(0, end).trimEnd() + " " + text.slice(end + 1).replace(/^[ \t]*/, ""), end);
  }
  reset();
  // Consume unsupported normal-mode text keys; never insert them into student code.
  return result(snapshot.value, snapshot.start, snapshot.end);
}
