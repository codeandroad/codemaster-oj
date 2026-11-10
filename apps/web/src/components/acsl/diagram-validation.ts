import type { AcslDiagrams } from "./diagram-model";

const paints = new Set([
  "ink",
  "muted",
  "accent",
  "surface",
  "none",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "cyan",
  "magenta",
  "white",
  "black",
]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const number = (value: unknown, min: number, max: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
const coordinate = (value: unknown) => number(value, -16384, 16384);
const text = (value: unknown, max: number) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !value.includes("\0");

function path(value: unknown) {
  if (typeof value !== "string" || !text(value, 128000)) return false;
  const tokens = [
    ...value.matchAll(
      /[MmLlCcQqZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g,
    ),
  ];
  if (!tokens.length || !/^[Mm]$/.test(tokens[0][0])) return false;
  let end = 0;
  for (const token of tokens) {
    if (!/^[\s,]*$/.test(value.slice(end, token.index))) return false;
    end = token.index + token[0].length;
  }
  if (!/^[\s,]*$/.test(value.slice(end))) return false;
  const arity: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };
  for (let i = 0; i < tokens.length; ) {
    const command = tokens[i++][0].toUpperCase();
    if (!(command in arity)) return false;
    let count = 0;
    while (i < tokens.length && !/^[MmLlCcQqZz]$/.test(tokens[i][0])) {
      if (!coordinate(Number(tokens[i++][0]))) return false;
      count++;
    }
    if (
      arity[command] === 0
        ? count !== 0
        : count === 0 || count % arity[command] !== 0
    )
      return false;
  }
  return true;
}

function element(value: unknown) {
  if (!record(value)) return false;
  if (
    value.stroke !== undefined &&
    (typeof value.stroke !== "string" || !paints.has(value.stroke))
  )
    return false;
  if (
    value.fill !== undefined &&
    (typeof value.fill !== "string" || !paints.has(value.fill))
  )
    return false;
  if (value.strokeWidth !== undefined && !number(value.strokeWidth, 0, 32))
    return false;
  const allowed = (names: string[]) =>
    keys(value, ["type", "stroke", "fill", "strokeWidth", ...names]);
  const coordinates = (names: string[]) =>
    names.every((key) => coordinate(value[key]));
  switch (value.type) {
    case "path":
      return allowed(["d"]) && path(value.d);
    case "line":
      return (
        allowed(["x1", "y1", "x2", "y2"]) &&
        coordinates(["x1", "y1", "x2", "y2"])
      );
    case "polyline":
      return (
        allowed(["points"]) &&
        Array.isArray(value.points) &&
        value.points.length >= 2 &&
        value.points.length <= 2000 &&
        value.points.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every(coordinate),
        )
      );
    case "circle":
      return (
        allowed(["cx", "cy", "r"]) &&
        coordinates(["cx", "cy"]) &&
        number(value.r, 0.01, 4096)
      );
    case "ellipse":
      return (
        allowed(["cx", "cy", "rx", "ry"]) &&
        coordinates(["cx", "cy"]) &&
        number(value.rx, 0.01, 4096) &&
        number(value.ry, 0.01, 4096)
      );
    case "rect":
      return (
        allowed(["x", "y", "width", "height", "rx"]) &&
        coordinates(["x", "y"]) &&
        number(value.width, 0.01, 4096) &&
        number(value.height, 0.01, 4096) &&
        (value.rx === undefined || number(value.rx, 0, 2048))
      );
    case "text":
      return (
        allowed(["x", "y", "text", "fontSize", "anchor", "font", "weight"]) &&
        coordinates(["x", "y"]) &&
        text(value.text, 1000) &&
        (value.fontSize === undefined || number(value.fontSize, 1, 256)) &&
        (value.anchor === undefined ||
          (typeof value.anchor === "string" &&
            ["start", "middle", "end"].includes(value.anchor))) &&
        (value.font === undefined ||
          (typeof value.font === "string" &&
            ["sans", "serif", "mono"].includes(value.font))) &&
        (value.weight === undefined ||
          (typeof value.weight === "string" &&
            ["normal", "bold"].includes(value.weight)))
      );
    default:
      return false;
  }
}

/** A client preview guard; the domain validator remains authoritative on save. */
export function validAcslDiagrams(value: unknown): value is AcslDiagrams {
  if (!record(value) || !keys(value, ["en", "zh"])) return false;
  for (const language of ["en", "zh"]) {
    const diagrams = value[language];
    if (!Array.isArray(diagrams) || diagrams.length > 20) return false;
    const ids = new Set<string>();
    for (const diagram of diagrams) {
      if (
        !record(diagram) ||
        !keys(diagram, ["id", "width", "height", "alt", "elements"]) ||
        typeof diagram.id !== "string" ||
        !/^[A-Za-z0-9-]{1,100}$/.test(diagram.id) ||
        ids.has(diagram.id) ||
        !number(diagram.width, 1, 4096) ||
        !number(diagram.height, 1, 4096) ||
        !record(diagram.alt) ||
        !keys(diagram.alt, ["en", "zh"]) ||
        !text(diagram.alt.en, 1000) ||
        !text(diagram.alt.zh, 1000) ||
        !Array.isArray(diagram.elements) ||
        !diagram.elements.length ||
        diagram.elements.length > 1000 ||
        !diagram.elements.every(element)
      )
        return false;
      ids.add(diagram.id);
    }
  }
  return true;
}

export function parseAcslDiagrams(source: string): AcslDiagrams | null {
  try {
    const value: unknown = JSON.parse(source);
    return validAcslDiagrams(value) ? value : null;
  } catch {
    return null;
  }
}
