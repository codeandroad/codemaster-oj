export function formatPaper4Statement(content: string): string {
  // Imported papers may contain a whole question in one line. Add only visual
  // paragraph breaks; authored Markdown and multiline content remain untouched.
  if (content.length < 360 || content.includes("\n") || /[`$]|\*\*/.test(content)) return content;
  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(content)]
    .map(part => part.segment.trim()).filter(Boolean);
  if (sentences.length < 3) return content;
  const paragraphs: string[] = [];
  let group: string[] = [];
  for (const sentence of sentences) {
    group.push(sentence);
    if (group.join(" ").length >= 180 || group.length >= 3) {
      paragraphs.push(group.join(" "));
      group = [];
    }
  }
  if (group.length) paragraphs.push(group.join(" "));
  return paragraphs.join("\n\n");
}
