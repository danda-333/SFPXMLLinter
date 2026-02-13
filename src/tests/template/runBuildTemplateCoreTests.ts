import { strict as assert } from "node:assert";
import { buildComponentLibrary, extractUsingComponentRefs, renderTemplateText, type ComponentSource } from "../../template/buildXmlTemplatesCore";

interface Case {
  name: string;
  components: ComponentSource[];
  template: string;
  expected: string;
  maxDepth?: number;
}

function run(): void {
  const cases: Case[] = [
    {
      name: "placeholder-section-custom-params",
      components: [
        {
          key: "Common/Shared/Assign",
          text: `
<Component>
  <Section Name="Html" Insert="placeholder" Root="Form">
    <Wrap>{{CustomParam}}|{{FormIdent}}</Wrap>
  </Section>
</Component>`
        }
      ],
      template: `
<Form Ident="ITSMRequest">
  <Body>{{Component:Common/Shared/Assign,Section:Html,CustomParam:ParamValue}}</Body>
</Form>`,
      expected: `
<Form Ident="ITSMRequest">
  <Body>
    <Wrap>ParamValue|ITSMRequest</Wrap>
  </Body>
</Form>`
    },
    {
      name: "using-append-section-filter-and-root",
      components: [
        {
          key: "Common/CompA",
          text: `
<Component>
  <Section Name="Controls" Root="Form" TargetXPath="//Form/Controls" Insert="append">
    <Control Ident="AddedByUsing" />
  </Section>
  <Section Name="Controls" Root="WorkFlow" TargetXPath="//WorkFlow/Controls" Insert="append">
    <Control Ident="MustNotBeAdded" />
  </Section>
</Component>`
        }
      ],
      template: `
<Form Ident="A">
  <Usings>
    <Using Component="Common/CompA" Section="Controls" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
</Form>`,
      expected: `
<Form Ident="A">
  <Controls>
    <Control Ident="Base" />
    <Control Ident="AddedByUsing" />
  </Controls>
</Form>`
    },
    {
      name: "insert-modes-prepend-before-after-append",
      components: [
        {
          key: "Common/Prepend",
          text: `<Component><Section Name="S" Root="Form" TargetXPath="//Form/Target" Insert="prepend"><Prepend /></Section></Component>`
        },
        {
          key: "Common/Before",
          text: `<Component><Section Name="S" Root="Form" TargetXPath="//Form/Target" Insert="before"><Before /></Section></Component>`
        },
        {
          key: "Common/After",
          text: `<Component><Section Name="S" Root="Form" TargetXPath="//Form/Target" Insert="after"><After /></Section></Component>`
        },
        {
          key: "Common/Append",
          text: `<Component><Section Name="S" Root="Form" TargetXPath="//Form/Target" Insert="append"><Append /></Section></Component>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Component="Common/Prepend" />
    <Using Component="Common/Before" />
    <Using Component="Common/After" />
    <Using Component="Common/Append" />
  </Usings>
  <Target>
    <Base />
  </Target>
</Form>`,
      expected: `
<Form>
  <Before />
  <Target>
    <Prepend />
    <Base />
    <Append />
  </Target>
  <After />
</Form>`
    },
    {
      name: "include-with-section-and-params",
      components: [
        {
          key: "Lib/Renderable",
          text: `
<Component>
  <Section Name="Main" Insert="placeholder" Root="Form">
    <Rendered Value="{{Custom}}" Form="{{FormIdent}}" />
  </Section>
</Component>`
        }
      ],
      template: `
<Form Ident="REQ">
  <Host>
    <Include Component="Lib/Renderable" Section="Main" Custom="X" />
  </Host>
</Form>`,
      expected: `
<Form Ident="REQ">
  <Host>
    <Rendered Value="X" Form="REQ" />
  </Host>
</Form>`
    },
    {
      name: "include-without-section-uses-component-inner-content",
      components: [
        {
          key: "Lib/Whole",
          text: `
<Component>
  <A />
  <B Attr="{{FormIdent}}" />
</Component>`
        }
      ],
      template: `
<Form Ident="REQ">
  <Host>
    <Include Component="Lib/Whole" />
  </Host>
</Form>`,
      expected: `
<Form Ident="REQ">
  <Host>
    <A />
    <B Attr="REQ" />
  </Host>
</Form>`
    },
    {
      name: "nested-placeholders-and-param-propagation",
      components: [
        {
          key: "C/A",
          text: `
<Component>
  <Section Name="Main" Insert="placeholder">
    <A>{{Component:C/B,Section:Main,Nested:{{Value}}}}</A>
  </Section>
</Component>`
        },
        {
          key: "C/B",
          text: `
<Component>
  <Section Name="Main" Insert="placeholder">
    <B>{{Nested}}</B>
  </Section>
</Component>`
        }
      ],
      template: `<Form>{{Component:C/A,Section:Main,Value:42}}</Form>`,
      expected: `<Form><A><B>42</B></A></Form>`
    },
    {
      name: "unknown-component-placeholder-stays-unchanged",
      components: [],
      template: `<Form>{{Component:Missing/Comp,Section:S}}</Form>`,
      expected: `<Form>{{Component:Missing/Comp,Section:S}}</Form>`
    },
    {
      name: "using-placeholder-sections-are-skipped-during-using-phase",
      components: [
        {
          key: "C/Place",
          text: `
<Component>
  <Section Name="Html" Insert="placeholder" Root="Form">
    <Block>OK</Block>
  </Section>
</Component>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Component="C/Place" Section="Html" />
  </Usings>
  <Host>{{Component:C/Place,Section:Html}}</Host>
</Form>`,
      expected: `
<Form>
  <Host><Block>OK</Block></Host>
</Form>`
    }
  ];

  let failures = 0;
  for (const c of cases) {
    try {
      const library = buildComponentLibrary(c.components);
      const actual = renderTemplateText(c.template, library, c.maxDepth ?? 12);
      assert.equal(normalize(actual), normalize(c.expected));
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

  runRefsTest();

  if (failures > 0) {
    throw new Error(`Template core tests failed (${failures} case(s)).`);
  }
  console.log(`Template core tests passed (${cases.length} cases + extractUsingComponentRefs).`);
}

function runRefsTest(): void {
  const input = `
<Form>
  <Usings>
    <Using Component="Common\\Shared\\Assign.component.xml" />
    <Using Name="Library/One.xml" />
  </Usings>
  <X>{{Component:Common/Two.xml,Section:S}}</X>
  <Y>{{Name:Common/Three.component.xml,Section:S}}</Y>
</Form>`;
  const refs = extractUsingComponentRefs(input).sort((a, b) => a.localeCompare(b));
  const expected = ["Common/Shared/Assign", "Common/Three", "Common/Two", "Library/One"].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(refs, expected);
  console.log("PASS: extract-using-component-refs");
}

function normalize(value: string): string {
  let out = value.replace(/\r\n/g, "\n");
  out = out.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  out = out.replace(/<\/?[\w:.-]+(?:\s+[^<>]*?)?\s*\/?>/g, (tag) => normalizeTag(tag));
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/>\s+</g, "><");
  out = out.trim();
  return out.trimEnd();
}

function normalizeTag(tag: string): string {
  if (tag.startsWith("<?") || tag.startsWith("<!") || tag.startsWith("<!--")) {
    return tag;
  }
  const isClosing = /^<\s*\//.test(tag);
  const isSelfClosing = /\/\s*>$/.test(tag);
  const nameMatch = /^<\s*\/?\s*([A-Za-z_][\w:.-]*)/.exec(tag);
  const name = nameMatch?.[1] ?? "";
  if (!name) {
    return tag;
  }
  if (isClosing) {
    return `</${name}>`;
  }
  const attrs: string[] = [];
  const attrRegex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(attrRegex)) {
    const key = match[1] ?? "";
    if (!key) {
      continue;
    }
    if (typeof match[2] === "string") {
      attrs.push(`${key}="${match[2]}"`);
    } else {
      attrs.push(`${key}='${match[3] ?? ""}'`);
    }
  }
  const attrText = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  if (isSelfClosing) {
    return `<${name}${attrText}/>`;
  }
  return `<${name}${attrText}>`;
}

run();
