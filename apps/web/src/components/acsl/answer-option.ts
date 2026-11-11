/** The verdict applies to the complete answer, never to an individual choice. */
export function acslAnswerOptionClassName(
  selected: boolean,
  questionCorrect?: boolean | null,
) {
  if (!selected) return "border-border";
  if (questionCorrect === false) return "border-destructive bg-destructive/10";
  if (questionCorrect === true) return "border-success bg-success/10";
  return "border-primary bg-primary/5";
}
