import type { Paper4Paper } from "./model";

export interface OriginalQuestionSegment {
  src: string;
  width: number;
  height: number;
  page: number;
}

export interface OriginalQuestionPart {
  key: string;
  label: string;
  segments: OriginalQuestionSegment[];
}

export interface OriginalQuestion {
  statementSha256: string;
  stem: OriginalQuestionSegment[];
  parts: OriginalQuestionPart[];
}

export interface OriginalQuestionManifest {
  version: 1;
  paperKey: string;
  sourceSha256: string;
  pdf: string;
  questions: Record<string, OriginalQuestion>;
}

/** Mirror domain field() normalization without changing internal text or layout. */
export function paper4OriginalStatement(statement: string): string {
  return statement.trim();
}

/** Exact exam metadata is required: custom titles must never select a PDF. */
export function paper4OriginalPaperKey(paper: Pick<Paper4Paper, "examYear" | "examSession" | "examVariant">): string | null {
  if (!Number.isInteger(paper.examYear) || paper.examYear! < 2000 || paper.examYear! > 2099 || ![41, 42, 43].includes(paper.examVariant ?? 0)) return null;
  const season = paper.examSession === "summer" ? "s" : paper.examSession === "autumn" ? "w" : null;
  return season ? `9618_${season}${String(paper.examYear).slice(-2)}_${paper.examVariant}` : null;
}

/** Only flat, same-folder asset names are accepted, never URLs or paths. */
function assetName(value: unknown, extension: "pdf" | "webp"): value is string {
  return typeof value === "string" && value.length <= 160 && !value.includes("..") && new RegExp(`^[a-zA-Z0-9][a-zA-Z0-9._-]*\\.${extension}$`).test(value);
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function segments(value: unknown): OriginalQuestionSegment[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const parsed: OriginalQuestionSegment[] = [];
  for (const segment of value) {
    if (!record(segment) || !assetName(segment.src, "webp") || !integer(segment.width, 32, 6000) || !integer(segment.height, 1, 20000) || !integer(segment.page, 1, 100)) return null;
    parsed.push({ src: segment.src, width: segment.width, height: segment.height, page: segment.page });
  }
  return parsed;
}

export function parsePaper4OriginalManifest(value: unknown, paperKey: string): OriginalQuestionManifest | null {
  if (!record(value) || value.version !== 1 || value.paperKey !== paperKey || !/^9618_[sw]\d{2}_4[123]$/.test(paperKey) || !hash(value.sourceSha256) || !assetName(value.pdf, "pdf") || !record(value.questions)) return null;
  const entries = Object.entries(value.questions);
  if (entries.length < 1 || entries.length > 10) return null;
  const questions: Record<string, OriginalQuestion> = {};
  let segmentCount = 0;
  for (const [key, question] of entries) {
    if (!/^Q[1-9]\d?$/.test(key) || !record(question) || !hash(question.statementSha256) || !Array.isArray(question.parts) || question.parts.length > 26) return null;
    const stem = segments(question.stem);
    if (!stem) return null;
    const parts: OriginalQuestionPart[] = [];
    const used = new Set<string>();
    for (const part of question.parts) {
      if (!record(part) || typeof part.key !== "string" || !/^[a-z]$/.test(part.key) || part.label !== `(${part.key})` || used.has(part.key)) return null;
      const images = segments(part.segments);
      if (!images?.length) return null;
      used.add(part.key);
      parts.push({ key: part.key, label: part.label, segments: images });
    }
    const total = stem.length + parts.reduce((sum, part) => sum + part.segments.length, 0);
    segmentCount += total;
    if (total < 1 || segmentCount > 192) return null;
    questions[key] = { statementSha256: question.statementSha256, stem, parts };
  }
  return { version: 1, paperKey, sourceSha256: value.sourceSha256, pdf: value.pdf, questions };
}

/** Roman subparts remain grouped under their literal main letter. */
export function paper4OriginalStagePart(title: string | undefined): string | null {
  return title?.match(/^\s*(?:Q?\d+\s*)?\(\s*([a-z])\s*\)(?:\s*\([ivx]+\))?/i)?.[1].toLowerCase() ?? null;
}

export function paper4OriginalSegments(question: OriginalQuestion, part: string): OriginalQuestionSegment[] {
  const selected = question.parts.find(item => item.key === part);
  return [...question.stem, ...(selected ? selected.segments : question.parts.flatMap(item => item.segments))];
}
