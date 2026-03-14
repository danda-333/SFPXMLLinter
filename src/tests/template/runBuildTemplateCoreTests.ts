import { strict as assert } from "node:assert";
import { buildComponentLibrary, extractUsingComponentRefs, renderTemplateText, type ComponentSource } from "../../template/buildXmlTemplatesCore";

interface Case {
  name: string;
  components: ComponentSource[];
  template: string;
  expected: string;
  maxDepth?: number;
  expectedDebugLogs?: string[];
}

function run(): void {
  const cases: Case[] = [
    {
      name: "placeholder-contribution-custom-params",
      components: [
        {
          key: "Common/Shared/Assign",
          text: `
<Feature>
  <Contribution Name="Html" Insert="placeholder" Root="Form">
    <Wrap>{{CustomParam}}|{{FormIdent}}</Wrap>
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form Ident="ITSMRequest">
  <Body>{{Feature:Common/Shared/Assign,Contribution:Html,CustomParam:ParamValue}}</Body>
</Form>`,
      expected: `
<Form Ident="ITSMRequest">
  <Body>
    <Wrap>ParamValue|ITSMRequest</Wrap>
  </Body>
</Form>`
    },
    {
      name: "legacy-component-section-tags-still-work",
      components: [
        {
          key: "Common/Legacy",
          text: `
<Component>
  <Section Name="Controls" Root="Form" TargetXPath="//Form/Controls" Insert="append">
    <Control Ident="LegacyAdded" />
  </Section>
</Component>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/Legacy" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
</Form>`,
      expected: `
<Form>
  <Controls>
    <Control Ident="Base" />
    <Control Ident="LegacyAdded" />
  </Controls>
</Form>`
    },
    {
      name: "using-append-contribution-filter-and-root",
      components: [
        {
          key: "Common/CompA",
          text: `
<Feature>
  <Contribution Name="Controls" Root="Form" TargetXPath="//Form/Controls" Insert="append">
    <Control Ident="AddedByUsing" />
  </Contribution>
  <Contribution Name="Controls" Root="WorkFlow" TargetXPath="//WorkFlow/Controls" Insert="append">
    <Control Ident="MustNotBeAdded" />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form Ident="A">
  <Usings>
    <Using Feature="Common/CompA" Contribution="Controls" />
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
          text: `<Feature><Contribution Name="S" Root="Form" TargetXPath="//Form/Target" Insert="prepend"><Prepend /></Contribution></Feature>`
        },
        {
          key: "Common/Before",
          text: `<Feature><Contribution Name="S" Root="Form" TargetXPath="//Form/Target" Insert="before"><Before /></Contribution></Feature>`
        },
        {
          key: "Common/After",
          text: `<Feature><Contribution Name="S" Root="Form" TargetXPath="//Form/Target" Insert="after"><After /></Contribution></Feature>`
        },
        {
          key: "Common/Append",
          text: `<Feature><Contribution Name="S" Root="Form" TargetXPath="//Form/Target" Insert="append"><Append /></Contribution></Feature>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/Prepend" />
    <Using Feature="Common/Before" />
    <Using Feature="Common/After" />
    <Using Feature="Common/Append" />
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
      name: "xpath-multiple-matches-use-first-by-default",
      components: [
        {
          key: "Common/MultiFirst",
          text: `
<Feature>
  <Contribution Name="S" Root="Form" TargetXPath="//Form/Controls | //Form/Buttons" Insert="append">
    <Inserted />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/MultiFirst" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
  <Buttons>
    <Button Ident="SaveButton" />
  </Buttons>
</Form>`,
      expected: `
<Form>
  <Controls>
    <Control Ident="Base" />
    <Inserted />
  </Controls>
  <Buttons>
    <Button Ident="SaveButton" />
  </Buttons>
</Form>`,
      expectedDebugLogs: ["[TargetXPath] '//Form/Controls | //Form/Buttons' matched 2 nodes; using first match only"]
    },
    {
      name: "xpath-multiple-matches-allow-multiple-inserts",
      components: [
        {
          key: "Common/MultiAll",
          text: `
<Feature>
  <Contribution Name="S" Root="Form" TargetXPath="//Form/Controls | //Form/Buttons" Insert="append" AllowMultipleInserts="true">
    <Inserted />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="Common/MultiAll" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
  <Buttons>
    <Button Ident="SaveButton" />
  </Buttons>
</Form>`,
      expected: `
<Form>
  <Controls>
    <Control Ident="Base" />
    <Inserted />
  </Controls>
  <Buttons>
    <Button Ident="SaveButton" />
    <Inserted />
  </Buttons>
</Form>`,
      expectedDebugLogs: ["[TargetXPath] '//Form/Controls | //Form/Buttons' matched 2 nodes; applying to all matches"]
    },
    {
      name: "include-with-contribution-and-params",
      components: [
        {
          key: "Lib/Renderable",
          text: `
<Feature>
  <Contribution Name="Main" Insert="placeholder" Root="Form">
    <Rendered Value="{{Custom}}" Form="{{FormIdent}}" />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form Ident="REQ">
  <Host>
    <Include Feature="Lib/Renderable" Contribution="Main" Custom="X" />
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
      name: "include-without-contribution-uses-feature-inner-content",
      components: [
        {
          key: "Lib/Whole",
          text: `
<Feature>
  <A />
  <B Attr="{{FormIdent}}" />
</Feature>`
        }
      ],
      template: `
<Form Ident="REQ">
  <Host>
    <Include Feature="Lib/Whole" />
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
<Feature>
  <Contribution Name="Main" Insert="placeholder">
    <A>{{Feature:C/B,Contribution:Main,Nested:{{Value}}}}</A>
  </Contribution>
</Feature>`
        },
        {
          key: "C/B",
          text: `
<Feature>
  <Contribution Name="Main" Insert="placeholder">
    <B>{{Nested}}</B>
  </Contribution>
</Feature>`
        }
      ],
      template: `<Form>{{Feature:C/A,Contribution:Main,Value:42}}</Form>`,
      expected: `<Form><A><B>42</B></A></Form>`
    },
    {
      name: "unknown-component-placeholder-stays-unchanged",
      components: [],
      template: `<Form>{{Feature:Missing/Comp,Contribution:S}}</Form>`,
      expected: `<Form>{{Feature:Missing/Comp,Contribution:S}}</Form>`
    },
    {
      name: "sfp-component-root-template-is-preserved",
      components: [
        {
          key: "Shared/Sample",
          text: `
<Feature>
  <Contribution Name="Controls" Insert="append" TargetXPath="//Component/Controls" Root="Component">
    <Control Ident="Injected" />
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Component Ident="RuntimeComponent" xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">
  <Usings>
    <Using Feature="Shared/Sample" />
  </Usings>
  <Controls>
    <Control Ident="Base" />
  </Controls>
</Component>`,
      expected: `
<Component Ident="RuntimeComponent" xmlns:dsp="http://www.gappex.com/sfp/DataSource/Parameters">
  <Controls>
    <Control Ident="Base" />
    <Control Ident="Injected" />
  </Controls>
</Component>`
    },
    {
      name: "nested-sfp-component-inside-form-is-preserved",
      components: [
        {
          key: "Common/KnowledgeBase",
          text: `
<Feature>
  <Contribution Root="Form" Name="Component" TargetXPath="//Form/Components" Insert="append">
    <Component ComponentIdent="ITSMKnowledgeBaseComponent" Ident="ITSMKnowledgeBase">
      <KnowledgeBaseTree CountSectionIdent="KnowledgeBaseSection" Type="ArticleOnly" />
    </Component>
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form Ident="ITSMInovation">
  <Usings>
    <Using Feature="Common/KnowledgeBase" />
  </Usings>
  <Components>
    <Component ComponentIdent="TimeLineComponent" Ident="TimeLine" />
  </Components>
</Form>`,
      expected: `
<Form Ident="ITSMInovation">
  <Components>
    <Component ComponentIdent="TimeLineComponent" Ident="TimeLine" />
    <Component ComponentIdent="ITSMKnowledgeBaseComponent" Ident="ITSMKnowledgeBase">
      <KnowledgeBaseTree CountSectionIdent="KnowledgeBaseSection" Type="ArticleOnly" />
    </Component>
  </Components>
</Form>`
    },
    {
      name: "using-placeholder-contributions-are-skipped-during-using-phase",
      components: [
        {
          key: "C/Place",
          text: `
<Feature>
  <Contribution Name="Html" Insert="placeholder" Root="Form">
    <Block>OK</Block>
  </Contribution>
</Feature>`
        }
      ],
      template: `
<Form>
  <Usings>
    <Using Feature="C/Place" Contribution="Html" />
  </Usings>
  <Host>{{Feature:C/Place,Contribution:Html}}</Host>
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
      const debugLogs: string[] = [];
      const actual = renderTemplateText(c.template, library, c.maxDepth ?? 12, (line) => debugLogs.push(line));
      assert.equal(normalize(actual), normalize(c.expected));
      if (c.expectedDebugLogs) {
        assert.deepEqual(debugLogs, c.expectedDebugLogs);
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
    <Using Feature="Common\\Shared\\Assign.feature.xml" />
    <Using Name="Library/One.xml" />
  </Usings>
  <X>{{Feature:Common/Two.xml,Contribution:S}}</X>
  <Y>{{Name:Common/Three.feature.xml,Contribution:S}}</Y>
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
