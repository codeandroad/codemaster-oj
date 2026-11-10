import test from "node:test";
import assert from "node:assert/strict";
import { acslContentParts } from "../src/components/acsl/diagram-model.ts";

test("native diagrams keep their paragraph position and append only unreferenced diagrams", () => {
  assert.deepEqual(acslContentParts("Before $x^2$.\n\n{{diagram:tree}}\n\nAfter.", ["tree", "circuit"]), [
    { kind: "text", text: "Before $x^2$.\n" },
    { kind: "diagram", id: "tree" },
    { kind: "text", text: "\nAfter." },
    { kind: "diagram", id: "circuit" },
  ]);
});

test("code fences, display math and inline marker text remain literal content", () => {
  for (const content of [
    "```text\n\n{{diagram:tree}}\n\n```",
    "~~~text\n\n{{diagram:tree}}\n\n~~~",
    "$$\n\n{{diagram:tree}}\n\n$$",
    "\\[\n\n{{diagram:tree}}\n\n\\]",
    "See {{diagram:tree}} here.",
    "Paragraph\n{{diagram:tree}}",
  ]) {
    assert.deepEqual(acslContentParts(content, ["tree"]), [
      { kind: "text", text: content }, { kind: "diagram", id: "tree" },
    ]);
  }
});

test("unknown and unsafe diagram references remain readable and cannot become elements", () => {
  for (const content of ["{{diagram:missing}}", "{{diagram:../../asset}}", "{{diagram:<script>}}", "{{diagram:javascript:alert(1)}}"]) {
    assert.deepEqual(acslContentParts(content, []), [{ kind: "text", text: content }]);
  }
});

test("repeated explicit diagram references remain in order without an extra appended copy", () => {
  assert.deepEqual(acslContentParts("{{diagram:a}}\n\n{{diagram:a}}", ["a"]), [
    { kind: "diagram", id: "a" }, { kind: "diagram", id: "a" },
  ]);
});
