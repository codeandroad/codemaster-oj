import type { LocalizedText } from "./model";

export type AcslDiagramPaint =
  | "ink"
  | "muted"
  | "accent"
  | "surface"
  | "none"
  | "red"
  | "green"
  | "blue"
  | "yellow"
  | "orange"
  | "cyan"
  | "magenta"
  | "white"
  | "black";
type DiagramStyle = {
  stroke?: AcslDiagramPaint;
  fill?: AcslDiagramPaint;
  strokeWidth?: number;
};
export type AcslDiagramElement = DiagramStyle &
  (
    | { type: "path"; d: string }
    | { type: "line"; x1: number; y1: number; x2: number; y2: number }
    | { type: "polyline"; points: [number, number][] }
    | { type: "circle"; cx: number; cy: number; r: number }
    | {
        type: "rect";
        x: number;
        y: number;
        width: number;
        height: number;
        rx?: number;
      }
    | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
    | {
        type: "text";
        x: number;
        y: number;
        text: string;
        fontSize?: number;
        anchor?: "start" | "middle" | "end";
        font?: "sans" | "serif" | "mono";
        weight?: "normal" | "bold";
      }
  );
export type AcslDiagram = {
  id: string;
  width: number;
  height: number;
  alt: LocalizedText;
  elements: AcslDiagramElement[];
};
export type AcslDiagrams = { en: AcslDiagram[]; zh: AcslDiagram[] };

export type AcslContentPart =
  | { kind: "text"; text: string }
  | { kind: "diagram"; id: string };

/** Diagram placeholders are standalone paragraphs, never executable markup or code-fence content. */
export function acslContentParts(
  content: string,
  diagramIds: string[],
): AcslContentPart[] {
  const known = new Set(diagramIds);
  const used = new Set<string>();
  const parts: AcslContentPart[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let buffer: string[] = [];
  let fence = "";
  let math = "";
  function flush() {
    const text = buffer.join("\n");
    if (text.trim()) parts.push({ kind: "text", text });
    buffer = [];
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    const delimiter = trimmed.match(/^(`{3,}|~{3,})/)?.[1];
    if (fence) {
      buffer.push(line);
      if (trimmed.startsWith(fence)) fence = "";
      continue;
    }
    if (delimiter) {
      fence = delimiter;
      buffer.push(line);
      continue;
    }
    if (math) {
      buffer.push(line);
      if (trimmed.endsWith(math)) math = "";
      continue;
    }
    if (trimmed === "$$" || trimmed === "\\[") {
      math = trimmed === "$$" ? "$$" : "\\]";
      buffer.push(line);
      continue;
    }
    const placeholder = trimmed.match(
      /^\{\{diagram:([A-Za-z0-9-]{1,100})\}\}$/,
    );
    if (
      placeholder &&
      known.has(placeholder[1]) &&
      (index === 0 || !lines[index - 1].trim()) &&
      (index === lines.length - 1 || !lines[index + 1].trim())
    ) {
      flush();
      parts.push({ kind: "diagram", id: placeholder[1] });
      used.add(placeholder[1]);
    } else buffer.push(line);
  }
  flush();
  for (const id of diagramIds)
    if (!used.has(id)) parts.push({ kind: "diagram", id });
  return parts;
}
