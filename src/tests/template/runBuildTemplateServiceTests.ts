import { strict as assert } from "node:assert";
import { detectPreferredEol, normalizeLineEndingsForTemplate } from "../../template/lineEndings";
import { applyTemplateOutputQuality } from "../../template/outputQuality";

function run(): void {
  testDetectPreferredEol();
  testNormalizeToLf();
  testNormalizeToCrLf();
  testPostBuildFormatAndSpecialBlocks();
  testProvenanceModes();
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

function testPostBuildFormatAndSpecialBlocks(): void {
  const sourceTemplate = [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<Form>",
    "  <SQL><![CDATA[SELECT 1 FROM dbo.Test WHERE A=1]]></SQL>",
    "  <Command><![CDATA[UPDATE dbo.Test SET A=2 WHERE ID=1]]></Command>",
    "  <HTMLTemplate><![CDATA[<div>{{Content}}</div>]]></HTMLTemplate>",
    "</Form>",
    ""
  ].join("\n");

  const unformattedOutput = "<Form><SQL><![CDATA[SELECT 1 FROM dbo.Test WHERE A=1]]></SQL><Command><![CDATA[UPDATE dbo.Test SET A=2 WHERE ID=1]]></Command><HTMLTemplate><![CDATA[<div>{{Content}}</div>]]></HTMLTemplate></Form>";
  const actual = applyTemplateOutputQuality(unformattedOutput, sourceTemplate, {
    postBuildFormat: true,
    provenanceMode: "off",
    relativeTemplatePath: "Sample.xml",
    formatterMaxConsecutiveBlankLines: 2
  });

  assert.equal(actual.includes("<![CDATA[SELECT 1 FROM dbo.Test WHERE A=1]]>"), true);
  assert.equal(actual.includes("<![CDATA[UPDATE dbo.Test SET A=2 WHERE ID=1]]>"), true);
  assert.equal(actual.includes("<![CDATA[<div>{{Content}}</div>]]>"), true);
  assert.equal(actual.includes("<Form>"), true);
  assert.equal(actual.includes("</Form>"), true);
  console.log("PASS: post-build-format-special-blocks");
}

function testProvenanceModes(): void {
  const sourceTemplate = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<Form />\n";
  const built = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<Form />\n";

  const withProvenance = applyTemplateOutputQuality(built, sourceTemplate, {
    postBuildFormat: false,
    provenanceMode: "fileComment",
    provenanceLabel: "v0.0.99",
    relativeTemplatePath: "X/Y/Test.xml",
    formatterMaxConsecutiveBlankLines: 2
  });
  assert.equal(withProvenance.includes("<!-- Template builder: v0.0.99 - X/Y/Test.xml -->"), true);

  const withoutProvenance = applyTemplateOutputQuality(built, sourceTemplate, {
    postBuildFormat: false,
    provenanceMode: "off",
    relativeTemplatePath: "X/Y/Test.xml",
    formatterMaxConsecutiveBlankLines: 2
  });
  assert.equal(withoutProvenance.includes("Template builder:"), false);
  console.log("PASS: provenance-modes");
}

run();
