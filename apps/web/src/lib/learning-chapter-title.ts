// Keep chapter ordering in the UI while preserving authored titles in storage.
export function chapterDirectoryTitle(title: string, index: number): string {
  let label = title.trim();
  for (let pass = 0; pass < 3; pass++) {
    const explicit = label.replace(
      /^(?:第\s*[\d零〇一二三四五六七八九十百两]+\s*章\s*[:：.．、)）·-]?\s*|Chapter\s+\d{1,3}(?:\s*[:：.．、)）·-]\s*|\s+))/iu,
      "",
    );
    const punctuated = explicit.replace(/^\d{1,3}\s*[.．、:：)）](?!\d)\s*(?=\S)/u, "");
    let next = punctuated;
    const plain = next.match(/^(\d{1,3})\s+(.+)$/u);
    // Zero padding is an explicit ordinal convention. A bare number is only
    // treated as an ordinal when it matches this chapter's current position.
    if (plain && (plain[1].startsWith("0") || Number(plain[1]) === index + 1)) {
      next = plain[2];
    }
    next = next.trim();
    if (!next || next === label) break;
    label = next;
  }
  return `${index + 1}. ${label}`;
}
