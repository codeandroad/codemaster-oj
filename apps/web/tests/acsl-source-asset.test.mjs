import test from "node:test";
import assert from "node:assert/strict";
import { acslSourceImageBlock } from "../src/components/acsl/source-asset.ts";
import { contentBlocks } from "../src/components/content-parser.ts";

const school = "11111111-1111-4111-8111-111111111111";
const paper = "22222222-2222-4222-8222-222222222222";
const version = "33333333-3333-4333-8333-333333333333";
const path = `/api/v1/schools/${school}/acsl/${paper}/assets/programming-en-1`;
const src = `${path}?versionId=${version}`;

test("ACSL image blocks retain the exact authenticated route, version and accessible label", () => {
  assert.deepEqual(
    acslSourceImageBlock(`![ACSL original statement 1](${src})`),
    {
      label: "ACSL original statement 1",
      src,
    },
  );
  assert.deepEqual(acslSourceImageBlock(`  ![ACSL 原题 1](${src})  `), {
    label: "ACSL 原题 1",
    src,
  });
});

test("other origins, routes, active protocols and ambiguous version URLs remain plain text", () => {
  for (const url of [
    `https://example.test${src}`,
    `//example.test${src}`,
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    `${path}`,
    `${src}&other=1`,
    `${src}#fragment`,
    `${src}&versionId=${version}`,
    src.replace("versionId=", "versionId=%2f"),
    src.replace("/assets/", "/assets/../"),
    src.replace("/assets/", "/assets/%2f"),
    src.replace("/assets/", "/judge-jobs/"),
    src.replace("/acsl/", "/problems/"),
    src.replace(school, "not-a-school-id"),
    src.replace("programming-en-1", "x.png"),
  ])
    assert.equal(acslSourceImageBlock(`![Original page](${url})`), null, url);
});

test("image syntax is standalone and code examples remain code blocks", () => {
  const image = `![Original page](${src})`;
  for (const text of [
    `Read ${image}`,
    `${image}\nMore text`,
    `![](${src})`,
    `![Original\npage](${src})`,
  ]) {
    assert.equal(acslSourceImageBlock(text), null);
  }
  const blocks = contentBlocks(
    `Description\n\n${image}\n\n\`\`\`markdown\n${image}\n\`\`\``,
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["paragraph", "paragraph", "code"],
  );
  assert.deepEqual(
    blocks
      .filter((block) => block.kind === "paragraph")
      .map((block) => acslSourceImageBlock(block.text))
      .filter(Boolean),
    [{ label: "Original page", src }],
  );
});
