import { strict as assert } from "node:assert";
import { normalizeTemplateSpecialBlocksToCdata } from "../../template/templateSpecialBlockCdataNormalizer";

function run(): void {
  wrapsSqlAndHtmlTemplateBlocks();
  preservesExistingCdataBlocks();
  ignoresCommentedPseudoBlocks();
  escapesEmbeddedCdataClosers();
  console.log("Template special block CDATA normalizer tests passed.");
}

function wrapsSqlAndHtmlTemplateBlocks(): void {
  const input = [
    "<Form>",
    "  <SQL>",
    "    SELECT 1",
    "  </SQL>",
    "  <HTMLTemplate>",
    "    <div>Hello</div>",
    "  </HTMLTemplate>",
    "</Form>"
  ].join("\n");

  const result = normalizeTemplateSpecialBlocksToCdata(input);
  assert.equal(result.changedBlocks, 2);
  assert.equal(result.text.includes("<SQL><![CDATA["), true);
  assert.equal(result.text.includes("<HTMLTemplate><![CDATA["), true);
}

function preservesExistingCdataBlocks(): void {
  const input = [
    "<Form>",
    "  <SQL><![CDATA[SELECT 1]]></SQL>",
    "  <HTMLTemplate><![CDATA[<div>Hello</div>]]></HTMLTemplate>",
    "</Form>"
  ].join("\n");

  const result = normalizeTemplateSpecialBlocksToCdata(input);
  assert.equal(result.changedBlocks, 0);
  assert.equal(result.text, input);
}

function ignoresCommentedPseudoBlocks(): void {
  const input = [
    "<Form>",
    "  <!-- <SQL>SELECT 1</SQL> -->",
    "  <SQL>SELECT 2</SQL>",
    "</Form>"
  ].join("\n");

  const result = normalizeTemplateSpecialBlocksToCdata(input);
  assert.equal(result.changedBlocks, 1);
  assert.equal(result.text.includes("<!-- <SQL>SELECT 1</SQL> -->"), true);
  assert.equal(result.text.includes("<SQL><![CDATA[SELECT 2]]></SQL>"), true);
}

function escapesEmbeddedCdataClosers(): void {
  const input = "<Form><HTMLTemplate>before ]]> after</HTMLTemplate></Form>";
  const result = normalizeTemplateSpecialBlocksToCdata(input);
  assert.equal(result.changedBlocks, 1);
  assert.equal(result.text.includes("<![CDATA[before ]]]]><![CDATA[> after]]>"), true);
}

run();
