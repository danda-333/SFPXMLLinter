import { strict as assert } from "node:assert";
import { buildComponentLibrary, renderTemplateText, type ComponentSource } from "../../template/buildXmlTemplatesCore";

interface PrimitiveCase {
  name: string;
  components: ComponentSource[];
  template: string;
  expected: string;
  expectedDebugLogs?: string[];
}

function run(): void {
  const cases: PrimitiveCase[] = [
    {
      name: "unknown-primitive-keeps-original-tag",
      components: [],
      template: `<Form><Body><UsePrimitive Name="Common/Missing/Primitive" /></Body></Form>`,
      expected: `<Form><Body><UsePrimitive Name="Common/Missing/Primitive" /></Body></Form>`,
      expectedDebugLogs: ["[Primitive] 'Common/Missing/Primitive' not found."]
    },
    {
      name: "unknown-template-keeps-original-tag",
      components: [
        {
          key: "Common/Badge",
          text: `<Primitive><Template Name="Short"><Badge>{{Text}}</Badge></Template></Primitive>`
        }
      ],
      template: `<Form><Body><UsePrimitive Name="Common/Badge" Template="Long" Text="X" /></Body></Form>`,
      expected: `<Form><Body><UsePrimitive Name="Common/Badge" Template="Long" Text="X" /></Body></Form>`,
      expectedDebugLogs: ["[Primitive] 'Common/Badge' has no usable template."]
    },
    {
      name: "primitive-template-parameter-substitution",
      components: [
        {
          key: "Common/Dialog",
          text: `<Primitive><Template Name="Main"><Section Ident="{{Ident}}" TitleResourceKey="{{TitleKey}}" /></Template></Primitive>`
        }
      ],
      template: `<Form><Sections><UsePrimitive Name="Common/Dialog" Template="Main" Ident="DialogA" TitleKey="DialogA_Title" /></Sections></Form>`,
      expected: `<Form><Sections><Section Ident="DialogA" TitleResourceKey="DialogA_Title" /></Sections></Form>`
    },
    {
      name: "primitive-slot-nesting-renders-inner-primitive-first",
      components: [
        {
          key: "Common/Container",
          text: `<Primitive><Template><Wrap>{{Slot:Body}}</Wrap></Template></Primitive>`
        },
        {
          key: "Common/Label",
          text: `<Primitive><Template><Label>{{Text}}</Label></Template></Primitive>`
        }
      ],
      template: `<Form><Body><UsePrimitive Name="Common/Container"><Slot Name="Body"><UsePrimitive Name="Common/Label" Text="Hello" /></Slot></UsePrimitive></Body></Form>`,
      expected: `<Form><Body><Wrap><Label>Hello</Label></Wrap></Body></Form>`
    },
    {
      name: "primitive-default-template-selection-without-template-attribute",
      components: [
        {
          key: "Common/Fallback",
          text: `<Primitive><Template Name="Only"><Tag>{{Text}}</Tag></Template></Primitive>`
        }
      ],
      template: `<Form><Body><UsePrimitive Name="Common/Fallback" Text="A" /></Body></Form>`,
      expected: `<Form><Body><Tag>A</Tag></Body></Form>`
    }
  ];

  let failures = 0;
  for (const c of cases) {
    try {
      const library = buildComponentLibrary(c.components);
      const debugLogs: string[] = [];
      const actual = renderTemplateText(c.template, library, 12, (line) => debugLogs.push(line));
      assert.equal(normalize(actual), normalize(c.expected));
      if (c.expectedDebugLogs) {
        for (const expectedLine of c.expectedDebugLogs) {
          assert.equal(
            debugLogs.includes(expectedLine),
            true,
            `Expected debug log '${expectedLine}' was not emitted.`
          );
        }
      }
      console.log(`PASS: ${c.name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL: ${c.name}`);
      if (error instanceof Error) {
        console.error(`  ${error.message}`);
      } else {
        console.error(`  ${String(error)}`);
      }
    }
  }

  if (failures > 0) {
    throw new Error(`Template primitive tests failed (${failures} case(s)).`);
  }
  console.log(`Template primitive tests passed (${cases.length} cases).`);
}

function normalize(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/>\s+</g, "><")
    .trim();
}

run();
