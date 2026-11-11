import { contentBlocks } from "../content-parser.ts";

/** All source blocks must be present; matching code alone must not hide missing explanation. */
export function includesOriginalSolution(items: readonly { body: string }[], source: { body: string }) {
  const blocks = contentBlocks(source.body);
  if (!blocks.length) return false;
  return items.some(item => {
    if (item.body.trim() === source.body.trim()) return true;
    const existing = contentBlocks(item.body);
    return blocks.every(block => existing.some(other => {
      if (block.kind !== other.kind) return false;
      if (block.kind === "code") return other.text.trimEnd() === block.text.trimEnd();
      return JSON.stringify(block) === JSON.stringify(other);
    }));
  });
}
