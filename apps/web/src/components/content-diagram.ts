import { validAcslDiagrams } from "./acsl/diagram-validation.ts";
import type { AcslDiagram } from "./acsl/diagram-model";

/** Course Markdown carries data, never SVG markup or executable code. */
export function parseContentDiagram(source: string): AcslDiagram | null {
  if (source.length > 100000) return null;
  try {
    const diagram: unknown = JSON.parse(source);
    const value = { en: [diagram], zh: [] };
    return validAcslDiagrams(value) ? value.en[0] : null;
  } catch {
    return null;
  }
}
