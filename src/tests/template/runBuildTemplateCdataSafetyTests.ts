import { strict as assert } from "node:assert";
import { buildComponentLibrary, renderTemplateText } from "../../template/buildXmlTemplatesCore";

function run(): void {
  testCdataSqlLiteralWithXmlLikeTextIsPreserved();
  console.log("Template CDATA safety tests passed.");
}

function testCdataSqlLiteralWithXmlLikeTextIsPreserved(): void {
  const component = [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<Component>",
    "  <Section Root=\"DataView\" Name=\"Froms\" Insert=\"placeholder\">",
    "    <dsf:From Ident=\"itsGscvfiAgg\">",
    "      <dsf:SQL><![CDATA[",
    "        SELECT CONCAT(",
    "          '<span class=\"badge '",
    "          ,CASE ",
    "            WHEN x.PercentRemain >= 25 THEN 'badge-info'",
    "            WHEN x.PercentRemain >= 0 THEN 'badge-warning'",
    "            ELSE 'badge-danger'",
    "          END",
    "          ,'\">'",
    "        )",
    "      ]]></dsf:SQL>",
    "    </dsf:From>",
    "  </Section>",
    "</Component>"
  ].join("\n");

  const template = [
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<DataView>",
    "  <DataSource>",
    "    <Froms>",
    "      <Include Component=\"Common/Shared/BaseView/SLA\" Section=\"Froms\"/>",
    "    </Froms>",
    "  </DataSource>",
    "</DataView>"
  ].join("\n");

  const library = buildComponentLibrary([
    { key: "Common/Shared/BaseView/SLA", text: component }
  ]);

  const output = renderTemplateText(template, library);
  assert.equal(output.includes("<![CDATA["), true, "Expected CDATA to be preserved.");
  assert.equal(
    output.includes("'<span class=\"badge '"),
    true,
    "Expected SQL literal with XML-like text to remain intact."
  );
  assert.equal(
    output.includes("WHEN x.PercentRemain >= 25 THEN 'badge-info'"),
    true,
    "Expected comparison operator inside SQL to remain intact."
  );
}

run();

