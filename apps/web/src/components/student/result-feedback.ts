export interface ResultCase {
  position: number;
  status: string;
  timeMs?: number | null;
  memoryKb?: number | null;
  visibility?: "public";
  mode?: "stdio" | "function";
  comparator?: string;
  input?: string;
  expected?: string;
  output?: string | null;
  stdout?: string;
  stderr?: string;
  reason?: "input_mutation";
  truncated?: boolean;
}
export interface CodeLocation { line: number; column?: number; file: string }
export interface DiffPart { text: string; changed: boolean }

export function defaultResultCase(cases: ResultCase[]) {
  const index = cases.findIndex(c => !["AC", "Executed", "NotRun"].includes(c.status));
  return index >= 0 ? index : 0;
}

// Bounded character diff, preserving Unicode and significant whitespace. Very
// large outputs use a common-prefix/suffix comparison instead of quadratic work.
export function outputDifference(actual: string, expected: string): { actual: DiffPart[]; expected: DiffPart[] } {
  const a = Array.from(actual), b = Array.from(expected);
  const result: { actual: DiffPart[]; expected: DiffPart[] } = { actual: [], expected: [] };
  function push(side: DiffPart[], text: string, changed: boolean) {
    if (!text) return;
    if (side.at(-1)?.changed === changed) side[side.length - 1].text += text;
    else side.push({ text, changed });
  }
  if (a.length * b.length > 1_000_000) {
    let start = 0, end = 0;
    while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
    while (end < Math.min(a.length, b.length) - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
    for (const [chars, side] of [[a, result.actual], [b, result.expected]] as const) {
      push(side, chars.slice(0, start).join(""), false);
      push(side, chars.slice(start, chars.length - end).join(""), true);
      push(side, chars.slice(chars.length - end).join(""), false);
    }
    return result;
  }
  const width = b.length + 1, lengths = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    lengths[i * width + j] = a[i] === b[j] ? lengths[(i + 1) * width + j + 1] + 1 : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
  }
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { push(result.actual, a[i++], false); push(result.expected, b[j++], false); }
    else if (i < a.length && (j === b.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) push(result.actual, a[i++], true);
    else push(result.expected, b[j++], true);
  }
  return result;
}

export function readableDiagnostic(raw: string, language = "python", functionMode = false): { text: string; location?: CodeLocation } {
  // Escape sequences from user stdout/stderr are text, never terminal controls.
  const cleaned = raw.slice(0, 16384).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const file = language === "cpp" ? "main.cpp" : language === "javascript" ? "main.js" : "main.py";
  let location: CodeLocation | undefined;
  let output = cleaned;
  if (language === "python") {
    const frames = [...cleaned.matchAll(/File "(?:\/w\/)?main\.py", line (\d+)/g)];
    const syntax = cleaned.match(/(?:SyntaxError|IndentationError|TabError) at line (\d+)(?:, column (\d+))?/);
    const match = frames.at(-1) ?? syntax;
    if (match) location = { file, line: Number(match[1]), ...(syntax?.[2] ? { column: Number(syntax[2]) } : {}) };
    // Drop runner/library frames, retain the student's frames and exception text.
    let skipFrame = false;
    output = cleaned.split("\n").filter(line => {
      if (/^\s*File "/.test(line)) { skipFrame = !/File "(?:\/w\/)?main\.py"/.test(line); return !skipFrame; }
      if (skipFrame && /^\s/.test(line)) return false;
      if (line.trim()) skipFrame = false;
      return true;
    }).join("\n").replaceAll('"/w/main.py"', '"main.py"');
  } else {
    const pattern = language === "cpp" ? /(?:\/w\/)?main\.cpp:(\d+)(?::(\d+))?/g : /(?:\/w\/)?main\.js:(\d+)(?::(\d+))?/g;
    const matches = [...cleaned.matchAll(pattern)], match = matches[0];
    const functionStack = language === "javascript" && functionMode && /^\s+at .*main\.js:/m.test(cleaned);
    if (match) location = { file, line: Math.max(1, Number(match[1]) - (functionStack ? 2 : 0)), ...(match[2] ? { column: Number(match[2]) } : {}) };
    output = cleaned.replaceAll(`/w/${file}`, file);
    if (language === "javascript") output = output.split("\n").filter(line => !/^\s+at /.test(line) || line.includes("main.js:")).map(line => functionStack && /^\s+at /.test(line) ? line.replace(/main\.js:(\d+)/g, (_, number: string) => `main.js:${Math.max(1, Number(number) - 2)}`) : line).join("\n");
  }
  if (location && (!Number.isSafeInteger(location.line) || location.line < 1)) location = undefined;
  return { text: output.trim(), location };
}

export function codeLocationOffset(code: string, line: number, column = 1) {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
  const lines = code.split("\n");
  if (line > lines.length) return null;
  return lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0) + Math.min(column - 1, lines[line - 1].length);
}
