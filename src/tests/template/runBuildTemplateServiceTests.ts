import { strict as assert } from "node:assert";
import { detectPreferredEol, normalizeLineEndingsForTemplate } from "../../template/lineEndings";

function run(): void {
  testDetectPreferredEol();
  testNormalizeToLf();
  testNormalizeToCrLf();
  console.log("Template service tests passed (EOL behavior).");
}

function testDetectPreferredEol(): void {
  assert.equal(detectPreferredEol("<A>\n<B />\n</A>\n"), "\n");
  assert.equal(detectPreferredEol("<A>\r\n<B />\r\n</A>\r\n"), "\r\n");
  // CRLF should win when present first in mixed input.
  assert.equal(detectPreferredEol("<A>\r\n<B />\n</A>\n"), "\r\n");
  console.log("PASS: detect-preferred-eol");
}

function testNormalizeToLf(): void {
  const templateText = "<A>\n<B />\n</A>\n";
  const generated = "<A>\r\n<B />\r\n</A>\r\n";
  const actual = normalizeLineEndingsForTemplate(generated, templateText);
  assert.equal(actual, "<A>\n<B />\n</A>\n");
  console.log("PASS: normalize-line-endings-lf");
}

function testNormalizeToCrLf(): void {
  const templateText = "<A>\r\n<B />\r\n</A>\r\n";
  const generated = "<A>\n<B />\n</A>\n";
  const actual = normalizeLineEndingsForTemplate(generated, templateText);
  assert.equal(actual, "<A>\r\n<B />\r\n</A>\r\n");
  console.log("PASS: normalize-line-endings-crlf");
}

run();
